// Multi-tenancy foundation (multi-tenancy capability). A `Tenant` is the
// per-request identity context every tool closes over: the single operator-owned
// data repo every tenant shares, and the `users/<username>/` path prefix under
// which THIS caller's personal state lives in that repo.
//
// Repository model (single private data repo): one repo holds `recipes/` + shared
// reference data at the root and one `users/<username>/` subtree per member. A
// single GitHub App installation on the operator's account covers it. There is no
// org and no per-tenant repo; "which tenant" is a path prefix, not a separate repo.
//
// The tenant DIRECTORY is the operator-curated allowlist of usernames, in KV, so
// it is operational mapping, never domain data (D9). `resolveTenant` is the seam
// every MCP request passes through before any tool runs; it maps a bearer token
// to a tenant or a structured `unauthorized`. The identity STEP that mints the
// bearer->tenant binding is the OAuth provider (Section 3) and is intentionally
// NOT decided here — the allowlist keys on an opaque username (e.g. "alice"), not
// on any third-party identity, so swapping the identity mechanism never reaches
// this module.

import type { Env } from "./env.js";

/** Coordinates of the GitHub repository the Worker reads/writes. */
export interface RepoCoords {
  owner: string;
  repo: string;
  ref: string;
}

/** The per-request tenant context. Assembled by `resolveTenant`. */
export interface Tenant {
  /** Opaque operator-assigned username, e.g. "alice". Allowlist key + Kroger key + subtree. */
  id: string;
  /** The single shared data repo (objective content + reference data + all users' subtrees). */
  dataRepo: RepoCoords;
  /** Repo-relative prefix for this tenant's personal files, e.g. "users/alice" (empty during the pre-migration single-user bootstrap). */
  userPrefix: string;
  /** GitHub App installation covering the data repo (on the operator's account). */
  installationId: string;
}

/** Structured rejection returned when a bearer token resolves to no tenant. */
export interface Unauthorized {
  error: "unauthorized";
  message: string;
}

/**
 * What the directory persists per tenant. The data repo, installation, and
 * `users/<id>` prefix are all derivable globally (from `env` + the id), so the
 * record is just the allowlist entry — `resolveTenant` joins the rest on.
 */
export interface TenantRecord {
  /** Must equal the directory key (the username) it is stored under. */
  id: string;
}

/** A directory of tenants keyed by opaque tenant id. Injectable for tests. */
export interface TenantStore {
  /** The record for `tenantId`, or null if no such tenant exists. */
  get(tenantId: string): Promise<TenantRecord | null>;
}

/**
 * Maps an opaque bearer access token to the tenant id it was issued for. The
 * OAuth provider (Section 3) implements this against its grant store; injecting
 * it keeps tenant resolution testable without standing up the full provider.
 */
export interface TokenResolver {
  /** The tenant id this token was issued for, or null if unknown/expired. */
  tenantOf(token: string): Promise<string | null>;
}

export interface ResolveDeps {
  tokens: TokenResolver;
  directory: TenantStore;
}

const DIRECTORY_PREFIX = "tenant:";

/** The single data-repo coordinates, identical for every tenant, from `env`. */
export function dataCoords(env: Env): RepoCoords {
  return { owner: env.DATA_OWNER, repo: env.DATA_REPO, ref: env.DATA_REF };
}

/** This tenant's personal-file path prefix within the data repo. */
export function userPrefix(tenantId: string): string {
  return `users/${tenantId}`;
}

/** A KV-backed tenant directory. Records are JSON under `tenant:<id>`. */
export function kvTenantStore(kv: KVNamespace): TenantStore {
  return {
    async get(tenantId: string): Promise<TenantRecord | null> {
      const raw = await kv.get(`${DIRECTORY_PREFIX}${tenantId}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as TenantRecord;
        if (!parsed?.id) return null;
        return parsed;
      } catch {
        return null;
      }
    },
  };
}

/** Default directory wiring from the environment (the tenant-directory KV). */
export function directoryFromEnv(env: Env): TenantStore {
  return kvTenantStore(env.TENANT_KV);
}

/**
 * Resolve a bearer access token to its `Tenant`, or a structured `unauthorized`
 * when the token is missing, unknown, or names a tenant absent from the
 * directory. No tool runs until this succeeds (enforced in `index.ts`).
 */
export async function resolveTenant(
  env: Env,
  token: string | null,
  deps: ResolveDeps,
): Promise<Tenant | Unauthorized> {
  if (!token) {
    return { error: "unauthorized", message: "Missing bearer access token" };
  }
  const tenantId = await deps.tokens.tenantOf(token);
  if (!tenantId) {
    return { error: "unauthorized", message: "Access token does not resolve to a tenant" };
  }
  const record = await deps.directory.get(tenantId);
  if (!record) {
    return { error: "unauthorized", message: `Username ${tenantId} is not on the allowlist` };
  }
  return {
    id: record.id,
    dataRepo: dataCoords(env),
    userPrefix: userPrefix(record.id),
    installationId: env.GITHUB_INSTALLATION_ID,
  };
}

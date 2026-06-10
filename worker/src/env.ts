// Worker environment. Repo access is via a GitHub App (D3): the App id is a
// non-secret var, the private key is a secret (wrangler secret put). There is ONE
// private data repo (operator-owned, no org); its coordinates are global vars.
// "Which tenant" is a `users/<username>/` path prefix within that repo, resolved
// from the bearer token on each request (tenant.ts) — not a per-repo coordinate.
// Kroger client_credentials (reads) stay a single app-level secret shared by all.

import type { Tenant, RepoCoords } from "./tenant.js";

export interface Env {
  // --- GitHub App (repo reads/writes via short-lived installation tokens) ---
  /** GitHub App id (numeric, as string). Non-secret var. */
  GITHUB_APP_ID: string;
  /** GitHub App private key, PKCS#8 PEM. Secret. */
  GITHUB_APP_PRIVATE_KEY: string;
  /**
   * Installation id of the App install on the operator's account that covers the
   * data repo. Global (one repo, one install). Non-secret var.
   */
  GITHUB_INSTALLATION_ID: string;

  // --- The single private data repo (recipes/ + reference data + users/<id>/). Global. ---
  /** Data repo owner (the operator's personal account), e.g. "caseyWebb". */
  DATA_OWNER: string;
  /** Data repo name, e.g. "grocery-data". */
  DATA_REPO: string;
  /** Ref to read the data repo at, e.g. "main". */
  DATA_REF: string;
  /**
   * TRANSITIONAL: the operator's personal-file prefix for the single-user
   * bootstrap (`tenantFromEnv`). Empty ("") pre-migration when personal files sit
   * at the repo root; set to "users/<username>" after the migration moves them.
   * The OAuth path (Section 3) derives `users/<username>` per request instead.
   */
  DATA_USER_PREFIX?: string;
  /**
   * TRANSITIONAL: the operator's tenant id for the single-user bootstrap
   * (`tenantFromEnv`). Keys the Kroger refresh token (`kroger:refresh:<id>`).
   * Defaults to "operator"; set it to match your username (and `DATA_USER_PREFIX`
   * / the `tenant:<id>` directory entry). The OAuth path (Section 3) supplies it
   * per request instead.
   */
  DATA_TENANT_ID?: string;

  // --- Kroger client_credentials (search/flyer/prices). App-level, shared. ---
  /** Kroger Developer (public tier) client_credentials client ID. Secret. */
  KROGER_CLIENT_ID: string;
  /** Kroger Developer (public tier) client_credentials client secret. Secret. */
  KROGER_CLIENT_SECRET: string;
  /**
   * Kroger `authorization_code` app client ID (user-context: cart writes).
   * Secret, OPTIONAL: when unset, the user-auth client falls back to
   * KROGER_CLIENT_ID — one Kroger app carrying BOTH grants. Used by kroger-user.ts.
   */
  KROGER_OAUTH_CLIENT_ID?: string;
  /** Kroger `authorization_code` app client secret. Secret, OPTIONAL (falls back to KROGER_CLIENT_SECRET). */
  KROGER_OAUTH_CLIENT_SECRET?: string;

  // --- KV ---
  /**
   * Per-tenant Kroger refresh tokens (`kroger:refresh:<tenant>`) plus short-lived
   * PKCE verifiers keyed by `state`. Bound in wrangler.jsonc.
   */
  KROGER_KV: KVNamespace;
  /**
   * Operational mapping only (D9): the tenant directory (`tenant:<id>` ->
   * repo coords + installation) and, from Section 3, the OAuth provider's
   * clients/codes/grants. NO domain data lives here.
   */
  TENANT_KV: KVNamespace;

  // --- Cloudflare Access (TRANSITIONAL — removed in Section 3.3 with the OAuth provider) ---
  /** Cloudflare Access team domain, e.g. "dirtbags.cloudflareaccess.com". Non-secret. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application AUD tag. Non-secret. */
  ACCESS_AUD?: string;
}

/**
 * TRANSITIONAL single-tenant bootstrap. Builds the operator `Tenant` directly
 * from env so the deployment keeps working until the OAuth provider resolves
 * tenants from a bearer token (Section 3.3). `DATA_USER_PREFIX` controls where the
 * operator's personal files live (root pre-migration, `users/operator` after).
 * At that point this helper goes away.
 */
export function tenantFromEnv(env: Env): Tenant {
  const dataRepo: RepoCoords = { owner: env.DATA_OWNER, repo: env.DATA_REPO, ref: env.DATA_REF };
  return {
    id: env.DATA_TENANT_ID ?? "operator",
    dataRepo,
    userPrefix: env.DATA_USER_PREFIX ?? "",
    installationId: env.GITHUB_INSTALLATION_ID,
  };
}

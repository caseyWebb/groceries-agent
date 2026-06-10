import { describe, it, expect } from "vitest";
import {
  resolveTenant,
  kvTenantStore,
  type TenantRecord,
  type TenantStore,
  type TokenResolver,
  type Unauthorized,
  type Tenant,
} from "../src/tenant.js";
import type { Env } from "../src/env.js";

const env = {
  DATA_OWNER: "caseyWebb",
  DATA_REPO: "grocery-data",
  DATA_REF: "main",
  GITHUB_INSTALLATION_ID: "42",
} as unknown as Env;

const ALICE: TenantRecord = { id: "alice" };

function store(records: Record<string, TenantRecord>): TenantStore {
  return { async get(id) { return records[id] ?? null; } };
}

function tokens(map: Record<string, string>): TokenResolver {
  return { async tenantOf(token) { return map[token] ?? null; } };
}

const isUnauthorized = (r: Tenant | Unauthorized): r is Unauthorized =>
  (r as Unauthorized).error === "unauthorized";

describe("resolveTenant", () => {
  it("resolves a valid token to its tenant, joining data-repo coords + user prefix from env", async () => {
    const r = await resolveTenant(env, "tok-alice", {
      tokens: tokens({ "tok-alice": "alice" }),
      directory: store({ alice: ALICE }),
    });

    expect(isUnauthorized(r)).toBe(false);
    const t = r as Tenant;
    expect(t.id).toBe("alice");
    expect(t.dataRepo).toEqual({ owner: "caseyWebb", repo: "grocery-data", ref: "main" });
    expect(t.userPrefix).toBe("users/alice");
    expect(t.installationId).toBe("42");
  });

  it("rejects a missing token without consulting the directory", async () => {
    const r = await resolveTenant(env, null, {
      tokens: tokens({}),
      directory: store({ alice: ALICE }),
    });
    expect(isUnauthorized(r)).toBe(true);
  });

  it("rejects a token that resolves to no tenant", async () => {
    const r = await resolveTenant(env, "bogus", {
      tokens: tokens({}),
      directory: store({ alice: ALICE }),
    });
    expect(isUnauthorized(r)).toBe(true);
  });

  it("rejects a token whose tenant is absent from the directory", async () => {
    const r = await resolveTenant(env, "tok-ghost", {
      tokens: tokens({ "tok-ghost": "ghost" }),
      directory: store({ alice: ALICE }),
    });
    expect(isUnauthorized(r)).toBe(true);
  });

  it("isolates tenants: each token resolves only to its own user subtree", async () => {
    const BOB: TenantRecord = { id: "bob" };
    const deps = {
      tokens: tokens({ "tok-alice": "alice", "tok-bob": "bob" }),
      directory: store({ alice: ALICE, bob: BOB }),
    };

    const a = (await resolveTenant(env, "tok-alice", deps)) as Tenant;
    const b = (await resolveTenant(env, "tok-bob", deps)) as Tenant;

    // Same data repo, different personal subtree — no cross-tenant path reach.
    expect(a.dataRepo).toEqual(b.dataRepo);
    expect(a.userPrefix).toBe("users/alice");
    expect(b.userPrefix).toBe("users/bob");
  });
});

describe("kvTenantStore", () => {
  function memKv(initial: Record<string, string> = {}): KVNamespace {
    const m = new Map(Object.entries(initial));
    return {
      async get(key: string) { return m.get(key) ?? null; },
    } as unknown as KVNamespace;
  }

  it("reads a record stored under tenant:<id>", async () => {
    const s = kvTenantStore(memKv({ "tenant:alice": JSON.stringify(ALICE) }));
    expect(await s.get("alice")).toEqual(ALICE);
  });

  it("returns null for an unknown tenant", async () => {
    const s = kvTenantStore(memKv());
    expect(await s.get("nobody")).toBeNull();
  });

  it("returns null for a malformed record", async () => {
    const s = kvTenantStore(memKv({ "tenant:broken": "{ not json" }));
    expect(await s.get("broken")).toBeNull();
  });
});

// D1 data layer for the `members` table (member-identity-split, multi-tenancy
// capability). One row per member within a tenant; the FOUNDING MEMBER's id and handle
// equal the canonical tenant id, which is what keeps every pre-split credential value a
// valid member id. This is the SINGLE place those rows are read/written, function-per-
// query like webauthn-db.ts/signup-db.ts — but over an injectable `Db` (src/db.ts)
// rather than an Env, because the admin lifecycle operations (src/admin.ts) close over
// an injected `deps.db` while the resolver (src/tenant.ts) passes `db(env)`. Either
// way every statement runs through src/db.ts (never `env.DB`), so a D1 failure
// surfaces as a structured `storage_error`.

import type { Db } from "./db.js";

/** A member row: identity + display handle within the owning tenant (household). */
export interface MemberRow {
  id: string;
  tenant: string;
  handle: string;
  created_at: number;
}

/** The member `(id, tenant)` row, or null — the resolver's liveness check. */
export async function getMember(d: Db, id: string, tenant: string): Promise<MemberRow | null> {
  return d.first<MemberRow>(
    "SELECT id, tenant, handle, created_at FROM members WHERE tenant = ?1 AND id = ?2",
    tenant,
    id,
  );
}

/** How many members a tenant holds — drives the lazy founding-member convergence guard
 *  (mint only at zero) and the last-member refusal on member-revoke. */
export async function countMembers(d: Db, tenant: string): Promise<number> {
  const row = await d.first<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE tenant = ?1", tenant);
  return row?.n ?? 0;
}

/** Idempotently mint a tenant's founding member: `id = tenant = handle` (the invariant
 *  that makes every pre-split credential value a valid member id). INSERT OR IGNORE, so
 *  every tenant-creation path and the lazy convergence guard can call it safely. */
export async function insertFoundingMember(d: Db, tenant: string, now: number): Promise<void> {
  await d.run(
    "INSERT OR IGNORE INTO members (id, tenant, handle, created_at) VALUES (?1, ?2, ?3, ?4)",
    tenant,
    tenant,
    tenant,
    now,
  );
}

/** Delete one member row (member-revoke). Idempotent; the household's other rows stay. */
export async function deleteMember(d: Db, id: string, tenant: string): Promise<void> {
  await d.run("DELETE FROM members WHERE tenant = ?1 AND id = ?2", tenant, id);
}

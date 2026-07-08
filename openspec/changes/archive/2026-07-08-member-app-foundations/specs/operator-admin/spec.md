## MODIFIED Requirements

### Requirement: Member revocation fully purges tenant state

The admin surface SHALL revoke a member within the Worker by removing their allowlist entry (`tenant:<id>`), deleting every invite mapping that resolves to that member (located by scanning `invite:*`, so no code need be supplied), deleting the member's per-tenant Kroger refresh token (`kroger:refresh:<id>`), deleting every web session record that resolves to that member (located by scanning `session:*` in `TENANT_KV` and matching the stored tenant), and purging the member's per-tenant D1 rows — every tenant-scoped table and their attributed `recipe_notes` / `store_notes` — through `src/db.ts`. After revocation the member's previously-issued access token SHALL no longer resolve to a tenant, even though the token may still exist in the OAuth store, and their previously-issued session cookie SHALL no longer authenticate (the session middleware's allowlist re-check locks them out even before the purge, and the purge removes the records). The shared recipe corpus SHALL NOT be deleted (recipes are not tenant-owned).

#### Scenario: Revoke removes the allowlist entry and all invites

- **WHEN** the operator revokes `casey`
- **THEN** `tenant:casey` is deleted and every `invite:*` whose value is `casey` is deleted, with no invite code supplied by the operator

#### Scenario: Revoke purges per-tenant D1 and the Kroger token

- **WHEN** the operator revokes `casey`
- **THEN** every per-tenant D1 table is cleared of `casey`'s rows, `casey`'s attributed notes are removed, and `kroger:refresh:casey` is deleted

#### Scenario: A revoked token stops resolving

- **WHEN** a request arrives carrying `casey`'s previously-issued access token after revocation
- **THEN** tenant resolution fails (the allowlist entry is gone) and no tool runs, even though the token still exists in the OAuth store

#### Scenario: Revoke purges web sessions and the cookie stops authenticating

- **WHEN** the operator revokes `casey` while `casey` holds live web sessions
- **THEN** every `session:*` record resolving to `casey` is deleted, and a request replaying `casey`'s session cookie receives a structured `unauthorized` 401

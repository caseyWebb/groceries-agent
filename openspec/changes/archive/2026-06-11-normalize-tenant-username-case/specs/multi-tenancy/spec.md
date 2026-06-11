## ADDED Requirements

### Requirement: Tenant usernames are case-insensitive (canonical lowercase)

Tenant usernames SHALL be case-insensitive: a member is one identity regardless of the casing presented. The Worker SHALL define a single canonical form — **lowercase** — and SHALL apply it at every boundary that derives a key or path from the username, so the directory key, the invite target, the grant prop, the personal-file path prefix, and the Kroger token key all agree. Specifically:

- The Worker SHALL normalize the grant's `tenantId` to its canonical lowercase form **before** the allowlist (tenant directory) lookup and before constructing any `tenant:<id>` directory key, `users/<id>/` path prefix, or `kroger:refresh:<id>` token key. Normalization before the lookup is the single defensive point: a mixed-case grant SHALL resolve to the same tenant — and the same `users/<id>/` subtree — as the lowercase form, never to a distinct or empty subtree.
- Member provisioning SHALL mint the `tenant:<id>` allowlist entry, the stored record `id`, and the `invite:<code>` target in canonical lowercase form, so the directory key and the data subtree path agree at the source.
- The invite-code identity step SHALL return the canonical lowercase username, so the grant prop derived from it is already normalized.
- Shared-root data (recipes, reference data, discovery sources) does NOT use the username and SHALL be unaffected by this normalization.

A consequence is that a username that differs only by case is NOT a distinct tenant; the directory SHALL NOT hold two entries that collide under canonicalization.

#### Scenario: Mixed-case grant resolves to the lowercase subtree and allowlist entry

- **WHEN** an MCP request arrives whose grant `tenantId` is `Casey` (or `CASEY`) and the allowlist holds the canonical entry `casey`
- **THEN** the Worker normalizes the id to `casey`, confirms it against the allowlist, and resolves the tenant's `userPrefix` to `users/casey` — the same result as a grant of `casey`

#### Scenario: Personal reads and writes target one subtree regardless of casing

- **WHEN** the same member connects once as `casey` and once as `Casey`
- **THEN** both sessions read and write the identical `users/casey/` personal files (pantry, overlay, notes, cooking log, grocery list) and the identical `kroger:refresh:casey` token key — neither casing produces an empty or divergent subtree

#### Scenario: Provisioning mints the canonical lowercase entries

- **WHEN** a member is onboarded with the username `Casey`
- **THEN** the directory entry is stored under `tenant:casey` with record `id` `casey`, and the invite code maps to `casey` — so the minted allowlist key matches the `users/casey/` data subtree

#### Scenario: A case-only variant is not a separate tenant

- **WHEN** resolution is attempted for any casing of an allowlisted username
- **THEN** it canonicalizes to the one lowercase id and resolves to that single tenant; an allowlist that contains the canonical entry SHALL NOT also admit a case-variant as a distinct tenant

## Why

A member onboarded with a non-lowercase username (e.g. `Casey`) had their grant carry that exact casing, so the Worker resolved their personal data to `users/Casey/` while their actual subtree is `users/casey/`. Every prefixed read came back empty and every write landed in a phantom subtree — silent per-tenant data loss — and the `kroger:refresh:<id>` token key had the same latent split. The `multi-tenancy` spec defines username→prefix resolution and the allowlist but is silent on case, leaving the canonical form undefined. (Fix already landed in `90af93f`; this change records the invariant the spec was missing.)

## What Changes

- Establish that tenant usernames are **case-insensitive**, with a single canonical **lowercase** form applied consistently across every boundary that derives a key or path from the id: the `tenant:<id>` directory key, the `invite:<code>` target, the OAuth grant `tenantId` prop, the `users/<id>/` path prefix, and the `kroger:refresh:<id>` Kroger token key.
- The Worker normalizes the grant `tenantId` before the allowlist lookup (the defensive single point) and before building any prefix/key, so a mixed-case grant resolves to the same tenant as the lowercase form rather than to an empty phantom subtree.
- Member provisioning (`data-onboard.yml`) mints the `tenant:<id>` / `invite:<code>` KV entries in lowercase, so the directory key and the data subtree path always agree at the source.
- **Migration**: existing mixed-case KV directory/invite entries must be re-minted to lowercase once by the operator (a mixed-case grant now resolves to `unauthorized` against a lowercase allowlist rather than silently reading empty).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `multi-tenancy`: the tenant-resolution and tenant-directory requirements gain a normative case-insensitivity / canonical-lowercase clause covering the directory key, invite target, grant prop, path prefix, and Kroger token key.

## Impact

- **Code (landed in `90af93f`)**: `src/tenant.ts` (`normalizeTenantId`, `userPrefix`, `kvTenantStore.get`, `tenantFromRecord`, `resolveTenant`, `resolveInvite`), `src/authorize.ts` (grant prop), `src/oauth.ts` (`/oauth/init?tenant=` param), `.github/workflows/data-onboard.yml` (lowercase mint), `test/tenant.test.ts`.
- **Operational**: a one-time KV re-mint of any already-onboarded mixed-case member.
- **No change** to shared-root data (recipes, feeds, discovery files) — it never uses the username.

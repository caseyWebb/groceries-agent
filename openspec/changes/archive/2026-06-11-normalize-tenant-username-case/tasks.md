## 1. Worker normalization (landed in `90af93f`)

- [x] 1.1 Add `normalizeTenantId(id) = id.trim().toLowerCase()` to `src/tenant.ts` as the single canonical-form definition
- [x] 1.2 Build `userPrefix` and `tenantFromRecord` from the normalized id (path prefix + `Tenant.id` always lowercase)
- [x] 1.3 Normalize the lookup key and canonicalize the returned record `id` in `kvTenantStore.get`
- [x] 1.4 Normalize the incoming grant `tenantId` in `resolveTenant` before the directory lookup (the defensive choke point) and have `resolveInvite` return the canonical id
- [x] 1.5 Normalize the resolved username before setting the grant prop in `src/authorize.ts`
- [x] 1.6 Normalize the `/oauth/init?tenant=` query param in `src/oauth.ts` so the `kroger:refresh:<id>` key matches the agent's read key

## 2. Provisioning (landed in `90af93f`)

- [x] 2.1 Lowercase the username when minting `tenant:<id>`, the record `id`, and `invite:<code>` in `.github/workflows/data-onboard.yml`; show the canonical form in the run summary

## 3. Tests & contract (landed in `90af93f`)

- [x] 3.1 Add `test/tenant.test.ts` cases proving a mixed-case grant resolves to `users/casey` + passes the allowlist, plus case-insensitive `kvTenantStore.get`, `userPrefix`, and `resolveInvite`
- [x] 3.2 Confirm `npm run typecheck` and `npm test` pass

## 4. Operator migration (per deployment)

- [ ] 4.1 For each member already onboarded with non-lowercase casing, re-mint canonical lowercase `tenant:<id>` + `invite:<code>` entries and delete the stale mixed-case directory key (`wrangler kv key delete ... "tenant:<MixedCase>"`); have the member re-authorize (and re-run `/oauth/init` if they had Kroger consent)

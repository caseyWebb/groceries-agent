## 1. Fix 1 — Members roster status from OAuth grants, not activity

- [ ] 1.1 Add an `oauthGrantTenantIds(kv)` helper (or equivalent) that pages `OAUTH_KV` with `prefix: "grant:"`, extracts the `userId` segment from each `grant:<userId>:<grantId>` key name, and returns the `Set` of tenant ids with at least one grant — confirm the exact key format against the installed `@cloudflare/workers-oauth-provider` version (currently `0.8.1`) before wiring it in, per design.md Decision 1
- [ ] 1.2 Add a unit test that seeds a synthetic `grant:*` key and asserts the parse extracts the correct tenant id, so a future provider-version bump that changes the key format fails loudly in CI rather than silently misreporting every member as pending
- [ ] 1.3 Wire the new helper into `AdminDeps`/`listTenants` (`src/admin.ts`) as the source of `TenantRosterRow.status`, replacing the `tenant_activity`-row check; keep `tenant_activity` as the source of `joined`/`lastActive` only
- [ ] 1.4 Update `listTenants`'s doc comment and `TenantRosterRow.status`'s field doc to describe the OAuth-grant-derived semantics (mirroring the existing Kroger-linked doc style)
- [ ] 1.5 Update/add tests covering: a connected-but-idle member (grant exists, no/stale `tenant_activity`) reports `active`; a never-connected member reports `pending` even with a stray `tenant_activity` row
- [ ] 1.6 Update `docs/SCHEMAS.md`/`docs/TOOLS.md` (whichever documents `TenantRosterRow`/the admin roster shape) to describe the new status semantics — no field shape change, only derivation semantics

## 2. Fix 2 — Position-based KV namespace colors

- [ ] 2.1 In `src/usage.ts`, separate color assignment from label resolution: compute a sorted-namespace-id → palette-color map once per `mapAccountUsage`/`mapKvHistory` call, cycling the fixed categorical palette by sorted index
- [ ] 2.2 Update `resolveNamespaceLabel` (or its replacement) to return the label only (REST-title removal folds in here per Fix 3 below); thread the position-based color in from the caller instead
- [ ] 2.3 Confirm/update the CSS custom properties (`--kv-kroger`/`--kv-oauth`/`--kv-tenant`/`--kv-unlabeled`) so cycling has a well-defined palette even if a namespace count exceeds the named swatches (design.md Open Question — decide whether `--kv-unlabeled` becomes a 4th cycling color or stays a true last-resort)
- [ ] 2.4 Update/add tests asserting: two namespace ids in the same payload, one with a resolvable label and one without, receive distinct non-generic colors; color assignment is stable given the same sorted id set

## 3. Fix 3 — Namespace labels from deploy config, not a runtime CF lookup

- [ ] 3.1 In `scripts/merge-wrangler-config.mjs`, after computing `out.kv_namespaces`, derive `id:BINDING` pairs for every namespace with a known id and fold them into `out.vars.KV_NAMESPACE_LABELS` (comma-joined, merging with — not overwriting — other operator `vars`)
- [ ] 3.2 Add/update a merge-script unit test (`tests/*.test.mjs`) asserting `KV_NAMESPACE_LABELS` is correctly derived from a merged `kv_namespaces` array, and that it is absent (not an empty string) when no namespace has a provisioned id yet (the cold-start case, design.md Decision 3)
- [ ] 3.3 Delete `fetchNamespaceTitles` from `src/usage.ts`, its call site in `fetchUsage`, and the `restTitles`/`restTitlesPromise` parameters threaded through `mapAccountUsage`/`mapKvHistory`/`resolveNamespaceLabel`
- [ ] 3.4 Update `src/usage.ts`'s module-header comment (the fallback-chain description) to drop step (a) (the REST lookup) and describe the two-step chain: `KV_NAMESPACE_LABELS` → raw id
- [ ] 3.5 Remove/update any test coverage exercising `fetchNamespaceTitles` (its success/403/network-failure paths) since the function no longer exists
- [ ] 3.6 Update `docs/SELF_HOSTING.md` (and `docs/ARCHITECTURE.md`/`docs/TOOLS.md` if they mention the "Workers KV Storage: Read" scope) to drop that scope requirement and describe `KV_NAMESPACE_LABELS` as deploy-derived, not operator-authored, including the cold-start caveat (first deploy ships without it; the next deploy self-heals)

## 4. Fix 4 — Workers-AI 30-day neuron history

- [ ] 4.1 Widen the `aiInferenceAdaptiveGroups` portion of the GraphQL query in `src/usage.ts` from a today-only `datetimeHour_geq/_leq` filter to a `date_geq`/`date_leq` range covering `TRENDS_WINDOW_DAYS`, with `date` added to `dimensions`
- [ ] 4.2 Add a pure `mapAiHistory(rows, windowStartDay, windowEndDay)` mirroring `mapKvHistory`'s zero-fill-every-day behavior, returning a `{ window_days, days: { day, neurons }[] }` shape
- [ ] 4.3 Add the new `history` field to `UsageResult.ai` and wire `fetchUsage` to compute and attach it (same widened-response-reused-not-a-second-query pattern the KV history already follows)
- [ ] 4.4 Add unit tests for `mapAiHistory`: ascending day order, zero-fill for a day with no rows, correct aggregation across models per day
- [ ] 4.5 In `src/admin/pages/usage.tsx`, render the neuron history as a sparkline next to `NeuronMeter` (reusing the existing sparkline-tooltip primitive / `SparklineTrack` styling the KV meter uses), and delete the "Today's value only — Cloudflare's Workers AI analytics do not expose a confirmed daily-history series" note and its module-level comment justifying the omission

## 5. Cross-cutting

- [ ] 5.1 Run `aubr typecheck` and `aubr test` after each fix lands to keep the branch green incrementally
- [ ] 5.2 Confirm no `docs/TOOLS.md`/`docs/SCHEMAS.md`/`docs/ARCHITECTURE.md` drift remains once all four fixes are implemented (per the "keep contract docs in lockstep, same pass" rule)
- [ ] 5.3 Note in the PR description that Data > Stores being empty is confirmed not-a-bug (zero rows in the operator's `stores` table) and is out of scope for this change

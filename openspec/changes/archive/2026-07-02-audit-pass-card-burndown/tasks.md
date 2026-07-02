# Tasks: audit-pass-card-burndown

## 1. Reader (`packages/worker/src/audit-admin.ts` + job modules)

- [x] 1.1 Export `NORMALIZE_JOB = "ingredient-normalize"` from `ingredient-normalize.ts` and replace the four inline job-name literals with it (no behavior change).
- [x] 1.2 Generalize `backlogSeries(current, runs)` with an optional summed-fields param (default `["audited"]`); keep existing callers unchanged.
- [x] 1.3 Add the gauge model to `audit-admin.ts`: `PassGauge`, `DisjunctionGauge`, `AuditGauges`, `AUDIT_GAUGE_CAP = 200`; `AuditSurface` gains `gauges: AuditGauges`.
- [x] 1.4 Add pure derivations: sku series from the model's sku ticks (`remaining_after(k) = pending + Σ worked after k`), disjunction live-count predicate over `IdentitySourceRow[]` (live ∧ concrete ∧ auto ∧ disjunctive base), disjunction gauge (count + series from `disjunction*` run counters + short-labeled chips + lastRun), and capped mapping for sku/replay counts.
- [x] 1.5 Extend `readAuditSurface` fan-out: corpus reads (`readResolver`, `readIdentitySources`, `readAliasTargets`) + `sku_cache` SELECT → pure planners (`planSkuRekey` + `planAliasRetarget`) for the sku pending count; `readUnreplayedEdgeDrops(env, AUDIT_GAUGE_CAP + 1)` for the replay gauge; `readJobRuns(env, NORMALIZE_JOB, AUDIT_RUN_WINDOW)` for the disjunction trend. Failures behave like the existing count reads (real `storage_error`); `readAuditObservability` and the Status path stay untouched.

## 2. View (`packages/worker/src/admin/pages/audits.tsx` + `styles.css`)

- [x] 2.1 `PassCard`: add the per-pass burndown row (count with green-zero/`+`-capped treatment, backlog label, compact `BurndownSpark` in the pass's tone) and drive the state chip from the gauge (`converged = count === 0 && !capped`); alias/edge gauges assembled inline from `s.backlog` (no new fields); worked-spark caption unchanged.
- [x] 2.2 Edge card: replay line (`au-pass-foot` treatment) — pending count while drops remain, explicit done-state at zero.
- [x] 2.3 Disjunction-sweep card: compact fourth `au-pass` card (live count + spark + settled/auditing chip + `disjunction*` chips + normalize-job last-run foot); wire `gauges` through `normalize.tsx` → `AuditsTab`.
- [x] 2.4 `styles.css`: `au-pass-grid` → `repeat(auto-fit, minmax(200px, 1fr))`; add layout-only `.au-pass-burn` + `.au-burn-v.sm` (existing tokens, `au-*` namespace only).

## 3. Unit tests (`packages/worker/test/audit-admin.test.ts`)

- [x] 3.1 Cover `backlogSeries` field-list generalization, the sku tick back-summation, the disjunction live-count predicate (auto/human, concrete/abstract, disjunctive/plain, live/merged rows), and the capped mapping.
- [x] 3.2 Extend the seeded reader test: `sku_cache`/identity/alias fixtures for the sku gauge, an un-replayed `edge_drop` row for the replay gauge, `ingredient-normalize` runs with `disjunction*` counters for the trend; assert `readAuditSurface().gauges`.

## 4. Playwright (`packages/worker/admin/visual/`)

- [x] 4.1 `seed.mjs`: add `ingredient-normalize` `job_runs` with draining `disjunction*` counters; verify the seed yields alias card converging (backlog 1), sku card converged (empty plan), replay pending 1 (row 9103); export the expectations via `SEED`.
- [x] 4.2 `normalize.page.ts`: extend `expectAuditsSurface` with the disjunction card; add per-card burndown/state assertions (card-scoped chip text + backlog count) and a replay-gauge assertion.
- [x] 4.3 `smoke.spec.ts` audits test: assert one converging card and one converged card, the replay line, and the disjunction card; re-capture `normalize-audits` (ASCII name).
- [x] 4.4 Run `aubr test:admin` (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) green; review screenshots.

## 5. Battery & validation

- [x] 5.1 `aubr typecheck` (all three passes) + `aubr test` green.
- [x] 5.2 `npx --yes openspec validate audit-pass-card-burndown` passes; docs unchanged (reader/display-side — confirm no summary-shape or tool-contract drift).

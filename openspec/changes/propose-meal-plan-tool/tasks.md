## 1. Pure algorithms (spike → src, no infra)

- [x] 1.1 Add `src/diversify.ts` — a pure `diversifySelect(candidates, n, seed, params)`: MMR (relevance = the `rankCandidates` blended score, normalized; diversity = recipe→recipe cosine) + facet-spread caps (protein/cuisine/course), seeded via a shared `src/rng.ts` `mulberry32` (no `Math.random`). Selects only over gate survivors, never re-admits a gated recipe, and returns fewer than `n` when caps/pool exhaust (the short-slot case Phase 3.3 surfaces). Also exports `weekDiversity` for the tool's `variety` diagnostics.
- [x] 1.2 Add `src/night-vibe-schedule.ts` — `debt(lastSatisfied, period, now)`, the bounded monotonic `debtCurve`, `weatherMultiplier`, `computeWeights`, `weightedSampleWithoutReplacement` (Efraimidis–Spirakis, seeded), and `sampleWeek(...)` with pinned/overdue force-placement, over-subscription rollover, and the spike's **weather reserve** (`minSampledSlots` — overdue placement yields ≥1 slot to weather-weighted sampling; pinned stay sticky).
- [x] 1.3 Unit tests (`test/diversify.test.ts`, `test/night-vibe-schedule.test.ts`, 15 passing): λ=1 ⇒ top-K; lower λ ⇒ more variety within the gate; facet caps hold; null-facet uncapped; seed determinism + cross-seed variation; short-slot/empty-pool; debt monotonicity + cap; weather multiplier; pinned force-placement; over-subscription rollover; weather-reserve under backlog; sampling without replacement.
- [x] 1.4 Folded the spike's measured defaults into the compiled constants (`DEFAULT_DIVERSIFY_PARAMS`, `DEFAULT_CADENCE_PARAMS`) with the rationale in the module doc comments; the `docs/ARCHITECTURE.md` two-level-planner prose rides Phase 3.5 (documenting the planner alongside the tool that makes it a real architectural surface, rather than a set of unwired pure functions).

## 2. Night-vibe palette store + embedding reconcile

- [x] 2.1 Migration `migrations/d1/0025_night_vibes.sql`: per-tenant `night_vibes` (tenant, id, vibe, facets JSON, cadence_days, pinned, base_weight, weather_affinity/antipathy JSON, season JSON, timestamps) + sibling `night_vibe_derived` (`vibe_hash`-gated embedding), mirroring `taste_derived`. Applies cleanly (`wrangler d1 migrations apply DB --local`).
- [x] 2.2 `src/night-vibe-db.ts` (through `src/db.ts`) + `src/night-vibe-tools.ts` CRUD tools (`list_/add_/update_/remove_night_vibe`) — per-tenant, structured errors, throw-free; registered in `buildServer`.
- [x] 2.3 `src/night-vibe-vector.ts`: `reconcileNightVibeVectors` (hash-gated embed on text change, prune on delete) + `runNightVibeVectorJob` wired into `scheduled()` phase 3; registered as the `night-vibe-embed` `job_health`/`HEALTH_JOBS` job.
- [x] 2.4 `test/night-vibe-vector.test.ts` (5 passing): hash-gate no-op; re-embed on change; new vibe; prune-on-delete; mixed pass.

## 3. `propose_meal_plan` tool

- [ ] 3.1 `src/meal-plan-proposal.ts` — pure composition: weather-weighted seeded slot sampling (Level 1) → per-slot `filterRecipes` + `rankCandidates` + `diversifySelect` (Level 2) → deterministic plate composition (pairs_with, then `side_search_terms` retrieval with `course: side`; perishable-waste + meal-prep flags; open-world sides flagged, not fabricated).
- [ ] 3.2 Tool wiring: accept `{ nights, seed, lock, exclude, nudges, freeform?, seed_slugs?, boost_ingredients? }`; return the structured proposal (`plan[]` with `main`/`sides`/`uses_perishables`/`flags`/`why[]`, `unplaced_new_for_me`, `variety`, `diagnostics`). At most one embed (freeform only); no implicit writes.
- [ ] 3.3 Empty/thin-slot handling: surface an explicit empty slot with a reason; the rest of the week still returns.
- [ ] 3.4 Tests: two-level output shape; no-AI path when no freeform; locks survive a re-roll; boost bias without gate violation; empty-slot surfacing.
- [ ] 3.5 Docs lockstep: `docs/TOOLS.md` (the tool contract), `docs/SCHEMAS.md` (palette + proposal shapes), `docs/ARCHITECTURE.md` (the two-level planner + the model-frequency gradient).

## 4. Slot provenance

- [x] 4.1 Migration `0026_slot_provenance.sql`: additive `meal_plan.from_vibe` + `cooking_log.satisfied_vibe` (both nullable) + `idx_cooking_log_satisfied_vibe`. Applies cleanly.
- [x] 4.2 `src/meal-plan.ts` (PlannedItem/MealPlanOp/coercePlanned/applyMealPlanOps) + `src/session-db.ts` (row decode + `mealPlanUpsertStmt`) + `update_meal_plan` op schema: accept/preserve `from_vibe`; the `recipe` slug invariant is unchanged (pure test in `test/meal-plan.test.ts`).
- [x] 4.3 `log_cooked` (`src/cooking-write.ts`): reads the planned row's `from_vibe` and sets `satisfied_vibe` on the cooking-log INSERT in the same batch as the plan-clear; off-plan cooks leave it null (test in `test/cooking-write.test.ts` + `fake-d1` LOWER(recipe) support).
- [x] 4.4 `readVibeLastSatisfied` (`MAX(date)` over `satisfied_vibe`) in `src/night-vibe-db.ts` — consumed by the proposal's debt read (Phase 3).
- [x] 4.5 Docs lockstep: `docs/SCHEMAS.md` (both columns), `docs/TOOLS.md` (`update_meal_plan` from_vibe note).

## 5. Profile reconciliation

- [ ] 5.1 Migration `pending_proposals` (per-member: kind, payload JSON, rationale, evidence JSON, status, producer, timestamps).
- [ ] 5.2 Deterministic **signal cron** pass: per-member cadence debt, cluster/taste drift, prune candidates (arithmetic + at most small-model/k-means; no large model); wire into `scheduled()`; `job_health` row.
- [ ] 5.3 Confirm/enqueue tools: member-facing `list_proposals` / `confirm_proposal` (accept applies the diff; reject records a rejection signal); an enqueue path the producers share.
- [ ] 5.4 Routine synthesis (server-side edge model): read signals → enqueue high-confidence proposals.
- [ ] 5.5 `isOperator` cross-tenant surface: resolve the flag before any tool runs; expose operator-only read-signal-bundle + enqueue-per-member tools; deny non-operators cross-tenant reach.
- [ ] 5.6 Operator-frontier reconcile: an operator skill/flow driving the cross-tenant tools from the operator's Claude; an admin-panel trigger/nudge.
- [ ] 5.7 Extend `retrospective` (`AGENT_INSTRUCTIONS.md` `cooking-retrospective` flow) to surface and confirm pending proposals; regenerate the plugin (`aubr build:plugin`). *(Separable last step — the tool + web app do not depend on it.)*
- [ ] 5.8 Docs lockstep: `docs/ARCHITECTURE.md` (stated-vs-revealed loop, the signal cron, the pluggable synthesis tiers, the operator surface), `docs/TOOLS.md` (the proposal + operator tools), `docs/SCHEMAS.md` (`pending_proposals`).

## 6. Verify

- [ ] 6.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` — all green.
- [ ] 6.2 Apply the new migrations locally (`wrangler d1 migrations apply DB --local`) and exercise `propose_meal_plan` end-to-end against a seeded local corpus (MCP Inspector or a dev harness).
- [ ] 6.3 `openspec validate "propose-meal-plan-tool"` passes.

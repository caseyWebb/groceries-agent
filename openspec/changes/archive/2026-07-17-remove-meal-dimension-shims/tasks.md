# Tasks — remove-meal-dimension-shims

## 1. D1 migration

- [x] 1.1 Add `packages/worker/migrations/d1/0063_drop_meal_dimension_columns.sql`: plain `ALTER TABLE profile DROP COLUMN default_cooking_nights;` / `DROP COLUMN lunch_strategy;` / `DROP COLUMN ready_to_eat_default_action;` (the `0012`/`0013` column-drop idiom — no table rebuild; see design.md's Decisions). Header comment cites the verified production convergence.

## 2. Tool + route surface removal

- [x] 2.1 `packages/worker/src/night-vibe-tools.ts`: unregister `add_night_vibe` (the `server.registerTool("add_night_vibe", ...)` line); drop its now-inert `aliasDescription`/`MEAL_ENUM` usage if `aliasDescription` has no other caller; update the module-doc comment (currently references the `remove-meal-dimension-shims` gate by name) and the `registerNightVibeTools` inline comment.
- [x] 2.2 `packages/worker/src/api/vibes.ts`: remove the `.post("/vibes/suggest", ...)` route entirely; update the module-doc comment's "RETIRED suggest trigger" paragraph (the route no longer exists at all, not just a 410 stub).
- [x] 2.3 `packages/worker/src/meal-plan-proposal-tool.ts`: remove `ProposeInput.nights`, the `PROPOSE_INPUT_SHAPE.nights` zod field, the `nights` destructure, the `countFor` dinner-alias branch (`if (meal === "dinner" && typeof nights === "number") return nights;`), the empty-palette short-circuit's `diagnostics.nights` key, and the final result's `diagnostics.nights` key; update the surrounding comments (the `ProposeMealsInput`/`ProposeInput`/`ProposeResult` doc comments, the `countFor` comment, the `proposalCtx.requestedNights` comment) and the tool's registered description string (drops the "legacy nights count" and "diagnostics.nights stays the dinner alias" clauses).
- [x] 2.4 `packages/worker/src/meal-plan-proposal.ts`: remove `nights` from `ProposalResult.diagnostics`'s type and from the `assembleProposal` diagnostics object it builds (`requestedNights`/`ctx.requestedNights` may become entirely unused once `diagnostics.nights` is gone — remove `ProposalCtx.requestedNights` too if nothing else reads it, or confirm and note a remaining reader).

## 3. Preferences + profile

- [x] 3.1 `packages/worker/src/preferences.ts`: delete `applyRetiredKeyShim` and `RETIRED_PREFERENCE_KEYS` (both retired-key-drop and the `default_cooking_nights` alias-merge fall through to the existing `rejectUnknownPatchKeys` for free once removed); simplify `effectiveCadenceCount`'s `meal === "dinner"` branch to return a bare `5` (drop the `prefs?.default_cooking_nights` read); remove `exportPreferences`'s `out.default_cooking_nights = ...` mirror line and its now-pointless `RETIRED_PREFERENCE_KEYS` delete loop; update the module's doc comments accordingly.
- [x] 3.2 `packages/worker/src/write-tools.ts`: `applyPreferencesPatch` calls `rejectUnknownPatchKeys(patch)` directly (drop the Stage-0 `applyRetiredKeyShim` call and its import); update the function's doc comment.
- [x] 3.3 `packages/worker/src/profile-db.ts`: drop `default_cooking_nights` / `lunch_strategy` / `ready_to_eat_default_action` from `ProfileRow`, `PROFILE_SELECT`, and `assemblePreferences`'s three corresponding read-mirroring blocks.
- [x] 3.4 `packages/worker/src/tools.ts`: update `assembleUserProfile`'s doc comment (drop the "one deprecation window" / mirror language now that `exportPreferences` no longer mirrors anything).

## 4. Dead-code removal (pref-retirement)

- [x] 4.1 Delete `packages/worker/src/pref-retirement.ts` — its convergence job is complete (verified) and its `SELECT` would fail against the columns task 1.1 drops.
- [x] 4.2 `packages/worker/src/index.ts`: remove the `import { runPrefRetirementSeedJob } from "./pref-retirement.js"` and the `runPrefRetirementSeedJob(env)` entry from the `scheduled()` phase-5 `Promise.allSettled` array; update the phase-5 explanatory comment (drops the pref-retirement clause).
- [x] 4.3 Delete `packages/worker/test/pref-retirement.test.ts` (its fixtures seed rows through the columns task 1.1 drops — its subject no longer exists). Confirm `packages/worker/test/meal-dimension-migration.test.ts` needs no change (it applies migrations only through `0052` via its own `applyBefore` helper, never the full chain — verified during planning).

## 5. Contract + widget + app (the diagnostics.nights / request.nights blast radius)

- [x] 5.1 `packages/contract/src/propose-card.ts`: remove `ProposeCardRequest.nights` and `ProposeCardData.diagnostics.nights` (and their doc comments).
- [x] 5.2 `packages/worker/src/meal-plan-widget.ts`: `toRequest()` stops setting `nights: result.diagnostics.nights` (keep `meals`); update its doc comment and the `display_meal_plan` tool description string's "nights" mentions.
- [x] 5.3 `packages/ui/src/propose-orchestration.ts`: remove `ProposeSession.nights` and `ProposeSessionRequest.nights`; change `defaultProposeSession`'s parameter to a plain dinner-count seed (no wire-field name coupling) and `proposeSessionFromRequest`'s `req.meals?.dinner ?? req.nights` to `req.meals?.dinner ?? 0`; **bump `PROPOSE_SESSION_VERSION` from 4 to 5** (the persisted session shape changes — a stale localStorage blob must be discarded, per the module's own contract).
- [x] 5.4 `packages/app/src/routes/_app.propose.tsx`: change `defaultNights`'s source at lines ~53-54 from `prefs.default_cooking_nights` to `prefs.cadence?.dinner` (same `?? 3` fallback shape). Leave `packages/ui/src/propose-controller.ts`'s `defaultNights` option name and `packages/ui/src/components/propose.tsx` / `packages/widgets/src/ProposeCard.tsx`'s `VarietyBar` `nights` display prop untouched — verified unrelated to the wire alias (see design.md).

## 6. Satellite version bump

- [x] 6.1 Bump `packages/satellite/package.json`'s `version` (currently `0.1.22`) — required because this change edits `packages/contract/**` (task 5.1), which trips the CI `satellite-version` gate (`.github/workflows/ci.yml`) even though no `packages/satellite` code changes.

## 7. Tests

- [x] 7.1 `packages/worker/test/mcp-tool-gating.test.ts`: remove `"add_night_vibe"` from `MEMBER_BASE_SET`; update its explanatory comment.
- [x] 7.2 `packages/worker/test/preferences.test.ts`: remove/replace the `applyRetiredKeyShim` tests (retired-key-drop, `default_cooking_nights` alias) with assertions that `rejectUnknownPatchKeys` (or the full `applyPreferencesPatch` path) rejects both; update the `effectiveCadenceCount` tests that pass `default_cooking_nights` expecting it to win (it no longer does — fallback is always `5`); update the `exportPreferences` test (no more `default_cooking_nights` mirror).
- [x] 7.3 `packages/worker/test/write-tools.test.ts`: replace the two `update_preferences` shim tests (~lines 1033, 1043) with unknown-key rejection assertions for `lunch_strategy` and `default_cooking_nights`.
- [x] 7.4 `packages/worker/test/meal-plan-proposal.test.ts`, `test/meal-plan-widget.test.ts`, `test/api-member.test.ts`, `test/profile-db.test.ts`: audit and update any assertion referencing `nights`, `diagnostics.nights`, or `default_cooking_nights` (surfaced by a repo-wide grep during planning; exact line numbers to be confirmed at implementation time). Also updated `packages/worker/test/meal-plan-propose-op.test.ts` (the actual `runProposeMealPlan` test file — heaviest `nights` user in the suite; not separately named in this task but squarely in scope).
- [x] 7.5 `packages/ui/src/propose-orchestration.test.ts`, `packages/ui/src/propose-controller.test.ts`: update for the `ProposeSession`/`ProposeSessionRequest` shape change and the `PROPOSE_SESSION_VERSION` bump. (`propose-controller.test.ts` needed no change — it never referenced `nights` or the version constant directly; its `defaultProposeSession(n, seed)` calls are positional and unaffected by the parameter rename.)
- [x] 7.6 Add/confirm a rejection test for `propose_meal_plan`/`display_meal_plan`/`POST /api/propose` receiving `nights` (unknown-key `validation_failed`/schema rejection).
- [x] 7.7 Add/confirm a migration test (or extend an existing D1-migration-chain test) asserting `default_cooking_nights`/`lunch_strategy`/`ready_to_eat_default_action` are absent from `profile`'s schema after migration `0063`.

## 8. Docs lockstep

- [x] 8.1 `docs/TOOLS.md`: remove the six meal-dimension deprecation rows (`update_preferences` × `default_cooking_nights`, `update_preferences` × `lunch_strategy`/`ready_to_eat_default_action`, `add_night_vibe`, `propose_meal_plan`/`display_meal_plan` × `nights`, `read_user_profile` × the mirror, `POST /api/vibes/suggest`) and the "Removal condition (the meal-dimension rows)" paragraph; update affected tool sections' prose (the `propose_meal_plan`/`display_meal_plan` nights-alias mentions, the `read_user_profile` mirror note, the `update_preferences` window notes, the registration-model section if it names `add_night_vibe`).
- [x] 8.2 `docs/SCHEMAS.md`: drop `default_cooking_nights` / `lunch_strategy` / `ready_to_eat_default_action` from the `profile` table's documented column list.

## 9. Verification

- [x] 9.1 `aubr typecheck`
- [x] 9.2 `aubr test` (worker suite) and the root/tooling suites touched by `packages/ui`/`packages/contract` changes
- [x] 9.3 `aubr build:plugin -- --check` (persona doesn't mention `nights`/`add_night_vibe`/the retired keys — verified during planning; confirm no drift)
- [x] 9.4 `OPENSPEC_TELEMETRY=0 openspec validate remove-meal-dimension-shims --strict`

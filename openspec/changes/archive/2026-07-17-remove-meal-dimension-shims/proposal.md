# remove-meal-dimension-shims

## Why

`docs/TOOLS.md`'s "Removal condition (the meal-dimension rows)" paragraph charters this cleanup: the `add_night_vibe` alias, the `nights`/`diagnostics.nights` alias, the `default_cooking_nights` write alias + read mirror, the `lunch_strategy`/`ready_to_eat_default_action` retired-key accept-and-drop, and the `/api/vibes/suggest` 410 stub all fall once **both** hold — a subsequent plugin publish plus ≥30 days since the meal-dimension publish (the alias window) — **and** the frozen `profile.default_cooking_nights` / `lunch_strategy` / `ready_to_eat_default_action` columns drop once the retired pair is verified NULL everywhere (the pref-retirement pass's convergence predicate).

Tonight's operator-directed production query confirms convergence: `lunch_strategy` and `ready_to_eat_default_action` are NULL on all 4 profile rows; `default_cooking_nights` is set on 2 rows, and **both** of those also carry authoritative `cadence` (the read-time derivation already prefers `cadence[meal]` over the frozen scalar, so the mirror was already inert on those rows). The data gate is satisfied. The operator has waived the remaining window conditions — three-member deployment, operator-assisted — the same waiver posture `close-cull-windows` established for its own (unrelated) alias set. `close-cull-windows`' design explicitly carves this cleanup out as a Non-Goal, gated on data convergence rather than a time window; that gate has now cleared.

## What Changes

- **BREAKING** The `add_night_vibe` dispatch alias unregisters (`packages/worker/src/night-vibe-tools.ts`); a stale call gets the generic unknown-tool rejection. `add_meal_vibe` is unaffected.
- **BREAKING** The `nights` request alias on `propose_meal_plan` / `display_meal_plan` / `POST /api/propose` is removed — an unknown-key rejection; `meals.dinner` is its sole successor. `diagnostics.nights` leaves the result; `diagnostics.meals.dinner.requested` is its sole successor.
- **BREAKING** `update_preferences`'s `default_cooking_nights` write alias (merged as `cadence.dinner`) and its `lunch_strategy` / `ready_to_eat_default_action` accept-and-drop both close to the generic unknown-key rejection.
- **BREAKING** `read_user_profile`'s derived `preferences.default_cooking_nights` mirror leaves the export; `preferences.cadence` is the sole cadence read.
- **BREAKING** `POST /api/vibes/suggest`'s pinned 410 stub is removed — the route no longer exists (an unrecognized-API 404, like any other unmounted route).
- The read-time cadence derivation's `default_cooking_nights ?? 5` fallback simplifies to a fixed `5` (`effectiveCadenceCount`).
- A D1 migration drops the frozen `profile.default_cooking_nights`, `profile.lunch_strategy`, and `profile.ready_to_eat_default_action` columns.
- The now-columnless `pref-retirement` convergence pass (`runPrefRetirementSeedJob`, its `scheduled()` registration, and its test) is removed outright: its own `SELECT` names the two dropped columns by name, so leaving it registered would fail every cron tick once the migration lands. Its job is done — see Why.
- `packages/contract`'s `ProposeCardData` loses `request.nights` and `diagnostics.nights`, which cascades through `packages/worker/src/meal-plan-widget.ts` (`toRequest`), `packages/ui`'s shared propose session/orchestration (`ProposeSession`/`ProposeSessionRequest`, `PROPOSE_SESSION_VERSION` bump), and `packages/app`'s propose route's default-session seed. Because `packages/contract` changes, the satellite-version CI gate trips even though `packages/satellite` code itself is untouched — its `package.json` version bumps in the same PR.
- `docs/TOOLS.md`'s meal-dimension deprecation rows and the "Removal condition (the meal-dimension rows)" paragraph leave the table (implementation-phase doc edit, not part of this planning change).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meal-plan-proposal` — the `nights` alias and `diagnostics.nights` are removed from the two-level proposal contract; the cadence default-chain derivation drops its frozen-column fallback.
- `meal-vibe-palette` — the `add_night_vibe` dispatch alias closes; the deprecated-alias requirement it and four never-materialized siblings occupied is removed.
- `mcp-tool-gating` — the member-surface enumeration drops its `add_night_vibe`-family in-flight clause.
- `data-write-tools` — `update_preferences`'s defined top-level surface drops the three retired keys (and is corrected to name `cadence`/`curated_hide`, already-defined keys the surface list had drifted out of sync with); both retired-key shims become unknown-key rejections.
- `planning-cadence` — the `default_cooking_nights` write alias and read-time mirror are retired from the per-meal cadence requirement; the fallback derivation is fixed at `5`.
- `member-app-propose` — the propose endpoint's accepted-input description drops the window-scoped `nights` alias clause.
- `profile-reconciliation` — the pref-retirement seeding pass's requirement is removed; its convergence job is complete and its code is deleted rather than left pointed at dropped columns.

## Impact

- **Worker source**: `packages/worker/src/night-vibe-tools.ts`, `meal-plan-proposal-tool.ts`, `meal-plan-proposal.ts`, `meal-plan-widget.ts`, `preferences.ts`, `write-tools.ts`, `profile-db.ts`, `tools.ts`, `api/vibes.ts`, `index.ts` (drops the `pref-retirement` import + `scheduled()` call), `pref-retirement.ts` (deleted).
- **D1**: new migration `0063_drop_meal_dimension_columns.sql`.
- **Contract + UI + app**: `packages/contract/src/propose-card.ts`, `packages/ui/src/propose-orchestration.ts` (+ `PROPOSE_SESSION_VERSION` bump), `packages/app/src/routes/_app.propose.tsx`.
- **Satellite**: `packages/satellite/package.json` version bump (contract-change gate).
- **Tests**: `packages/worker/test/mcp-tool-gating.test.ts`, `preferences.test.ts`, `write-tools.test.ts`, `meal-plan-proposal.test.ts`, `meal-plan-widget.test.ts`, `api-member.test.ts`, `profile-db.test.ts`; `packages/worker/test/pref-retirement.test.ts` (deleted); `packages/ui/src/propose-orchestration.test.ts`, `propose-controller.test.ts`. `packages/worker/test/meal-dimension-migration.test.ts` is unaffected (it applies migrations only through `0052`, not the full chain).
- **Docs**: `docs/TOOLS.md` (deprecation rows + removal-condition paragraph), `docs/SCHEMAS.md` (the `profile` table's column list) — implementation-phase, not part of this planning change.

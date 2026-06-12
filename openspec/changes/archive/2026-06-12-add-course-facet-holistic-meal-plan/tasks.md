## 1. Index build — `course` in, `standalone` out

- [x] 1.1 `scripts/build-indexes.mjs`: project `course` into each recipe index entry, normalized to a **lowercased, trimmed string array** (accept source `string | string[]`, default `[]` when absent) — beside the existing `pairs_with` / `perishable_ingredients` / `requires_equipment` projections
- [x] 1.2 `scripts/build-indexes.mjs`: add a `course` **shape** hard-fail (present but not a string or array-of-strings → non-zero exit naming value/recipe/field); do **not** check `course` values against any set (open-vocabulary)
- [x] 1.3 `scripts/build-indexes.mjs`: remove the `standalone` non-boolean hard-fail and stop projecting `standalone` (a lingering `standalone` field must be ignored, never fail the build)
- [x] 1.4 `scripts/build-indexes.mjs`: in the `meal_plan.toml` validation, accept an optional `sides` on `[[planned]]` rows (present → array of strings, else hard-fail) and do **not** slug-resolve `sides`
- [x] 1.5 Update `scripts/build-indexes` fixtures/tests: course scalar→array + lowercase/trim, absent→`[]` warn-free, bad-shape course fails, planned `sides` array passes / non-array fails / free-text side is not slug-resolved, lingering `standalone` no longer fails

## 2. Worker structural validation (`src/validate.ts`)

- [x] 2.1 Add a `course` shape-only check (string or array-of-strings) parallel to `domain` / `pairs_with`; remove the `standalone` boolean check
- [x] 2.2 In the `meal_plan.toml` branch, accept an optional `sides` (array of strings) on planned rows
- [x] 2.3 Update `src/validate.ts` tests: course shape pass/fail, standalone-check removed, planned `sides` pass/fail

## 3. Read tool — `list_recipes` course filter (`src/recipes.ts`, `src/tools.ts`)

- [x] 3.1 `src/recipes.ts`: add `course?: string` to `RecipeFilters`; in `filterRecipes`, pass a recipe when its (array-normalized) `course` **includes** the requested value (containment, not equality); treat a scalar indexed `course` defensively as a one-element array
- [x] 3.2 `src/tools.ts`: expose `course` on the `list_recipes` filter schema; drop the `standalone` mention from the `read_recipe` / `list_recipes` tool descriptions
- [x] 3.3 `src/recipes.ts` tests: course containment match (incl. dual-use `[main, side]` matching both), open value not rejected, course ANDed with other filters

## 4. Write path — open-world `sides` on planned rows (`src/meal-plan.ts`, commit)

- [x] 4.1 `src/meal-plan.ts`: add optional `sides?: string[]` to `PlannedItem` and `MealPlanOp`; `coercePlanned` reads `sides`; `applyMealPlanOps` writes/merges `sides` on an `add` upsert (parallel to `planned_for`)
- [x] 4.2 Thread `sides` through the `meal_plan_ops` `add` path in the commit/write tool (`src/commit.ts` / `src/write-tools.ts`) so it persists onto the row
- [x] 4.3 `src/meal-plan.ts` tests: add op persists `sides`, re-add merges `sides` onto the existing row, remove drops the row + its `sides`

## 5. Docs (same-pass, no drift)

- [x] 5.1 `docs/SCHEMAS.md`: recipe frontmatter — add `course` (open-vocab, array-normalized, classified at import; convention `main | side | dessert | breakfast`, extend freely), remove `standalone` (field + its note); `meal_plan.toml` — add optional `sides` (free-text open-world sides) + note
- [x] 5.2 `docs/TOOLS.md`: `list_recipes` gains the `course` containment filter; remove `standalone` from the `read_recipe` / `list_recipes` notes; note `meal_plan_ops` carries optional `sides`
- [x] 5.3 `docs/ARCHITECTURE.md`: note the `course` facet and the two-tier (corpus / open-world) side model where the recipe model / meal-plan flow is described (light touch)

## 6. Agent surface (`AGENT_INSTRUCTIONS.md`) + plugin rebuild

- [x] 6.1 Meal-plan flow: add `list_recipes({ status: "active" })` to the up-front parallel batch (the single faceted load, bucketed by `course`); fold side-rounding into the holistic reasoning pass (menu + corpus/open-world sides + expiry-matching + inventory subs); remove the `standalone` gate (infer instead); keep `kroger_prices` cost/confirm last
- [x] 6.2 Meal-plan capture: corpus sides → own `[[planned]]` slug row; open-world sides → `sides[]` on the main's row + grocery rows with `source=menu`, `for_recipes=[]`, `note`
- [x] 6.3 Import-recipe flow: classify `course` alongside `protein`/`cuisine`/`perishable_ingredients` (open-vocab, convention-first, multiple values allowed for dual-use)
- [x] 6.4 `npm run build:plugin` to regenerate the `plugin/` bundle from `AGENT_INSTRUCTIONS.md` (never hand-edit `plugin/`)
- [x] 6.5 Check `docs/data-template` submodule for any recipe carrying `standalone`; drop it and bump the submodule ref if so

## 7. Verify

- [x] 7.1 `npm test` green across build-indexes / validate / recipes / meal-plan suites
- [x] 7.2 Regenerate `_indexes/recipes.json` against fixtures; confirm `course` arrays present, `standalone` absent, output still deterministic (no spurious diff on re-run)
- [ ] 7.3 Re-run the menu-generation smoke-test rubric for the open-ended and recipe-seeded seeds: verify one faceted load (no separate side-search call), two-tier side capture, and cart-untouched-on-agreement

## 8. Deploy (operator)

- [x] 8.1 Push Worker changes (`src/**`, `scripts/**`, `wrangler.jsonc`, lockfile) to `main`
- [ ] 8.2 Operator kicks the deploy from the private data repo (`gh workflow run deploy.yml --repo <data-repo>`)
- [ ] 8.3 (Out of scope here — note for the operator) backfill `course` across the existing corpus as a separate data-repo pass; until then un-coursed recipes are simply un-bucketed

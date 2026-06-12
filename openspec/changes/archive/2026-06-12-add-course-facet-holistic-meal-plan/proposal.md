## Why

The corpus has no first-class answer to *"is this recipe a main or a side?"* — a "side" is only inferable from being referenced in some main's `pairs_with`, so the menu flow can't ask `list_recipes` for sides and instead bolts side-sourcing on as a separate plate-rounding phase that guesses plate fit over the whole active corpus. Adding a lightweight `course` facet lets the meal-plan flow load mains and sides together in one faceted call and reason over the whole plate (menu + sides + expiry-matching + inventory subs) at once, instead of in sequenced passes. At the same time `standalone` has become a cache of a cheap, recomputable inference — the rework folds the "does this main want a side?" judgment into the main reasoning pass, making the persisted flag vestigial.

## What Changes

- **Add `course`** — an open-vocabulary recipe facet (`main | side | dessert | breakfast`, extend freely; e.g. `sauce`, `baked_good`). Stored as `string | string[]`, normalized to a lowercased+trimmed string array in the index. **Shape-validated only**, like grocery-list `domain` — no controlled set, no build hard-fail on the *value*, no add-category tool (a category exists the moment a recipe is tagged with it; the corpus is self-describing). Classified **at import** alongside `protein`/`cuisine`/`perishable_ingredients`. A list handles dual-use dishes (`course: [main, side]`) for free.
- **`list_recipes` gains a `course` filter** — scalar **containment** (`{ course: "side" }` matches any recipe whose course list includes `side`). The return stays **flat**: `course` rides each entry's frontmatter; no grouped/faceted envelope.
- **BREAKING: remove `standalone`** — drop its build hard-fail and Worker shape-check, its index projection, its warn-only default, the menu-generation requirement, and the flow step. **Keep `pairs_with`** (a genuine learned main→side affinity that `course` can't reconstruct). Backfill is unnecessary — absence is already the unset default.
- **Rework the meal-plan flow** — ONE faceted load (`list_recipes(status: active)` bucketed by `course`, in the same parallel batch as `read_pantry`/prefs/taste/RTE/flyer), then **holistic reasoning** over the loaded set + pantry (menu, sides, expiry-matching as judgment over `added_at`/`category`, inventory subs), THEN cost (`kroger_prices` on the final to-buy) + confirm, then capture in one commit. Side-sourcing stops being a separate sequenced phase.
- **Two-tier sides.** *Corpus sides* (`course: side` recipes) keep their own `[[planned]]` slug row as today. *Open-world sides* ("roasted broccoli", "white rice") are kept and must flow through: add an optional **`sides: string[]`** to `meal_plan.toml` `[[planned]]` so they ride on their main's row (the `recipe` slug invariant is untouched, so reconcile/cooked flows don't change); their ingredients are enumerated by the agent from world knowledge and added to `grocery_list.toml` with `source = menu`, `for_recipes = []`, and a `note` ("for the broccoli side"). Open-world sides are **not** separately cooking-logged (one plate = one cook; sides don't drive the protein/cuisine retrospective) and are **not** remembered in `pairs_with` (re-proposed by reasoning each time).

## Capabilities

### New Capabilities
<!-- None — `course` is a field/facet woven into existing capabilities, not a standalone capability. -->

### Modified Capabilities
- `shared-corpus`: objective recipe content adds `course` (classified at import) and drops `standalone`.
- `recipe-import`: classify `course` at import, in the same step that derives `protein`/`cuisine`/`perishable_ingredients`; remove `standalone` from the enrichment surface.
- `data-indexing`: normalize `course` (`string | string[]` → lowercased string array) into `_indexes/recipes.json`; stop projecting `standalone`.
- `data-validation`: add a `course` **shape-only** check (string or array-of-strings, open-vocab — explicitly *not* a controlled-vocabulary dimension); remove the `standalone` non-boolean hard-fail and its warn-only default; validate the new `meal_plan` `[[planned]]` `sides` shape (array of strings).
- `data-read-tools`: `list_recipes` gains a `course` containment filter (flat return unchanged).
- `meal-planning`: a `[[planned]]` entry MAY carry `sides: string[]` (open-world sides on the accompanying main's row).
- `data-write-tools`: `commit_changes` `meal_plan_ops` carries an optional `sides` array.
- `menu-generation`: rework the context pre-pass into one faceted load; replace the sequenced plate-rounding + side-bootstrap requirements with holistic two-tier-side reasoning (drop the `standalone` gate in favor of inference); capture open-world sides as `sides[]` plus `for_recipes: []` grocery rows.

## Impact

- **Code:** `scripts/build-indexes.mjs` (course normalization + drop `standalone` projection/validation), `src/validate.ts` (course shape-check; drop `standalone`; planned `sides` shape), `src/recipes.ts` (`RecipeFilters.course` + containment filter), `src/meal-plan.ts` (`PlannedItem`/`MealPlanOp` gain `sides`; `applyMealPlanOps` upserts it).
- **Docs:** `docs/SCHEMAS.md` (recipe frontmatter: `course` in, `standalone` out; `meal_plan.toml` `sides`), `docs/TOOLS.md` (`list_recipes` `course` filter; `read_recipe`/`list_recipes` notes drop `standalone`), `AGENT_INSTRUCTIONS.md` (meal-plan flow restructure; import-classification adds `course`).
- **Recipe site:** if any template renders `standalone`, drop that rendering (verify `recipe-site-enhancements`).
- **Out of scope (deliberate):** backfilling `course` across the existing corpus — an operator action in the private data repo. `course` absence is warn-free and faceting degrades gracefully (an un-coursed recipe is simply un-bucketed), so no system-provided backfill script ships with this change (unlike the perishable backfill).

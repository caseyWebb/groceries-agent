# Recipe Capture Funnel

## Why

The recipe corpus never converges into the ingredient-identity graph. Production D1 holds 949 ingredient keys across 184 recipes; 681 of them (259 distinct terms — "onion", "tomatoes", "chicken", "pasta", "rice", …) resolve to nothing in the graph and were never enqueued for capture. The cause is a gate interaction: the classify pass funnels its derived `ingredients_key`/`perishable_ingredients` through the `IngredientContext` (resolve + capture), but it only runs for recipes whose body/override gate hash changed — and the capture funnel was wired in after the corpus was first faceted, so every legacy recipe's terms sit in `recipe_facets` unresolved and uncaptured, forever, unless someone edits the body. The index projection (`src/recipe-projection.ts`) then copies those stored values verbatim into `recipes` each tick, so the projected join keys are frozen at classify-time resolution: cross-recipe overlap, grocery-list-vs-recipe dedup, and pantry matching all miss on the recipe side (the graph is pantry/grocery-only today), and a later resolver improvement (a new alias, a synonym merge, a re-pointed decision) never reaches the index without a body edit.

## What Changes

- **Projection-time re-resolution**: the index projection resolves each recipe's effective `ingredients_key` and `perishable_ingredients` through the CURRENT shared resolver (the `IngredientContext` funnel) on every rebuild, writing surviving full canonical ids into the `recipes` rows. `recipe_facets` stays as-classified; the projected index carries current resolution, so an alias/merge improvement propagates within one tick with no reclassification.
- **Projection-time capture**: terms the resolver has not placed are enqueued to `novel_ingredient_terms` by that same pass (one best-effort batched insert-or-ignore enqueue of the pass's distinct unplaced terms). The 259 legacy terms backfill organically at the capture job's own bounded pace (25/tick), and any future capture-outage gap self-heals the same way — the projection re-encounters every term every tick until it resolves.
- **Degradation preserved**: a resolver read failure degrades to `emptyIngredientContext` (the grocery/pantry-write pattern) — the projection still projects every recipe, stored values pass through in their cleaned form, capture is disabled for the tick, and the tick is flagged `degraded` in the job summary.
- **Convergence observability**: the `recipe-index` job summary gains an `unresolved` distinct-term count and a `degraded` flag, so the operator can watch 259 → 0 (and a degraded tick shows as a spike with the flag set, while the job stays ok).

No LLM enters the projection — capture is by enqueue only; the existing normalize cron classifies at its own pace. No D1 schema change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `recipe-index`: the projection's output is a function of the R2 corpus, the derived facets, AND the current ingredient resolver; a new requirement pins projection-time re-resolution to surviving canonical ids with the empty-context degradation.
- `ingredient-normalization`: the index projection becomes a standing capture surface — unresolved recipe ingredient terms enqueue to the novel-term queue every tick until placed (no food gate: recipe ingredient facets are food by construction).
- `recipe-facet-derivation`: the alias-normalization requirement documents the stored facets as classify-time snapshots that the index projection re-resolves each rebuild, so resolver improvements reach readers without reclassification.

## Impact

- `packages/worker/src/recipe-projection.ts` — `ProjectionDeps.ingredientContext()`, re-resolution after the effective-facet merge, `unresolved` in `ProjectionResult` and the job summary.
- `packages/worker/test/recipe-projection.test.ts` — re-resolution, capture/dedup, degradation, and summary cases; harness gains the context dep.
- `docs/ARCHITECTURE.md` (the recipe-index projection section + the capture-surface enumeration), `docs/SCHEMAS.md` (`ingredients_key`/`perishable_ingredients` semantics, the `recipe-index` job summary shape). No migration; no new dependencies; no tool-contract change (docs/TOOLS.md untouched).

# recipe-index delta — recipe-capture-funnel

## ADDED Requirements

### Requirement: Projection-time ingredient identity resolution

The projection SHALL, on every rebuild, resolve each projected recipe's effective `ingredients_key` and `perishable_ingredients` entries through the current shared ingredient resolver (the `IngredientContext` funnel: alias front-door plus representative chain), writing the **surviving full canonical ids** into the `recipes` row — so a resolver improvement (a new alias, a synonym merge, a re-pointed decision) reaches the index within one tick, with no reclassification and no body edit. The stored `recipe_facets` values SHALL remain as-classified: the projection reads them and never rewrites them. When the resolver read fails, the projection SHALL still project every recipe — the stored values pass through in their resolver-less cleaned form and capture is disabled for the pass (the empty-context degradation) — and the resolver failure SHALL NOT fail the projection pass or skip any recipe.

#### Scenario: An alias improvement propagates within one tick

- **WHEN** a recipe's stored derived `ingredients_key` contains "scallions" and the capture job later writes the alias `scallions → green-onion`
- **THEN** the next index projection writes `green-onion` into that recipe's `recipes` row, without the recipe being reclassified

#### Scenario: A synonym merge reaches the index without reclassification

- **WHEN** two already-minted ids merge via the `representative` pointer after recipes were classified against the merged-away id
- **THEN** a stored value that has an alias-variant row re-points to the surviving id on the next projection (the alias front-door bakes in the representative chain), while a stored canonical id with **no** alias-variant row is not silently re-pointed — it projects in its cleaned form, counts as unresolved, and is enqueued for capture, converging onto the survivor over the capture job's ticks — and in both cases the `recipe_facets` rows are untouched and the recipe is never reclassified

#### Scenario: A resolver read failure degrades, never skips

- **WHEN** the ingredient resolver read fails during a projection pass
- **THEN** every valid recipe still projects, its ingredient facets pass through as the stored cleaned values, no novel-term enqueue occurs that pass, and the projection reports success

## MODIFIED Requirements

### Requirement: The Worker reconcile projects the index into D1

The Worker's scheduled reconcile (`src/recipe-projection.ts`) SHALL project the validated recipe set into the D1 `recipes` table by replacing its contents wholesale in one transaction (`DELETE` then batched `INSERT`), so a removed recipe loses its row and the table is a deterministic function of the R2 `recipes/*.md` corpus **merged with the classify pass's derived facets and the current ingredient identity resolver**. For each facet column the projection SHALL write the **effective** value (see *The index materializes effective facets*), reading the derived facets from the classify-pass-owned sibling table, and SHALL resolve the effective `ingredients_key`/`perishable_ingredients` through the shared resolver (see *Projection-time ingredient identity resolution*). It SHALL NOT publish the index to KV. Projection is eventual (cron-driven): a fresh database is populated by the first reconcile pass over the R2 corpus and the classify pass's derived facets.

#### Scenario: A reconcile rebuilds the D1 table

- **WHEN** the reconcile runs after a recipe change
- **THEN** the `recipes` table is replaced to match the current R2 `recipes/*.md` and the derived facets, with no KV `index:recipes` write

#### Scenario: First reconcile populates a fresh database

- **WHEN** an operator deploys and the first scheduled reconcile runs
- **THEN** it populates the D1 `recipes` table from the R2 corpus and the available derived facets, so `search_recipes` returns results

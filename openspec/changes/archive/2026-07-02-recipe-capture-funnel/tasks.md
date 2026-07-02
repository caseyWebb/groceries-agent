# Tasks — recipe-capture-funnel

> Note: task 1.1's per-term capture wording reflects the original pin, superseded by the review amendment (capture-off context + single batched flush) — design.md is the decision authority.

## 1. Projection re-resolution + capture (src/recipe-projection.ts)

- [x] 1.1 Add `ingredientContext(): Promise<IngredientContext>` to `ProjectionDeps` (import the type from `./corpus-db.js`); wire it in `buildProjectionDeps` as `() => ingredientContext(env).catch(() => emptyIngredientContext(env))` — the same degradation the grocery/pantry writes use
- [x] 1.2 In `reconcileRecipeIndex`, load the context once up front (`Promise.all` with `loadClassifiedFacets`); after `mergeEffectiveFacets`, map `effective.ingredients_key = ctx.resolveNames(effective.ingredients_key)` and `effective.perishable_ingredients = ctx.resolveNames(effective.perishable_ingredients)` before building `valid[slug]` — this re-resolves the classified values AND the pre-migration authored fallbacks through the one funnel (normalize + best-effort capture), one context per pass so cross-recipe enqueue dedup is inherent
- [x] 1.3 Count distinct unresolved terms (resolved id not in `ctx.resolver.ids`) across projected recipes; add `unresolved: number` to `ProjectionResult`
- [x] 1.4 In `runProjectionJob`, add `unresolved` to the `recipe-index` `job_health`/`job_runs` summary (`{ projected, skipped, unresolved }`); leave `recordUsagePoint` doubles as `[projected, skipped]` (positional AE series — do not append)

## 2. Tests (packages/worker/test/recipe-projection.test.ts)

- [x] 2.1 Extend `makeDeps` with an injectable fake `IngredientContext` (default: identity passthrough with a recorded `captured: string[]`); update existing tests for the new dep
- [x] 2.2 Re-resolution: a context whose `toId` maps a stored facet term (e.g. `scallions → green-onion`) → the projected row's `ingredients_key`/`perishable_ingredients` JSON carries the surviving id; a term with no mapping projects as its cleaned form unchanged
- [x] 2.3 Capture: a term absent from `resolver.ids` is captured exactly once across two recipes sharing it (per-pass dedup); an already-known survivor id is not captured; capture applies to both `ingredients_key` and `perishable_ingredients`, including an authored Tier-A fallback value on an unclassified recipe
- [x] 2.4 Degradation: an empty-context fake (`toId` empty, `ids` empty, capture disabled) still projects every recipe with stored values passed through, `projected` unchanged, nothing captured; via `buildProjectionDeps` + `fakeD1`, a failing `ingredient_identity`/`ingredient_alias` read still yields a successful projection (rows written)
- [x] 2.5 Summary: `runProjectionJob` writes `unresolved` in the `recipe-index` job summary (via `readJobHealth`), counting distinct unresolved terms; zero when every term resolves

## 3. Specs, docs & verification

- [x] 3.1 docs/ARCHITECTURE.md — "The recipe-index projection (scheduled capture)" section: the projection resolves `ingredients_key`/`perishable_ingredients` through the current resolver each rebuild (surviving full canonical ids; `recipe_facets` stays as-classified) and is a capture surface (unresolved terms enqueue for the normalize job; empty-context degradation on a resolver-read failure); the ingredient-normalization capture section's funnel-consumer enumeration gains the index projection. Current-state wording, no history
- [x] 3.2 docs/SCHEMAS.md — `ingredients_key` (recipe schema notes) + `perishable_ingredients`: canonical ids are re-resolved through the current resolver at each index projection (the stored `recipe_facets` values are the classify-time snapshot); `job_health` summary shapes: `recipe-index` carries `{ projected, skipped, unresolved }`
- [x] 3.3 `npx --yes openspec validate recipe-capture-funnel`, `aubr typecheck`, `aubr test test/recipe-projection.test.ts`, then full `aubr test` all green

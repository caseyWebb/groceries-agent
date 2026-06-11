## Why

A weekly menu often pulls in a perishable for a single recipe — a half-bunch of cilantro for one dish, a tablespoon of dill — and the rest rots. Catching that at **menu-generation** time (offer a second recipe that uses it, or a swap) prevents waste at the source. The signal is cross-recipe overlap, but the recipe data can't currently support it: the waste-prone ingredients are the *minor* ones that `ingredients_key` (top 5–7) deliberately omits, and the freeform `## Ingredients` body lines can't be matched across recipes without re-fighting the `aliases.toml` matching tax. This change adds a normalized, derived `perishable_ingredients` recipe field that makes the overlap deterministic, and the menu-gen callout that uses it. (This is the BUY-moment half of perishability; the STORE-moment storage guidance is the separate `add-storage-guidance` change.)

## What Changes

- **Add a `perishable_ingredients` recipe frontmatter field** — a normalized list of the recipe's perishable ingredients. Objective **shared content** (carried in `_indexes/recipes.json`, written by `create_recipe`/`update_recipe`), not curated config and not per-tenant overlay.
- **Derive it, don't hand-maintain it** — the import/create flow LLM-classifies perishables and writes the field (same shape as protein/cuisine classification at import). A one-time backfill populates the existing corpus. Hand-edit only to correct a miss.
- **Classification test:** not botany — *"would the leftover rot before I'd use it?"* Fuzzy edges (eggs, potatoes) are acceptable; a wrong call only costs a dismissed nudge.
- **Normalized names reuse the existing verify-matcher normalization** (`src/pantry-verify.ts`), so cross-recipe overlap lines up with how ingredient matching works everywhere else.
- **Add a menu-gen waste callout** — when a proposed recipe uses a perishable in **less than a typical purchase unit** (a partial package, judged by the agent from the recipe body + how the item is sold), and no other proposed recipe uses it, offer to add a recipe that uses up the remainder or to swap. The agent **reasons over the `perishable_ingredients` already in the recipe index** — no dedicated search/filter tool, **no Kroger call** (the model's own "cilantro ships as a bunch" knowledge carries it). A full-unit use, or a perishable shared by 2+ proposed recipes, triggers nothing. SKU package-size precision and a deterministic perishable-filter selector are deferred (see design).
- **Validation:** `perishable_ingredients` present-but-not-a-string-array hard-fails the build (like a non-boolean `standalone`); absence is silent (warn-only soft validation, like other optional arrays). Carried into the index by the existing objective-frontmatter passthrough.

## Capabilities

### New Capabilities
<!-- none — this layers a new recipe field + behavior onto existing capabilities, mirroring how pairs_with was added -->

### Modified Capabilities
- `shared-corpus`: add `perishable_ingredients` to the enumerated objective recipe content (shared, not per-tenant).
- `data-validation`: hard-fail when `perishable_ingredients` is present but not a string array; absence warns nothing.
- `recipe-import`: the import/create flow classifies and writes `perishable_ingredients`; a one-time corpus backfill populates existing recipes.
- `menu-generation`: add the partial-purchase-unit perishable waste callout (LLM reasoning over the index, no search tool) to the menu proposal flow.

## Impact

- **Recipe frontmatter / data repo:** new `perishable_ingredients` field; one-time backfill over the existing corpus.
- **`scripts/build-indexes.mjs`:** validate the field's type (hard-fail on non-array-when-present); confirm the generic objective-frontmatter passthrough carries it into `_indexes/recipes.json` (no special-casing, per the `pairs_with` precedent).
- **Worker (`src/`):** `create_recipe`/`update_recipe` persist the field as objective shared content; reuse `src/pantry-verify.ts` normalization for the names. `docs/TOOLS.md` + `docs/SCHEMAS.md` updated.
- **`AGENT_INSTRUCTIONS.md`:** the at-import classification step and the menu-gen partial-unit waste callout (reasoning over the index field).
- **Dependencies** (menu-generation flow, recipe-import, the index/validation pipeline) are already built and archived — applicable now. Independent of `add-storage-guidance`.

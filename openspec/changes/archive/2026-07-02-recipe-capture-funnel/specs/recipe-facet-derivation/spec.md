# recipe-facet-derivation delta — recipe-capture-funnel

## MODIFIED Requirements

### Requirement: Derived ingredient facets are alias-normalized

The classify pass SHALL normalize the derived `ingredients_key` and `perishable_ingredients` to **full canonical ids** through the shared resolver (the same `normalizeIngredientList` the write path and the discovery path apply, resolving each surface form to its canonical node via the `representative` pointer), so a derived ingredient name lines up across recipes for cross-recipe overlap and pantry matching regardless of surface form — while distinct varieties stay distinct (no base-equality collapse). A term the resolver has not yet placed SHALL normalize to its cleaned form (unchanged behavior) and be enqueued for the capture job, so the overlap sharpens as the identity layer grows. The values stored in `recipe_facets` are the classify-time snapshot; the index projection re-resolves them through the current resolver on every rebuild (see `recipe-index`), so a resolver improvement reaches the projected index — and every reader of it — without reclassifying the recipe.

#### Scenario: Derived perishables of a synonym share one canonical node

- **WHEN** the classify pass derives `perishable_ingredients` for two recipes that each use fresh cilantro under different wording (e.g. "cilantro" and "fresh coriander leaves")
- **THEN** both record the same canonical entry (synonym-merged), so the two recipes' use of that perishable can be compared directly, whereas two distinct varieties (e.g. cheddar vs mozzarella) record distinct entries and do not falsely overlap

#### Scenario: An unplaced term still normalizes and is captured

- **WHEN** the classify pass derives an ingredient the resolver has not yet placed
- **THEN** it records the cleaned term (as today) and enqueues the surface form, so a later capture tick can merge it into its canonical node

#### Scenario: A resolver improvement reaches the index without reclassification

- **WHEN** a stored derived ingredient value gains a resolution after the recipe was classified (a new alias is written or its node merges into a survivor)
- **THEN** the recipe's facet gate hash is unchanged and no classifier call is spent, and the next index projection writes the surviving canonical id into the `recipes` row

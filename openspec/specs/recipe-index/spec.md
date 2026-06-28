# recipe-index Specification

## Purpose

Defines the recipe index: the shared, objective projection of `recipes/*.md`, stored in and served from the D1 `recipes` table. The Worker reads the index from D1 — not from KV or the GitHub data repo — for the read-heavy operations that require it, and the Worker's scheduled reconcile projects the validated recipe set into the table from the R2 corpus.
## Requirements
### Requirement: Recipe index is stored in and served from D1

The system SHALL maintain the shared recipe index as a `recipes` table in **D1** (the `DB` binding), not as a KV blob. The Worker SHALL read the index from D1 — not from KV or the GitHub data repo — on every tool invocation that requires it (`search_recipes`, `retrospective`, the `read_recipe` slug path, and the discovery idempotency check). The table holds only **objective** recipe content (the shared projection); per-tenant disposition fields (`favorite`, `reject`) and the derived `last_cooked` are NOT stored here — they are merged at read time from the overlay and cooking log.

A *provisioned but empty* `recipes` table SHALL be treated as an empty corpus (the tool returns no recipes), distinct from an *unreadable* table (D1 unreachable or unmigrated), which SHALL surface as `index_unavailable`.

#### Scenario: search_recipes reads from D1

- **WHEN** `search_recipes` is called
- **THEN** the Worker loads the index from the D1 `recipes` table and applies the spec facets, making no KV or GitHub call for the index

#### Scenario: Empty corpus is not an error

- **WHEN** the `recipes` table exists but has no rows
- **THEN** a vibe-less `search_recipes` spec returns an empty result group rather than an `index_unavailable` error

#### Scenario: Unreadable index surfaces as index_unavailable

- **WHEN** the `recipes` table cannot be read (D1 unreachable or not yet migrated)
- **THEN** the tool returns a structured `index_unavailable` error, not an unhandled exception

#### Scenario: retrospective reads recipe metadata from D1

- **WHEN** `retrospective` is called
- **THEN** recipe protein/cuisine metadata is resolved by querying D1, not by loading a KV blob

#### Scenario: Discovery idempotency check is an indexed query

- **WHEN** `parse_recipe` or `create_recipe` checks whether a source URL is already indexed
- **THEN** the lookup runs against the D1 `recipes` table (the `source_url` column is indexed) rather than loading the entire index

### Requirement: The Worker reconcile projects the index into D1

The Worker's scheduled reconcile (`src/recipe-projection.ts`) SHALL project the validated recipe set into the D1 `recipes` table by replacing its contents wholesale in one transaction (`DELETE` then batched `INSERT`), so a removed recipe loses its row and the table is a deterministic function of the R2 `recipes/*.md` corpus **merged with the classify pass's derived facets**. For each facet column the projection SHALL write the **effective** value (see *The index materializes effective facets*), reading the derived facets from the classify-pass-owned sibling table. It SHALL NOT publish the index to KV. Projection is eventual (cron-driven): a fresh database is populated by the first reconcile pass over the R2 corpus and the classify pass's derived facets.

#### Scenario: A reconcile rebuilds the D1 table

- **WHEN** the reconcile runs after a recipe change
- **THEN** the `recipes` table is replaced to match the current R2 `recipes/*.md` and the derived facets, with no KV `index:recipes` write

#### Scenario: First reconcile populates a fresh database

- **WHEN** an operator deploys and the first scheduled reconcile runs
- **THEN** it populates the D1 `recipes` table from the R2 corpus and the available derived facets, so `search_recipes` returns results

### Requirement: The index materializes effective facets

The projection SHALL write into each `recipes` facet column the **effective** facet value, so every reader of the index sees one resolved value with no read-time join: a **Tier A** facet (`ingredients_key`, `perishable_ingredients`, `side_search_terms`, `meal_preppable`) SHALL be the classify pass's derived value; a **Tier B** facet (`protein`, `cuisine`, `course`, `season`) SHALL be the authored override when present and the derived value otherwise; `tags` SHALL be the **union** of authored and derived tags; and a **Tier C** facet (`dietary`, `requires_equipment`) SHALL be the authored value, unchanged. A derived facet that has not been produced yet (e.g. a just-authored body before the next classify tick) SHALL project as its explicit empty form, treated as "not yet derived," never an error.

#### Scenario: An authored override is materialized over the derived value

- **WHEN** a recipe carries an authored `protein: beef` and the classify pass derived `protein: pork`
- **THEN** the projection writes `protein = beef` into the `recipes` row, and `search_recipes` filtering on `protein: beef` returns the recipe

#### Scenario: A derived-only facet is materialized from the sibling table

- **WHEN** a recipe has no authored `course` and the classify pass derived `course: [main]`
- **THEN** the projection writes `course = [main]` into the `recipes` row from the sibling table

#### Scenario: Tags are materialized as the union

- **WHEN** a recipe carries authored `tags: [holiday]` and derived `tags: [roast]`
- **THEN** the projection writes the union `[holiday, roast]` into the `recipes` row

#### Scenario: An unclassified recipe projects empty derived facets

- **WHEN** a recipe body was just authored and the classify pass has not yet run for it
- **THEN** its derived facet columns project as their explicit empty form and the recipe is treated as not-yet-derived, not an error

### Requirement: The classify-pass facet table survives the wholesale rebuild

The classify pass's derived facets SHALL live in a reconcile-independent, slug-keyed sibling of `recipes` (alongside `recipe_derived` / `taste_derived`), so the projection's wholesale `DELETE` + re-`INSERT` of `recipes` SHALL NOT clobber the derived facets. The classify pass (body-gated) and the index projection (corpus-gated) SHALL each rebuild independently.

#### Scenario: A recipe-index rebuild preserves derived facets

- **WHEN** the projection rebuilds the `recipes` table wholesale
- **THEN** the classify-pass-owned facet table is untouched, and the derived facets survive the rebuild to be merged on the next projection


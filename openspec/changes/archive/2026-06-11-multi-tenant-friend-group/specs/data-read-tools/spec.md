## MODIFIED Requirements

### Requirement: list_recipes reads the index and filters in-worker

The system SHALL provide `list_recipes(filters)` that reads the shared `_indexes/recipes.json` in a single call, **joins each entry with the caller's per-tenant overlay** (`rating`, `status` from `overlay.toml`; effective `status` defaults to `draft` when the caller has no overlay row) **and the caller's cooking-log-derived `last_cooked`** (max cook date for the slug from that tenant's `cooking_log.toml`), unions the caller's personal (unshared) recipes, and applies filters in the Worker, returning `{ recipes: [{ slug, title, frontmatter }] }` where `frontmatter` reflects the merged objective content + the caller's subjective fields. If the shared `_indexes/recipes.json` is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: Active recipes returned by default, per caller overlay

- **WHEN** `list_recipes({})` is invoked with no `status` filter
- **THEN** only recipes whose **effective status for the caller** is `active` are returned, each with shared content merged with the caller's `rating`/`last_cooked`

#### Scenario: Status reflects the caller, not the corpus

- **WHEN** two tenants invoke `list_recipes({ status: "active" })` and they have dispositioned a shared recipe differently
- **THEN** each tenant's result reflects their own overlay status for that recipe, not a shared/global status

#### Scenario: Personal recipes included

- **WHEN** the caller has personal (unshared) recipes and invokes `list_recipes({})`
- **THEN** the results include the caller's personal recipes alongside shared corpus recipes

#### Scenario: Index missing or malformed

- **WHEN** the shared `_indexes/recipes.json` cannot be read or parsed
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: read_recipe returns frontmatter and body

The system SHALL provide `read_recipe(slug)` returning `{ slug, frontmatter, body }`, where `frontmatter` is the shared objective frontmatter **merged with the caller's overlay fields** (`rating`, `status`, defaulting `status` to `draft` when absent) **and the caller's cooking-log-derived `last_cooked`** and `body` is the markdown after the frontmatter fence. The slug MAY resolve to a shared corpus recipe or one of the caller's personal recipes. The return SHALL NOT include a `last_modified` field. A slug unknown to both the shared corpus and the caller's personal recipes SHALL return a structured `not_found` error.

#### Scenario: Existing recipe read with caller's subjective fields

- **WHEN** `read_recipe("american-chop-suey")` is invoked by a tenant who rated it 4 and cooked it last week
- **THEN** it returns the slug, the shared frontmatter merged with that tenant's `rating: 4` and `last_cooked`, and the markdown body, with no `last_modified` field

#### Scenario: Unknown slug

- **WHEN** `read_recipe("does-not-exist")` is invoked and the slug is in neither the shared corpus nor the caller's personal recipes
- **THEN** it returns a structured `not_found` error naming the slug

## ADDED Requirements

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the cross-tenant group signal for a shared recipe — other tenants' ratings (aggregated) and non-private notes (attributed) — to inform surfacing of recipes the caller has not tried. This read SHALL aggregate across tenants at read time and SHALL exclude private notes authored by others.

#### Scenario: Aggregated group rating available

- **WHEN** a recipe has been rated by several tenants and the caller requests group signal for it
- **THEN** the caller receives the aggregated rating and the attributed non-private notes from the group

#### Scenario: Others' private notes excluded

- **WHEN** another tenant has a private note on a recipe
- **THEN** that private note is not included in the group signal returned to the caller

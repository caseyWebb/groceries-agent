## MODIFIED Requirements

### Requirement: Recipe index shape

The system SHALL emit `_indexes/recipes.json` (in the shared corpus repository) as a JSON object keyed by recipe slug, where each value is that recipe's **objective** frontmatter plus an injected `slug` field. The shared index SHALL NOT contain the per-tenant subjective fields `rating`, `last_cooked`, or `status` — those live in each tenant's overlay and are merged at read time, not baked into the shared index. The slug SHALL be derived from the recipe filename with the `.md` extension removed.

#### Scenario: Recipe aggregated by slug

- **WHEN** `recipes/lemon-garlic-chicken.md` is indexed
- **THEN** `recipes.json` contains a key `"lemon-garlic-chicken"` whose value includes that file's objective frontmatter fields and `"slug": "lemon-garlic-chicken"`

#### Scenario: Subjective fields excluded from the shared index

- **WHEN** a shared recipe is indexed
- **THEN** the indexed value carries no `rating`, `last_cooked`, or `status` field, because those are per-tenant overlay merged at read time

#### Scenario: All recipes included regardless of any tenant's disposition

- **WHEN** the shared corpus is indexed
- **THEN** every recipe in the shared corpus appears in `recipes.json`, since per-tenant disposition (status) is not part of the shared index

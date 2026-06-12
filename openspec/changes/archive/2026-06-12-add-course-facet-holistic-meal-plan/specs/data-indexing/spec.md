## ADDED Requirements

### Requirement: Course field normalization in the index

The index build SHALL normalize a recipe's `course` frontmatter into `_indexes/recipes.json` as a **lowercased, trimmed array of strings**, regardless of whether the source frontmatter declared it as a bare string or as an array. A recipe with no `course` SHALL be projected with an empty `course` array (`[]`), the same default treatment as `pairs_with` / `perishable_ingredients`. The build SHALL NOT validate `course` *values* against any controlled set — it normalizes shape and casing only — so the facet stays open-vocabulary and consistent across recipes that differ only in casing or whitespace.

#### Scenario: Scalar course normalized to an array

- **WHEN** a recipe declares `course: Main`
- **THEN** the indexed value is `course: ["main"]` (lowercased, wrapped in an array)

#### Scenario: Array course is lowercased and trimmed

- **WHEN** a recipe declares `course: ["Main", " Side "]`
- **THEN** the indexed value is `course: ["main", "side"]`

#### Scenario: Absent course defaults to empty array

- **WHEN** a recipe omits `course`
- **THEN** the indexed value carries `course: []` and the build prints no warning and exits successfully

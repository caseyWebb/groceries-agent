## MODIFIED Requirements

### Requirement: list_recipes filter semantics

The system SHALL apply `list_recipes` filters with these semantics: array filters (`dietary`, `season`) match when the recipe contains **ALL** listed values (AND); the `course` filter is a **scalar** that matches by **containment** — a recipe passes when its (array-normalized) `course` includes the requested value, so `{ course: "side" }` returns mains-that-are-also-sides as well as pure sides; `status` defaults to `active` and `status: "all"` disables status filtering; `exclude_cooked_within_days` is a caller-supplied number that excludes recipes cooked within that many days; and `not_cooked_since` (a date) admits recipes whose `last_cooked` is `null`. The system SHALL NOT provide a `tags` array filter — keyword/name matching against tags is handled by the `query` text filter (see "list_recipes free-text query filter"). The `course` value is a free string matched literally against the normalized index values; there is no controlled set.

The system SHALL additionally apply a **makeability gate** by default: a recipe whose `requires_equipment` is not a subset of the caller's `owned` (see the kitchen-equipment "Deterministic makeability rule") SHALL be excluded. When the caller's `owned` is empty (or `kitchen.toml` is absent) the gate SHALL be a no-op (every recipe passes). A `include_unmakeable: true` filter SHALL disable the exclusion and instead return unmakeable recipes annotated with `missing_equipment` (the required slugs not in `owned`), so the named-dish enumeration path can surface a named recipe flagged rather than silently dropped. The gate SHALL be ANDed with the other filters and SHALL be a pure function of the recipe's indexed `requires_equipment` and the caller's `owned`.

The return shape SHALL stay flat: `course` rides each entry's `frontmatter`; the tool SHALL NOT return a grouped or course-bucketed envelope. Callers that want mains and sides together issue one call (e.g. `list_recipes({ status: "active" })`) and bucket by `course` themselves.

#### Scenario: Array filter matches all values

- **WHEN** `list_recipes({ dietary: ["gluten-free", "dairy-free"] })` is invoked
- **THEN** only recipes whose `dietary` includes both `gluten-free` AND `dairy-free` are returned

#### Scenario: Course filter matches by containment

- **WHEN** `list_recipes({ course: "side" })` is invoked
- **THEN** every recipe whose normalized `course` array includes `side` is returned — including a dual-use recipe whose `course` is `[main, side]` — and recipes without `side` in their `course` are excluded

#### Scenario: Course filter value is open, not validated

- **WHEN** `list_recipes({ course: "sauce" })` is invoked and some recipes carry `course: [sauce]`
- **THEN** those recipes are returned; the filter does not reject `sauce` as off-vocabulary

#### Scenario: Status opt-out returns every status

- **WHEN** `list_recipes({ status: "all" })` is invoked
- **THEN** recipes of every status (`active`, `draft`, `rejected`, `archived`) are returned

#### Scenario: Never-cooked recipe passes not_cooked_since

- **WHEN** `list_recipes({ not_cooked_since: "2026-01-01" })` is invoked and a recipe has `last_cooked: null`
- **THEN** that recipe is included in the results

#### Scenario: Recently cooked recipe excluded by window

- **WHEN** `list_recipes({ exclude_cooked_within_days: 14 })` is invoked and a recipe was cooked 3 days ago
- **THEN** that recipe is excluded from the results

#### Scenario: A tags filter is not honored

- **WHEN** `list_recipes({ tags: ["chicken"] })` is invoked (an unknown filter)
- **THEN** the `tags` key is ignored (no tag-based narrowing) and the result is the same as if no `tags` were supplied

#### Scenario: Unmakeable recipe is excluded by default

- **WHEN** `list_recipes({})` is invoked, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is excluded from the results

#### Scenario: Empty inventory disables the gate

- **WHEN** `list_recipes({})` is invoked and the caller has no `kitchen.toml` (or empty `owned`)
- **THEN** the makeability gate excludes nothing and recipes are returned as if no equipment filter applied

#### Scenario: include_unmakeable surfaces flagged recipes

- **WHEN** `list_recipes({ include_unmakeable: true })` is invoked, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is returned annotated with `missing_equipment: ["pressure-cooker"]` rather than excluded

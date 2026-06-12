## ADDED Requirements

### Requirement: Course classification at import

When a recipe is imported or created, the system SHALL classify the recipe's `course` and write it to the recipe's `course` frontmatter field, in the same enrichment step that derives the other objective fields (`protein`, `cuisine`, `perishable_ingredients`). `course` SHALL be an **open vocabulary**: the classifier SHALL prefer the documented convention (`main`, `side`, `dessert`, `breakfast`) but MAY assign any descriptive value (e.g. `sauce`, `baked_good`) without a code change, since the vocabulary is not a controlled set. A recipe that genuinely plates as more than one course (e.g. a hearty grain salad that serves as a main or a side) MAY be classified with **multiple** values (`course: [main, side]`). The classified `course` SHALL be persisted via `create_recipe` / `update_recipe`. A wrong or missing classification is non-fatal — `course` absence is warn-free and only leaves the recipe un-bucketed in the meal-plan faceting.

#### Scenario: Import classifies a main dish

- **WHEN** a roast chicken recipe is imported
- **THEN** its `course` is written as `[main]` (or `main`), in the same step that derives `protein` and `cuisine`

#### Scenario: Dual-use dish gets multiple courses

- **WHEN** a hearty grain salad that works as either a main or a side is imported
- **THEN** the classifier MAY write `course: [main, side]`, and the recipe is later returned by both `list_recipes({ course: "main" })` and `list_recipes({ course: "side" })`

#### Scenario: Novel course value is accepted without a code change

- **WHEN** a chimichurri recipe is imported and the classifier assigns `course: [sauce]`, a value outside the documented convention
- **THEN** the value is written and indexed as-is — no controlled-vocabulary check rejects it

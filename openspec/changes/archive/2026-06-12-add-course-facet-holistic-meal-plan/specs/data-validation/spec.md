## MODIFIED Requirements

### Requirement: Hard-fail validation rules

The system SHALL fail the build (non-zero exit) when any of the following structural problems is detected: a recipe's YAML frontmatter does not parse, any `.toml` file does not parse, a recipe `status` value is outside the allowed enum (`active`, `draft`, `rejected`, `archived`), two recipes resolve to the same slug, a `pairs_with` entry names a slug that does not resolve to a recipe in the corpus, or a `perishable_ingredients` value is present but is not an array of strings. (`course` shape validation is defined in "Course field shape validation"; `standalone` is no longer a recognized field and is neither validated nor projected.)

#### Scenario: Malformed frontmatter blocks the build

- **WHEN** a recipe file contains YAML frontmatter that fails to parse
- **THEN** the build exits non-zero and reports the offending file

#### Scenario: Invalid status enum blocks the build

- **WHEN** a recipe declares `status: in-progress`
- **THEN** the build exits non-zero and reports the invalid status value and file

#### Scenario: Duplicate slug blocks the build

- **WHEN** two recipe files derive the same slug
- **THEN** the build exits non-zero and names the conflicting files

#### Scenario: Unresolved pairs_with reference blocks the build

- **WHEN** a recipe declares `pairs_with: [garlic-bread]` and no recipe in the corpus resolves to the slug `garlic-bread`
- **THEN** the build exits non-zero and reports the unresolved `pairs_with` reference and the offending recipe

#### Scenario: Non-array perishable_ingredients blocks the build

- **WHEN** a recipe declares `perishable_ingredients: cilantro` (a bare string, not an array of strings)
- **THEN** the build exits non-zero and reports the invalid `perishable_ingredients` value and file

#### Scenario: Unparseable TOML blocks the build

- **WHEN** any tracked `.toml` file fails to parse
- **THEN** the build exits non-zero and reports the offending file

#### Scenario: A lingering standalone value is ignored, not failed

- **WHEN** a recipe still declares `standalone: yes-please` (a now-retired field, any value)
- **THEN** the build does not fail on it — `standalone` is no longer recognized, validated, or projected into the index

### Requirement: Warn-only soft validation

The system SHALL emit warnings, without failing the build, when recommended-but-optional frontmatter fields (e.g. `protein`, `time_total`, `rating`, `ingredients_key`) are missing or null. Optional arrays such as `pairs_with` / `perishable_ingredients` / `course` SHALL default to empty without warning.

#### Scenario: Missing optional field warns but passes

- **WHEN** a recipe omits `protein` and `time_total` but has a valid `title` and `status`
- **THEN** the build prints a warning naming the missing fields and still exits successfully

#### Scenario: Absent pairing and course fields do not warn

- **WHEN** a recipe omits `pairs_with` and `course`
- **THEN** the build treats both as empty, prints no warning for either, and exits successfully

#### Scenario: Absent perishable_ingredients does not warn

- **WHEN** a recipe omits `perishable_ingredients`
- **THEN** the build treats it as empty, prints no warning, and exits successfully

### Requirement: Cooking-log and meal-plan structural validation

The system SHALL parse-check `cooking_log.toml` and `meal_plan.toml` during the index build and SHALL hard-fail (non-zero exit) when: either file does not parse as TOML; a `cooking_log` entry omits `date` or `type`, or has a `type` outside the allowed enum (`recipe`, `ready_to_eat`, `ad_hoc`); a `cooking_log` entry with `type = recipe` omits `recipe` or references a slug no recipe resolves to; a non-`recipe` entry omits `name`; a `meal_plan` `[[planned]]` entry omits `recipe` or references an unresolved slug; a `meal_plan` `[[planned]]` entry carries a `sides` value that is present but is not an array of strings; or any `date` / `planned_for` value is not a valid ISO date. The optional `sides` array on a `[[planned]]` row holds free-text open-world side names and SHALL NOT be slug-resolved (open-world sides are not recipes).

#### Scenario: Unknown cooking-log type blocks the build

- **WHEN** a `cooking_log.toml` entry declares `type = "snack"`
- **THEN** the build exits non-zero and reports the invalid `type` and entry

#### Scenario: Recipe entry with unresolved slug blocks the build

- **WHEN** a `type = recipe` entry references a slug no recipe file produces
- **THEN** the build exits non-zero and names the unresolved slug

#### Scenario: Planned entry with unresolved slug blocks the build

- **WHEN** a `meal_plan.toml` `[[planned]]` entry references a slug no recipe produces
- **THEN** the build exits non-zero and names the unresolved slug

#### Scenario: Free-text sides on a planned row are not slug-resolved

- **WHEN** a `[[planned]]` row carries `sides = ["roasted broccoli"]` and "roasted broccoli" resolves to no recipe slug
- **THEN** the build does not fail — `sides` is free-text open-world side names, validated as an array of strings only

#### Scenario: Non-array sides blocks the build

- **WHEN** a `[[planned]]` row declares `sides = "roasted broccoli"` (a bare string, not an array)
- **THEN** the build exits non-zero and reports the invalid `sides` value and entry

#### Scenario: Malformed date blocks the build

- **WHEN** a `cooking_log` `date` or `meal_plan` `planned_for` is not a valid ISO date
- **THEN** the build exits non-zero and reports the offending value

## ADDED Requirements

### Requirement: Course field shape validation

The system SHALL validate the shape of a recipe's `course` frontmatter — when present, it MUST be a string or an array of strings — and SHALL hard-fail the build (non-zero exit) naming the offending value, recipe, and field when it is not. The system SHALL NOT validate `course` *values* against any controlled set (unlike `protein` / `cuisine`): any string value is accepted, so the facet stays open-vocabulary and expandable without a code change. The Worker's structural pre-commit subset SHALL apply the same shape-only check (parallel to `pairs_with` / `domain`).

#### Scenario: Off-convention course value passes

- **WHEN** a recipe declares `course: [sauce]`, a value outside the documented `main`/`side`/`dessert`/`breakfast` convention
- **THEN** validation passes — no controlled-vocabulary check rejects the value

#### Scenario: Non-string course blocks the build

- **WHEN** a recipe declares `course: 3` (a number, neither a string nor an array of strings)
- **THEN** the build exits non-zero and reports the invalid `course` value, recipe, and field

#### Scenario: Array-of-strings course passes

- **WHEN** a recipe declares `course: [main, side]`
- **THEN** validation passes

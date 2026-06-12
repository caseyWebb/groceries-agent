# data-validation Specification

## Purpose

Defines the validation rule set applied during the index build: which problems hard-fail the build versus warn, the required recipe frontmatter fields, and the parse-check-only scope for non-index data TOMLs.
## Requirements
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

### Requirement: Required frontmatter fields

The system SHALL require every recipe to define a non-empty `title` (string) and a `status` within the allowed enum. Absence of either SHALL be a hard failure.

#### Scenario: Missing title blocks the build

- **WHEN** a recipe omits `title` or sets it empty
- **THEN** the build exits non-zero and reports the missing required field

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

### Requirement: Parse-check scope for data TOMLs

The system SHALL parse-check every tracked `.toml` file for validity, but SHALL NOT enforce deep schema validation on non-index data files (`pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `stockup.toml`, `feeds.toml`, `skus/kroger.toml`) beyond their being parseable. The `storage_guidance/*.md` files are prose and are not parse-checked as data (they are validated only for existence, like other curated markdown).

#### Scenario: Valid-but-sparse data TOML passes

- **WHEN** `pantry.toml` parses as valid TOML but omits fields the Worker would later expect
- **THEN** the build does not fail on that file

### Requirement: Required recipe body sections

The system SHALL fail the build (non-zero exit) when a recipe body does not contain both an `## Ingredients` H2 section and an `## Instructions` H2 section. Additional H2 sections (e.g. `## Notes`) SHALL be permitted and SHALL NOT cause failure. This guarantees the structural contract that downstream site generation relies on to locate the ingredient and step lists.

#### Scenario: Missing Ingredients section blocks the build

- **WHEN** a recipe body omits the `## Ingredients` section
- **THEN** the build exits non-zero and reports the offending file and missing section

#### Scenario: Missing Instructions section blocks the build

- **WHEN** a recipe body omits the `## Instructions` section
- **THEN** the build exits non-zero and reports the offending file and missing section

#### Scenario: Extra sections are allowed

- **WHEN** a recipe body contains `## Ingredients`, `## Instructions`, and an additional `## Notes` section
- **THEN** validation passes for that recipe

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

### Requirement: last_cooked consistency soft-check

The system SHALL emit a warning, without failing the build, when a recipe's frontmatter `last_cooked` does not equal the maximum `cooking_log.toml` `date` among `type = recipe` entries for that slug. A recipe with no cooking-log entries SHALL NOT warn regardless of its `last_cooked` value, so an empty or partial log does not flag the existing corpus.

#### Scenario: Drift between last_cooked and the log warns

- **WHEN** a recipe's `last_cooked` is earlier than its newest `cooking_log` entry
- **THEN** the build prints a warning naming the recipe and both dates, and still exits successfully

#### Scenario: Recipe absent from the log does not warn

- **WHEN** a recipe has a non-null `last_cooked` but no `cooking_log` entries
- **THEN** the build does not warn about that recipe

### Requirement: Controlled vocabulary for variety dimensions

The system SHALL validate recipe frontmatter `protein` and `cuisine` against controlled allowed-value sets (coarse buckets — e.g. `fish` rather than `salmon`) so variety reasoning is reliable. A `protein` or `cuisine` value **present** but outside its allowed set SHALL be a hard build failure naming the offending value, recipe, and field. Absence of `protein` or `cuisine` SHALL retain the existing warn-only treatment, not a hard failure. The allowed sets SHALL be defined in the validator (alongside the `status` enum) and documented in `docs/SCHEMAS.md`.

#### Scenario: Out-of-vocabulary protein blocks the build

- **WHEN** a recipe declares `protein: salmon` and `salmon` is not in the allowed protein set (e.g. it collapses to `fish`)
- **THEN** the build exits non-zero and reports the invalid value, recipe, and field

#### Scenario: In-vocabulary value passes

- **WHEN** a recipe declares `protein: fish` and `cuisine: filipino`, both in their allowed sets
- **THEN** validation passes for those fields

#### Scenario: Absent dimension warns but does not fail

- **WHEN** a recipe omits `protein`
- **THEN** the build warns (per the existing soft rule) and still exits successfully

### Requirement: Ready-to-eat catalog structural validation

The system SHALL structurally validate a member's `users/<username>/ready_to_eat.toml` — both in the Node validator (`scripts/build-indexes.mjs`, when run over a data checkout) and in the Worker's write-time structural subset (`src/validate.ts`). Validation SHALL hard-fail (Node: non-zero exit; Worker: structured error, no commit) when: the file does not parse as TOML; an item omits `name` or `slug`; an item's `meal` is outside the enum (`breakfast`, `lunch`, `dinner`); an item's `status` is outside the enum (`active`, `draft`, `rejected`); an item's `rating` is present but not an integer in the rating range; or two items in the file share the same `slug`.

#### Scenario: Unknown meal blocks the write

- **WHEN** a `ready_to_eat.toml` item declares `meal = "brunch"`
- **THEN** validation hard-fails and reports the invalid `meal` and the offending item

#### Scenario: Duplicate slug blocks the write

- **WHEN** two items in a member's `ready_to_eat.toml` share the same `slug`
- **THEN** validation hard-fails and names the duplicated `slug`

#### Scenario: Well-formed catalog passes

- **WHEN** every item carries a `name`, a unique `slug`, a valid `meal`, a valid `status`, and any `rating` is an integer in range
- **THEN** validation passes for the catalog

### Requirement: Controlled vocabulary for required equipment

The system SHALL validate recipe frontmatter `requires_equipment` against a controlled allowed-value set (`EQUIPMENT_VOCAB`) of slugs naming gear a dish is genuinely impossible without (the "no recipe-preserving workaround exists" test — deliberately small). A `requires_equipment` entry **present** but outside the allowed set SHALL be a hard build failure naming the offending value, recipe, and field. Absence of `requires_equipment` (or an empty array) SHALL NOT be a failure or a warning. The allowed set SHALL be defined in the validator (alongside the `protein`/`cuisine`/`status` sets) and documented in `docs/SCHEMAS.md`. The Worker write path for recipes SHALL accept `requires_equipment` as a loose array (no Worker-side vocabulary enforcement), because the makeability gate reads only `_indexes/recipes.json`, which only the build regenerates — so an off-vocabulary slug cannot reach the gate without the build, which fails first.

#### Scenario: Out-of-vocabulary equipment blocks the build

- **WHEN** a recipe declares `requires_equipment: ["panini-press"]` and `panini-press` is not in `EQUIPMENT_VOCAB`
- **THEN** the build exits non-zero and names the offending value, recipe, and field

#### Scenario: In-vocabulary equipment passes

- **WHEN** a recipe declares `requires_equipment: ["pressure-cooker", "blender"]`, both in `EQUIPMENT_VOCAB`
- **THEN** the build accepts the recipe and carries the array into the index

#### Scenario: Absent equipment requirement passes silently

- **WHEN** a recipe omits `requires_equipment`
- **THEN** the build neither fails nor warns and treats the recipe as makeable by everyone

### Requirement: Kitchen inventory structural validation

The system SHALL structurally validate a member's `users/<username>/kitchen.toml` — both in the Node validator (`scripts/build-indexes.mjs`, when run over a data checkout) and in the Worker's write-time structural subset (`src/validate.ts`). Validation SHALL hard-fail (Node: non-zero exit; Worker: structured error, no commit) when: the file does not parse as TOML; `owned` is present but not an array of strings; or an `owned` entry is a slug outside `EQUIPMENT_VOCAB`. The `[notes]` table SHALL be freeform and SHALL NOT be schema-validated beyond parsing. An absent `kitchen.toml` SHALL be valid.

#### Scenario: Off-vocabulary owned slug fails

- **WHEN** a `kitchen.toml` lists `owned = ["air-fryer"]` and `air-fryer` is not in `EQUIPMENT_VOCAB`
- **THEN** validation hard-fails and names the offending slug

#### Scenario: Freeform notes pass

- **WHEN** a `kitchen.toml` has valid `owned` slugs and an arbitrary `[notes]` table
- **THEN** validation passes, parse-checking but not schema-validating `[notes]`

#### Scenario: Absent kitchen file passes

- **WHEN** a member has no `kitchen.toml`
- **THEN** validation passes (an unknown inventory is valid)

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


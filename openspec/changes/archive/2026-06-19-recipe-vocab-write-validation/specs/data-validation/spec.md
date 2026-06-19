## MODIFIED Requirements

### Requirement: Controlled vocabulary for variety dimensions

The system SHALL validate recipe frontmatter `protein` and `cuisine` against controlled allowed-value sets (coarse buckets — e.g. `fish` rather than `salmon`) so variety reasoning is reliable. This validation SHALL run in **both** the Node index-build validator (`scripts/build-indexes.mjs`) and the Worker's write-time structural subset (`src/validate.ts`), drawing the allowed sets from a single shared definition so the two cannot drift. A `protein` or `cuisine` value **present** but outside its allowed set SHALL be a hard failure naming the offending value, recipe, and field — Node: non-zero exit; Worker: a structured `validation_failed` error that aborts the commit. The Worker recipe write path SHALL normalize a `protein`/`cuisine` whose value is the literal string `none` (or the empty string) to **absent** before persisting, since "no protein focus" is a legitimate state and absence is warn-only — such a value is therefore written as absent rather than rejected. Absence of `protein` or `cuisine` SHALL retain the existing warn-only treatment, not a hard failure. The allowed sets SHALL be documented in `docs/SCHEMAS.md`.

#### Scenario: Out-of-vocabulary protein blocks the build

- **WHEN** a recipe declares `protein: salmon` and `salmon` is not in the allowed protein set (e.g. it collapses to `fish`)
- **THEN** the build exits non-zero and reports the invalid value, recipe, and field

#### Scenario: Out-of-vocabulary protein is rejected at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `protein: shrimp` (not in the allowed set; the bucket is `shellfish`)
- **THEN** the Worker returns a structured `validation_failed` error naming the field and value, and makes no commit

#### Scenario: A `none` protein is normalized to absent at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `protein: none` (or an empty string)
- **THEN** the recipe is written with `protein` absent (not rejected), and the build later treats it as the warn-only missing-field case

#### Scenario: In-vocabulary value passes

- **WHEN** a recipe declares `protein: fish` and `cuisine: filipino`, both in their allowed sets
- **THEN** validation passes for those fields

#### Scenario: Absent dimension warns but does not fail

- **WHEN** a recipe omits `protein`
- **THEN** the build warns (per the existing soft rule) and still exits successfully

### Requirement: Controlled vocabulary for required equipment

The system SHALL validate recipe frontmatter `requires_equipment` against a controlled allowed-value set (`EQUIPMENT_VOCAB`) of slugs naming gear a dish is genuinely impossible without (the "no recipe-preserving workaround exists" test — deliberately small). A `requires_equipment` entry **present** but outside the allowed set SHALL be a hard failure naming the offending value, recipe, and field. Absence of `requires_equipment` (or an empty array) SHALL NOT be a failure or a warning. This validation SHALL run in **both** the Node index-build validator (`scripts/build-indexes.mjs`) and the Worker's write-time structural subset (`src/validate.ts`), drawing `EQUIPMENT_VOCAB` from the same shared definition as the kitchen-inventory check — so an off-vocabulary slug on a recipe write is rejected at the write boundary (structured error, no commit) rather than only post-push at build time. Cross-reference and index-level checks (which need the whole corpus) remain the build's job; only the vocabulary subset is enforced in the Worker.

#### Scenario: Out-of-vocabulary equipment blocks the build

- **WHEN** a recipe declares `requires_equipment: ["panini-press"]` and `panini-press` is not in `EQUIPMENT_VOCAB`
- **THEN** the build exits non-zero and names the offending value, recipe, and field

#### Scenario: Out-of-vocabulary equipment is rejected at write time

- **WHEN** `create_recipe` or `update_recipe` persists a recipe with `requires_equipment: ["air-fryer"]` and `air-fryer` is not in `EQUIPMENT_VOCAB`
- **THEN** the Worker returns a structured `validation_failed` error naming the offending slug, and makes no commit

#### Scenario: In-vocabulary equipment passes

- **WHEN** a recipe declares `requires_equipment: ["pressure-cooker", "blender"]`, both in `EQUIPMENT_VOCAB`
- **THEN** the build accepts the recipe and carries the array into the index

#### Scenario: Absent equipment requirement passes silently

- **WHEN** a recipe omits `requires_equipment`
- **THEN** the build neither fails nor warns and treats the recipe as makeable by everyone

## ADDED Requirements

### Requirement: Single source of truth for controlled vocabularies

The controlled vocabularies for recipe variety and makeability dimensions — `PROTEIN_VOCAB`, `CUISINE_VOCAB`, and `EQUIPMENT_VOCAB` — SHALL be defined exactly once, in a shared module imported by both the Worker write-time validator (`src/validate.ts`, and the kitchen check) and the Node index-build validator (`scripts/build-indexes.mjs`). Neither validator SHALL define its own copy of any of these sets. This guarantees the write-time gate and the build-time gate can never disagree about what a legal value is. If a platform constraint makes a shared import infeasible and a copy is unavoidable, an automated test SHALL assert the copies are byte-for-byte equal, failing CI on any drift.

#### Scenario: One definition feeds both validators

- **WHEN** a value is added to or removed from a controlled vocabulary
- **THEN** the change is made in the single shared module and both the Worker validator and the Node build validator observe it without any second edit

#### Scenario: Drift is impossible (or caught)

- **WHEN** the Worker and build validators are exercised against the same off-vocabulary recipe value
- **THEN** both reject it identically — because they resolve the same shared set (or, if a copy exists, the parity test fails CI before they can disagree)

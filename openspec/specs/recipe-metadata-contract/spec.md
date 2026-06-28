# recipe-metadata-contract Specification

## Purpose
TBD - created by archiving change require-indexable-recipe-fields. Update Purpose after archive.
## Requirements
### Requirement: System-consumed recipe fields are required and present

The required-field contract SHALL govern only the **authored** frontmatter fields — the gates and identity a human authors or corrects. The required authored set SHALL be: `title`, `source`, `time_total`, `dietary`, `requires_equipment`, and `pairs_with`. Presence is **blunt-uniform**: a required field SHALL be present on every recipe even when its value is empty, expressed through the field's explicit empty form (`null` or `[]`) rather than by omission. A recipe missing any required authored field SHALL be a hard failure — at Worker write time (`validation_failed`, no commit) and at reconcile time (skip-and-record).

The **descriptive facets** `protein`, `cuisine`, `course`, `season`, and `tags` are **optional authored overrides** (Tier B): absent → derived by the classify pass; present → an authored override that SHALL be validated against its controlled vocabulary where one exists (see *Optional Tier B overrides are validated when present*). The **derived facets** `ingredients_key`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` (Tier A) and the `description` are **not** authored frontmatter — they are produced into D1 (see `recipe-facet-derivation` and `derived-recipe-metadata`) and are neither required nor validated by this contract.

#### Scenario: A missing required authored field is rejected

- **WHEN** a recipe write or a reconciled recipe omits `dietary` (or any other required authored field)
- **THEN** the validator hard-fails naming the missing field and recipe, and the recipe is neither committed nor indexed

#### Scenario: An explicit empty value satisfies presence

- **WHEN** a recipe carries `dietary: []`, `pairs_with: []`, and `requires_equipment: []`
- **THEN** the validator accepts those fields as present (the empty form is a value, not an omission)

#### Scenario: A derived facet is not required in frontmatter

- **WHEN** a recipe write or a reconciled recipe carries no `ingredients_key`, `perishable_ingredients`, `side_search_terms`, or `description`
- **THEN** the contract does not require, warn on, or reject any of them — they are derived fields owned by `recipe-facet-derivation` / `derived-recipe-metadata`, not the frontmatter contract

#### Scenario: An absent Tier B facet is accepted

- **WHEN** a recipe omits `protein` and `cuisine` from frontmatter
- **THEN** the contract accepts the recipe (the facets are derived by the classify pass), rather than hard-failing on a missing required field

### Requirement: Per-field empty semantics for required recipe fields

The required **authored** fields SHALL fall into these empty-form shapes, enforced identically at write time and reconcile time:

- **Non-empty** (no valid empty form; empty is a hard failure): `title` SHALL be a non-empty string.
- **Explicit-`null` scalar** (a real value or the literal `null`, never omitted): `time_total` SHALL be a number or `null`; `source` SHALL be a string or `null`. `null` is the canonical "no value" form.
- **May-be-empty array** (always present; `[]` is a legal value): `dietary`, `pairs_with`, and `requires_equipment` SHALL each be an array of strings, possibly empty. `requires_equipment` entries SHALL be `EQUIPMENT_VOCAB` slugs; a non-empty array of off-vocabulary slugs SHALL be rejected.

The optional Tier B facets and the derived facets are **not** governed by this requirement (see *Optional Tier B overrides are validated when present* and `recipe-facet-derivation`).

#### Scenario: Empty non-empty-field is rejected

- **WHEN** a recipe carries `title: ""`
- **THEN** the validator hard-fails — an empty value is not a legal form for `title`

#### Scenario: Empty arrays are accepted for may-be-empty fields

- **WHEN** a recipe with no dietary labels and no plating edges carries `dietary: []` and `pairs_with: []`
- **THEN** the validator accepts both as present-and-empty

#### Scenario: An off-vocabulary equipment slug is rejected

- **WHEN** a recipe carries `requires_equipment: ["air-fryer"]`
- **THEN** the validator hard-fails naming the off-vocabulary slug, at both the write gate and the reconcile gate

### Requirement: Free-form frontmatter is preserved as open passthrough

Frontmatter fields outside the required authored set and the optional Tier B set SHALL remain optional and free-form (e.g. `veg_forward`, `difficulty`, `style`, `servings`, `time_active`, `discovered_at`, `discovery_source`). The validators SHALL NOT require, warn on, or reject these fields; they SHALL pass through untouched into the recipe's `extra` projection. This is the "defined required surface + open passthrough" posture, parallel to `preferences`' defined surface plus `custom` bag.

#### Scenario: An unknown field passes through untouched

- **WHEN** a recipe carries `veg_forward: true` and a novel `plating_notes` field
- **THEN** validation neither requires nor rejects them, and both ride into the recipe's `extra` data unchanged

#### Scenario: A free-form field is never warned about

- **WHEN** a recipe omits `veg_forward`
- **THEN** the reconcile emits no warning — free-form fields carry no presence expectation

### Requirement: The required-field contract has a single shared source of truth

The required-field contract SHALL be defined exactly once in a shared module
(`src/recipe-contract.js`, a sibling to `src/vocab.js`) — the field list, each field's
empty-form shape, and the conditional `side_search_terms` rule — and imported by both the
Worker write-time validator (`src/validate.ts`) and the Worker reconcile
(`src/recipe-projection.ts`). Neither validator SHALL define its own copy of the contract.
This guarantees the write-time gate and the reconcile gate can never disagree about what a
compliant recipe is. If a platform constraint makes a shared import infeasible and a copy is
unavoidable, an automated test SHALL assert the copies are equal, failing CI on any drift.

#### Scenario: One definition feeds both validators

- **WHEN** a field is added to or removed from the required set
- **THEN** the change is made once in the shared module and both validators observe it without a second edit

#### Scenario: Both validators agree on a non-compliant recipe

- **WHEN** the Worker and build validators are exercised against the same recipe missing a required field
- **THEN** both reject it identically — they resolve the same shared contract (or the parity test fails CI before they can disagree)

### Requirement: Season is a controlled vocabulary

The `season` facet SHALL be a **controlled vocabulary** — `spring`, `summer`, `fall`, `winter` — defined once as the shared `SEASON_VOCAB`. `season` is an optional Tier B facet (derived by the classify pass; an authored value is an override). Wherever a `season` value enters the system — as an **authored override** at write/reconcile time, or as **classifier output** — it SHALL be validated against `SEASON_VOCAB`: an entry outside the vocabulary SHALL be a hard failure that names the offending value (at the Worker, `validation_failed`, no commit; at reconcile, skip-and-record; in the classifier path, a corrective retry then park). `[]` (year-round) remains a legal value.

The read path SHALL remain tolerant: a deterministic consumer that matches a recipe's effective `season` against a derived current season SHALL normalize before comparison — case-folding and mapping `autumn` to `fall` — so a legacy value still matches. Read-side normalization does not rewrite the stored value.

#### Scenario: Canonical season tokens are accepted

- **WHEN** a recipe carries an authored override `season: ["summer", "fall"]` (or the classifier derives `season: []`)
- **THEN** the value is accepted by the validating gate (write/reconcile for an override; the contract backstop for classifier output)

#### Scenario: An off-vocabulary season is rejected

- **WHEN** an authored override carries `season: ["monsoon"]` or the synonym `season: ["autumn"]`
- **THEN** the gate hard-fails naming `season`, pointing to `fall` over `autumn`

#### Scenario: A legacy synonym still matches on read

- **WHEN** a consumer matches a recipe carrying `season: ["Autumn"]` against a current season of `fall`
- **THEN** the consumer normalizes `"Autumn"` to `fall` (case-fold + synonym) and the recipe matches, with no rewrite of the stored value

### Requirement: Optional Tier B overrides are validated when present

An authored Tier B facet (`protein`, `cuisine`, `course`, `season`, `tags`) is optional, but when present in frontmatter it SHALL be validated by the shared contract exactly as a required field of the same shape would be: `protein` and `cuisine` SHALL be a value from their controlled vocabulary or `null`; `season` SHALL be a `SEASON_VOCAB` array; `course` SHALL be a non-empty array of strings (open vocabulary); `tags` SHALL be an array of strings. An absent Tier B facet SHALL NOT be a contract violation. The same shared module (`src/recipe-contract.js`) SHALL validate both authored overrides and the classify pass's output, so the override gate and the classifier gate cannot disagree.

#### Scenario: A present override is vocab-validated

- **WHEN** a recipe carries an authored override `cuisine: "klingon"`
- **THEN** the contract hard-fails naming `cuisine` as off-vocabulary, the same gate that validates classifier output

#### Scenario: An absent override is not a violation

- **WHEN** a recipe omits `cuisine`
- **THEN** the contract accepts the recipe and the classify pass supplies the effective `cuisine`


# recipe-authoring-vault Specification

## Purpose
TBD - created by archiving change obsidian-authoring-vault. Update Purpose after archive.
## Requirements
### Requirement: A generated, distributable Obsidian authoring vault

The repo SHALL produce a preconfigured Obsidian vault that corpus authors use to write recipes, built by a deterministic script (`scripts/build-vault.mjs`) from authored source (`vault-template/`) into a committed output, with a `--check` validate-only mode. The built vault SHALL NOT be hand-edited (the authored source is `vault-template/`), mirroring the repo's existing generated-artifact discipline (`plugin/`, `admin/dist/`). The vault SHALL ship its `.obsidian/` configuration (enabled plugins, settings, a recipe template, help text) so it is usable on open, subject to Obsidian's one-time trust of community plugins.

#### Scenario: The vault is built from source, not hand-edited

- **WHEN** the authoring vault changes
- **THEN** the change is made in `vault-template/` and the vault is rebuilt by `build-vault.mjs` (verifiable with `--check`), and the committed built vault is not edited by hand

#### Scenario: The built vault opens ready to author

- **WHEN** an author opens the distributed vault and trusts its plugins
- **THEN** the recipe fileClass, the new-recipe template, and the help note are present and usable with no further setup

### Requirement: Vocab-bound fields are constrained dropdowns generated from the single source of truth

For every recipe frontmatter field the vault exposes that is bound to a controlled vocabulary — `requires_equipment` (an authored gate) and the optional Tier B overrides `protein`, `cuisine`, `season` (plus the open `course` set) — the vault SHALL present a constrained Select/Multi dropdown whose options are **generated from `src/vocab.js`**, the same source the server-side validator uses. The Tier B dropdowns are **optional-override** controls: an author MAY leave them blank to let the classify pass derive the value, and a value they do pick is an authored override. The generation SHALL be drift-gated: CI SHALL run `build-vault --check` and fail if the vault's options diverge from `vocab.js`. An author SHALL be unable to enter an off-vocabulary value for these fields through the vault's normal editing flow.

#### Scenario: An author cannot type an off-vocabulary value

- **WHEN** an author sets `protein` as an override on a recipe in the vault
- **THEN** they choose from a dropdown constrained to `PROTEIN_VOCAB`, and an off-vocabulary value such as `poltry` is not selectable

#### Scenario: A blank Tier B dropdown defers to the classifier

- **WHEN** an author leaves `cuisine` blank in the vault
- **THEN** no `cuisine` is authored, and the classify pass derives the effective value — leaving it blank is a valid choice, not a missing required field

#### Scenario: Vocab change to dropdown options is gated

- **WHEN** `src/vocab.js` changes and the vault is not rebuilt
- **THEN** `build-vault --check` fails in CI, flagging the drift between the dropdown options and the source of truth

#### Scenario: Dropdowns and the server validator agree

- **WHEN** the vault is built from `vocab.js`
- **THEN** the values its dropdowns allow are exactly the values the reconcile's `validate.ts` accepts for an authored override, by construction

### Requirement: The vault schema exposes only human-authored fields

The vault's recipe schema SHALL include only fields a human authors or corrects — the authored gates and identity (`title`, `source`, `time_total`, `dietary`, `requires_equipment`, `pairs_with`) plus the optional Tier B override dropdowns (`protein`, `cuisine`, `course`, `season`, `tags`) — and SHALL omit the derived facets owned by the Worker: `description` (per `derived-recipe-metadata`) and the Tier A facets `ingredients_key`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` (per `recipe-facet-derivation`). A derived field SHALL NOT appear as an authoring control in the vault, because no human authors it. The new-recipe template SHALL scaffold identity + gates + body, with the Tier B overrides available but optional.

#### Scenario: A derived field is absent from the authoring schema

- **WHEN** an author creates a recipe with the vault's new-recipe template
- **THEN** the template scaffolds the authored gates, the optional Tier B overrides, and the body, but contains no `description`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`, or `meal_preppable` control (all are derived into D1)

#### Scenario: The authoring surface centers on the gates

- **WHEN** an author opens the new-recipe template
- **THEN** the required controls are the gates and identity (`dietary`, `requires_equipment`, `title`, `source`, `time_total`, `pairs_with`), and the descriptive facets are optional overrides rather than required fields

### Requirement: Client-side validation complements, not replaces, the server validator

The vault's constrained dropdowns SHALL be a convenience and a fast-feedback aid at the editing surface; the Worker reconcile's server-side validation SHALL remain authoritative. The system SHALL NOT assume vault-authored content is valid without server validation (an author may edit outside the vault or with plugins disabled).

#### Scenario: Server validation still runs on vault-authored content

- **WHEN** content authored in the vault syncs to the corpus
- **THEN** the reconcile validates it server-side as it would any edit, and the dropdowns' client-side constraint does not bypass that backstop


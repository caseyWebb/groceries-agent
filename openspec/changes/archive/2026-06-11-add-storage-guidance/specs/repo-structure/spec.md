## MODIFIED Requirements

### Requirement: Stub data files match SCHEMAS.md

The data repository SHALL include stub TOML data files for every data file named in SCHEMAS.md, placed where each is owned per the split (shared at the root, personal under `users/<username>/`). Each stub SHALL contain a header comment naming the file and its purpose, and SHALL include commented-out example entries that match the field names and shapes in SCHEMAS.md. Stub files SHALL parse as valid (empty or comment-only) TOML.

The **shared (root)** stubs are: `substitutions.toml`, `aliases.toml`, and `skus/kroger.toml`. The **per-user** (`users/<username>/`) stubs are: `pantry.toml`, `preferences.toml`, `feeds.toml`, `stockup.toml`, and `ready_to_eat.toml`.

#### Scenario: Every stub TOML parses

- **WHEN** a TOML parser reads any stub data file in either repository
- **THEN** it parses without error, yielding an empty or comment-only document

#### Scenario: Stubs document their schema by example

- **WHEN** a stub data file is opened
- **THEN** it carries a header comment and commented-out example entries matching the field names and shapes in SCHEMAS.md

### Requirement: Shared data at the repository root

The data repository **root** SHALL hold the data shared by all members: the recipe **content** under `recipes/`, the shared reference data (`aliases.toml` and the default `substitutions.toml`), the shared `skus/kroger.toml` SKU cache, the curated `storage_guidance/` content tree, and the generated `_indexes/`. The root SHALL NOT contain any per-member subjective or personal data — including ready-to-eat catalogs, which are per-tenant (that lives under `users/<username>/`).

#### Scenario: Root carries content and reference data

- **WHEN** the data repository root is inspected
- **THEN** it contains `recipes/`, the shared reference data and SKU cache, the `storage_guidance/` tree, and `_indexes/`, and no per-member pantry, overlay, notes, or ready-to-eat catalog at the root

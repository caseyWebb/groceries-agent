## ADDED Requirements

### Requirement: Single private data repository with per-user subtrees

The deployment SHALL use **one private** data repository on the operator's account (no GitHub org and no per-member repository). A single GitHub App installation on the operator's account, scoped to that repository, SHALL grant the Worker read and write access. The repository SHALL be **private** because it holds every member's personal state. Members SHALL NOT be required to own or operate any infrastructure (no Worker, no Kroger app) and SHALL NOT be required to have a GitHub account — the Worker writes on their behalf via the App, and identity is an operator-issued invite code.

#### Scenario: One private repo holds shared content plus every member's subtree

- **WHEN** the data repository is inspected
- **THEN** it is private and contains shared content/reference data at the root plus one `users/<username>/` subtree per member, all covered by a single GitHub App installation on the operator's account, with no org and no per-member repository

#### Scenario: A member owns no infrastructure and needs no GitHub account

- **WHEN** a member is onboarded
- **THEN** they need only a Claude.ai account, a Kroger account, and an operator-issued invite code — no Worker deploy, no Kroger Developer app, and no GitHub account of their own

### Requirement: Shared data at the repository root

The data repository **root** SHALL hold the data shared by all members: the recipe **content** under `recipes/`, the shared reference data (`aliases.toml`, `ingredients.toml`, and the default `substitutions.toml`), the shared `skus/kroger.toml` SKU cache, the `ready_to_eat/` catalogs, and the generated `_indexes/`. The root SHALL NOT contain any per-member subjective or personal data (that lives under `users/<username>/`).

#### Scenario: Root carries content and reference data

- **WHEN** the data repository root is inspected
- **THEN** it contains `recipes/`, the shared reference data and SKU cache, `ready_to_eat/`, and `_indexes/`, and no per-member pantry, overlay, or notes at the root

### Requirement: Per-user subtree layout

Each member's `users/<username>/` subtree SHALL hold only that member's personal state: `pantry.toml`, `preferences.toml`, `stockup.toml`, `grocery_list.toml`, the narrative `taste.md` and `diet_principles.md`, the agent-writable `cooking_log.toml` and `meal_plan.toml`, `feeds.toml`, the subjective-field `overlay.toml`, recipe notes under `notes/`, any personal (unshared) recipes, and any per-member `substitutions` override. It SHALL NOT duplicate shared root content. The Worker SHALL address a member's files by prefixing repo-relative paths with their `users/<username>/`, so one member's request can never reach another member's subtree.

#### Scenario: Per-user subtree carries personal state and overlay

- **WHEN** a member's `users/<username>/` subtree is inspected
- **THEN** it contains that member's pantry/preferences/taste/diet_principles/grocery_list/stockup/cooking_log/meal_plan/feeds, an `overlay.toml` of subjective recipe fields, a `notes/` directory, and any personal recipes — and does not duplicate shared root content

## MODIFIED Requirements

### Requirement: Stub data files match SCHEMAS.md

The data repository SHALL include stub TOML data files for every data file named in SCHEMAS.md, placed where each is owned per the split (shared at the root, personal under `users/<username>/`). Each stub SHALL contain a header comment naming the file and its purpose, and SHALL include commented-out example entries that match the field names and shapes in SCHEMAS.md. Stub files SHALL parse as valid (empty or comment-only) TOML.

The **shared (root)** stubs are: `substitutions.toml`, `aliases.toml`, `ingredients.toml`, `skus/kroger.toml`, `ready_to_eat/breakfast.toml`, `ready_to_eat/lunch.toml`, and `ready_to_eat/dinner.toml`. The **per-user** (`users/<username>/`) stubs are: `pantry.toml`, `preferences.toml`, `feeds.toml`, and `stockup.toml`.

#### Scenario: Every stub TOML parses

- **WHEN** a TOML parser reads any stub data file in either repository
- **THEN** it parses without error, yielding an empty or comment-only document

#### Scenario: Stubs document their schema by example

- **WHEN** a developer opens a stub data file
- **THEN** it contains a header comment and commented-out example entries whose field names match the corresponding schema in SCHEMAS.md

#### Scenario: ingredients.toml is reserved and empty

- **WHEN** a developer opens the shared corpus `ingredients.toml`
- **THEN** it is present but contains only a header comment marking it RESERVED for Phase 7, with no active entries

#### Scenario: Data files live where they are owned

- **WHEN** the data repository root and a `users/<username>/` subtree are inspected
- **THEN** shared reference/catalog/SKU files live at the root and personal files (pantry, preferences, feeds, stockup) live under `users/<username>/`, with no duplication

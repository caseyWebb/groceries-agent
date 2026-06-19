## ADDED Requirements

### Requirement: Recipe write tools enforce controlled vocabularies

The recipe write tools — `create_recipe`, `update_recipe`, and the `recipe_updates` field of `commit_changes` — SHALL reject a write whose recipe frontmatter carries a `protein`, `cuisine`, or `requires_equipment` value outside its controlled vocabulary, returning a structured `validation_failed` error (naming the offending field and value) and making **no commit**. Enforcement SHALL occur at the commit engine's `validateFile` step, so every recipe write path is covered uniformly and none can bypass it. Before this check, the recipe write path SHALL normalize a `protein`/`cuisine` value of the literal string `none` (or the empty string) to **absent**, so a no-protein-focus dish is persisted with the field omitted rather than rejected. The `create_recipe` and `update_recipe` tool descriptions SHALL enumerate the `protein` and `cuisine` controlled sets (as the `create_recipe` description already enumerates the equipment set) and SHALL state that `protein` is omitted for a dish with no protein focus — never written as `none`.

#### Scenario: Off-vocabulary protein is rejected before commit

- **WHEN** `create_recipe` is called with frontmatter `protein: shrimp` (the bucket is `shellfish`)
- **THEN** the tool returns a structured `validation_failed` error naming `protein` and `shrimp`, and no recipe file is committed

#### Scenario: No-protein dish writes cleanly via normalization

- **WHEN** `create_recipe` is called with frontmatter `protein: none` for a vegetable side or condiment
- **THEN** the recipe is committed with `protein` absent (no error), and the agent is not forced into a retry

#### Scenario: Off-vocabulary equipment is rejected before commit

- **WHEN** `update_recipe` is called with `requires_equipment: ["air-fryer"]` and `air-fryer` is not in the equipment vocabulary
- **THEN** the tool returns a structured `validation_failed` error naming the offending slug, and no change is committed

#### Scenario: In-vocabulary recipe write succeeds

- **WHEN** `create_recipe` is called with `protein: shellfish`, `cuisine: thai`, and `requires_equipment: []`, all legal
- **THEN** the recipe is committed normally and the tool returns the slug and commit sha

#### Scenario: Tool descriptions surface the controlled sets

- **WHEN** the `create_recipe` / `update_recipe` tool schemas are presented to the agent
- **THEN** their descriptions list the allowed `protein` and `cuisine` values and the "omit `protein` when there is no protein focus — never `none`" rule

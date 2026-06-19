## ADDED Requirements

### Requirement: Protein and cuisine classification draws from the controlled vocabulary

When a recipe is imported or created, the system SHALL classify `protein` and `cuisine` to their **coarse controlled buckets** (the sets enforced at write and build time — e.g. `fish` not `salmon`, `shellfish` not `shrimp`), in the same enrichment step that derives the other objective fields (`course`, `perishable_ingredients`, `requires_equipment`). A specific ingredient SHALL be mapped to its bucket rather than written verbatim (shrimp → `shellfish`, salmon/cod/tuna → `fish`). When a dish has **no protein focus** — a vegetable side, a plain noodle or grain dish, a condiment — the classifier SHALL **omit** `protein` (absence is warn-only and legitimate) rather than invent an off-vocabulary value such as `none`. The controlled sets SHALL be surfaced to the classifying agent (the `create_recipe`/`update_recipe` tool descriptions and `AGENT_INSTRUCTIONS.md`), and an off-vocabulary value that nonetheless reaches a write SHALL be rejected by the write tool with a structured error, prompting reclassification, rather than being persisted.

#### Scenario: Specific protein is mapped to its bucket

- **WHEN** a shrimp curry is imported
- **THEN** the classifier writes `protein: shellfish` (the bucket), not `protein: shrimp`

#### Scenario: No-protein-focus dish omits protein

- **WHEN** a radish condiment or a plain cold-noodle dish is imported
- **THEN** the classifier omits `protein` (leaving it absent) rather than writing `protein: none`

#### Scenario: An off-vocabulary value is corrected, not persisted

- **WHEN** the classifier nonetheless emits an off-vocabulary `protein`/`cuisine`/`requires_equipment` value on a write
- **THEN** the write tool returns a structured `validation_failed` error and the recipe is not committed until the value is reclassified to a legal bucket (or, for `protein`/`cuisine`, omitted)

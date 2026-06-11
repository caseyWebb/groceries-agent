## ADDED Requirements

### Requirement: Perishable-ingredient waste callout

When assembling a menu proposal, for each perishable that a proposed recipe uses in **less than a typical purchase unit** (a partial-package amount — judged by the agent from the recipe body plus its own knowledge of how the item is sold, e.g. 2 tbsp of cilantro from a bunch; **no Kroger lookup**), the agent SHALL determine whether another recipe in the proposal also uses that perishable. If none does, it SHALL offer either to add a recipe that uses up the remainder or to swap the recipe. The agent SHALL make this determination by **reasoning over the `perishable_ingredients` already present in the recipe index** (and in `list_recipes` results it already holds) — it SHALL NOT require a dedicated perishable-search or filter tool. A perishable consumed in roughly a full purchase unit (no meaningful leftover), or already shared by another proposed recipe, SHALL NOT trigger a callout.

#### Scenario: Partial-unit, unshared perishable triggers a callout

- **WHEN** a proposed recipe uses a partial purchase unit of cilantro (e.g. a few tablespoons from a bunch) and no other proposed recipe lists cilantro in its `perishable_ingredients`
- **THEN** the agent flags the likely leftover and offers to add a recipe that uses cilantro up, or to swap the recipe

#### Scenario: Full-unit use does not trigger a callout

- **WHEN** a proposed recipe uses roughly a whole purchase unit of a perishable (no meaningful remainder)
- **THEN** no waste callout is raised for that item, even if it is the only recipe using it

#### Scenario: Shared perishable does not trigger a callout

- **WHEN** a perishable appears in the `perishable_ingredients` of two or more proposed recipes
- **THEN** no waste callout is raised for that item

#### Scenario: Determination is reasoning over the index, not a search tool

- **WHEN** the agent evaluates leftover perishables for the proposal
- **THEN** it reasons over the `perishable_ingredients` already present in the recipe index / `list_recipes` results, with no dedicated perishable-search or filter tool and no Kroger lookup

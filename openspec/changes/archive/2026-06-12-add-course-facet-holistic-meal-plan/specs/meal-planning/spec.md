## MODIFIED Requirements

### Requirement: Transient meal plan of committed cook intent

The system SHALL maintain `meal_plan.toml` at the repo root as a transient, recipe-grain record of committed cook intent. Each `[[planned]]` entry SHALL carry a `recipe` slug and MAY carry an optional `planned_for` ISO date. A `[[planned]]` entry MAY additionally carry an optional **`sides`** array of free-text **open-world side** names (e.g. `["roasted broccoli", "white rice"]`) — sides that accompany the main on the plate but are not themselves corpus recipes and therefore have no slug. The `sides` array SHALL be advisory free text only: it SHALL NOT be slug-resolved, and the `recipe` slug invariant (and the reconcile/cook flows that key off it) SHALL be unaffected by its presence. A **corpus side** (a `course: side` recipe with a slug) SHALL instead earn its own `[[planned]]` row, not an entry in another row's `sides`. The meal plan SHALL be distinct from `grocery_list.toml`: the grocery list is ingredient-grain and holds only items to buy, so a planned recipe whose ingredients are all already in the pantry SHALL still appear in `meal_plan.toml`. Entries SHALL be cleared as they resolve — removed when the recipe is cooked, or dropped when abandoned.

#### Scenario: Planned recipe recorded even when nothing must be bought

- **WHEN** the user agrees to cook a recipe whose ingredients are all in the pantry
- **THEN** a `[[planned]]` row for that recipe is written to `meal_plan.toml` even though nothing is added to `grocery_list.toml`

#### Scenario: Cooking clears the planned row

- **WHEN** a planned recipe is cooked and logged
- **THEN** its `[[planned]]` row is removed from `meal_plan.toml` in the same commit

#### Scenario: Open-world side rides on its main's row

- **WHEN** the user agrees to a main rounded out with an open-world side ("roasted broccoli") that is not a corpus recipe
- **THEN** the main's `[[planned]]` row carries `sides = ["roasted broccoli"]`, no separate slug row is created for the side, and the row's `recipe` slug (and the reconcile) is unchanged

#### Scenario: Corpus side earns its own row

- **WHEN** the user agrees to a main paired with a `course: side` corpus recipe
- **THEN** the corpus side gets its own `[[planned]]` slug row (not a `sides` entry on the main's row)

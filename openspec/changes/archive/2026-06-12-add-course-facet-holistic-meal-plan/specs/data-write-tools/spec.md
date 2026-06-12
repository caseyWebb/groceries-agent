## ADDED Requirements

### Requirement: meal_plan_ops carries open-world sides

`commit_changes` `meal_plan_ops` SHALL accept an optional `sides` array of free-text open-world side names on an `add` operation, persisting it onto the upserted `[[planned]]` row alongside `recipe` and `planned_for`. An `add` for a recipe already present in the plan SHALL merge `sides` onto the existing row (consistent with the upsert-by-slug semantics for `planned_for`). The `sides` value SHALL be written verbatim (free text, not slug-resolved); a `remove` op SHALL drop the row and its `sides` together. No other domain or external service is touched by this field.

#### Scenario: Add op persists open-world sides on the planned row

- **WHEN** `commit_changes` is called with a `meal_plan_ops` `add` of `{ recipe: "miso-salmon", planned_for: "2026-06-14", sides: ["roasted broccoli"] }`
- **THEN** the written `[[planned]]` row carries `recipe = "miso-salmon"`, `planned_for = "2026-06-14"`, and `sides = ["roasted broccoli"]`, in the same commit as the rest of the batch

#### Scenario: Re-add merges sides onto the existing row

- **WHEN** a `[[planned]]` row for `miso-salmon` already exists and a later `add` supplies `sides`
- **THEN** the `sides` are merged onto that existing row rather than creating a duplicate row

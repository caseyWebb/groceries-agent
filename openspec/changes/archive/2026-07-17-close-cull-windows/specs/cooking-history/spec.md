# cooking-history — delta

## MODIFIED Requirements

### Requirement: Cook-capture appends to D1 via log_cooked

The system SHALL provide a cook-capture path via the `log_cooked` tool, which appends one cooking event to the caller's `cooking_log` table and returns without a `commit_sha`. It SHALL accept an optional **`meal`** (`breakfast | lunch | dinner | project`; omitted stores NULL, valid on all `type`s — cooking a planned project logs `{ type: 'recipe', meal: 'project' }`) and an optional **`plan_row_id`** addressing the exact plan row to clear. It SHALL validate the entry at write time (an ISO `date` defaulting to today; a `type` in {`recipe`, `ad_hoc`}; a `recipe` entry's slug resolved against the D1 `recipes` table; an `ad_hoc` entry requires `name`) — an unresolved slug is a structured `not_found` error written nowhere, and a missing required field is a `validation_failed` error. The retired `type: "ready_to_eat"` rejects with `validation_failed`; historical rows keep their stored type with unchanged read semantics.

#### Scenario: Recipe entry with a real slug is logged and clears one row atomically

- **WHEN** `log_cooked({ type: "recipe", recipe: "miso-salmon", meal: "dinner" })` is called and `miso-salmon` exists in `recipes` with one planned row
- **THEN** a `cooking_log` row is inserted for the caller dated today with `meal = 'dinner'`, exactly that plan row is deleted in the same D1 transaction, and the result carries `cleared_plan_row` with the row's id

#### Scenario: Recipe entry with an unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

#### Scenario: The retired type is rejected

- **WHEN** a stale caller logs `type: "ready_to_eat"`
- **THEN** the write is rejected with `validation_failed`; historical `ready_to_eat` rows still aggregate exactly as before (excluded from cadence, dims feed the mixes)

#### Scenario: Unplanned cook still logs

- **WHEN** the user asserts cooking something that was not on the meal plan
- **THEN** a `cooking_log` row is inserted without requiring a prior plan row, and no plan row is cleared

#### Scenario: The dedupe identity includes the meal

- **WHEN** the same recipe is logged twice on one date, once with `meal: "lunch"` and once with `meal: "dinner"`
- **THEN** both rows exist (different dedupe identities), while a replay of either exact `(date, meal, type, recipe)` tuple is deduplicated — and this identity is never used as plan-row identity

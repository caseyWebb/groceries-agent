# data-write-tools — delta

## MODIFIED Requirements

### Requirement: log_cooked appends a cooking event to D1

The system SHALL provide a `log_cooked` tool that appends one cooking event to the caller's `cooking_log` table in D1 and returns without a `commit_sha`. It SHALL validate the entry at write time (an ISO `date` defaulting to today; a `type` ∈ {`recipe`, `ad_hoc`}; a `recipe` entry's slug resolved against the `recipes` table; an `ad_hoc` entry requires `name`). `type: "ready_to_eat"` is rejected with `validation_failed` (the conversion window was closed by operator waiver); historical stored rows keep their type and aggregate exactly as before.

#### Scenario: Cooking event is appended without a commit

- **WHEN** `log_cooked` is called with a valid entry
- **THEN** a `cooking_log` row is inserted in D1, the tool returns `{ logged }` with no `commit_sha`, and (for a recipe entry) the recipe is removed from the meal plan in the same transaction

#### Scenario: The retired type is rejected

- **WHEN** `log_cooked` is called with `type: "ready_to_eat"`
- **THEN** the call is rejected with `validation_failed` and nothing is written


#### Scenario: Unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

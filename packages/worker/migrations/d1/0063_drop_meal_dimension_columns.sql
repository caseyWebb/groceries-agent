-- 0063_drop_meal_dimension_columns — window-close cleanup for the meal-dimension shims
-- (remove-meal-dimension-shims). Tonight's operator-directed production query confirmed
-- convergence: `lunch_strategy` and `ready_to_eat_default_action` are NULL on all 4 profile
-- rows, and `default_cooking_nights` is non-NULL on only 2 of them — both of which also carry
-- authoritative `cadence` (the read-time derivation already prefers `cadence[meal]` over the
-- frozen scalar, so the mirror was already inert on those rows). Dropping the three columns
-- loses only already-inert frozen values, never the effective cadence.
--
-- Plain ALTER TABLE DROP COLUMN — the `0012`/`0013` precedent for narrowing a table with no
-- primary-key change (no rebuild needed; see design.md's Decisions).

ALTER TABLE profile DROP COLUMN default_cooking_nights;
ALTER TABLE profile DROP COLUMN lunch_strategy;
ALTER TABLE profile DROP COLUMN ready_to_eat_default_action;

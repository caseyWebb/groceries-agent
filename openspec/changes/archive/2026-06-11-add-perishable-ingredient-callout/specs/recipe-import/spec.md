## ADDED Requirements

### Requirement: Perishable-ingredient classification at import

When a recipe is imported or created, the system SHALL classify which of its ingredients are perishable and write them to the recipe's `perishable_ingredients` frontmatter field, in the same step it derives other objective fields (protein, cuisine, etc.). The classification test SHALL be *"would the leftover rot before it would realistically be used?"* — not botanical perishability — so shelf-stable staples are excluded and a small quantity of a fast-spoiling item is included. Names SHALL be **normalized** using the same normalization the pantry-verify matcher applies, so a perishable lines up across recipes for cross-recipe comparison. The field is objective shared content written via `create_recipe` / `update_recipe`; it SHALL NOT be hand-maintained config and SHALL NOT live in any tenant overlay. A wrong classification is non-fatal (it only costs a dismissed waste nudge) and is corrected by a normal recipe edit.

#### Scenario: Import classifies perishables

- **WHEN** a recipe calling for cilantro, olive oil, and canned chickpeas is imported
- **THEN** `perishable_ingredients` is written with the perishable items (e.g. cilantro), normalized, and excludes the shelf-stable staples (olive oil, canned chickpeas)

#### Scenario: Names are normalized for cross-recipe comparison

- **WHEN** two recipes each call for fresh cilantro under different surface wording
- **THEN** both record the same normalized `perishable_ingredients` entry, so the two recipes' use of that perishable can be compared directly

### Requirement: One-time perishable backfill of the existing corpus

The system SHALL provide a one-time backfill that populates `perishable_ingredients` across the existing recipe corpus by running the same classification used at import, written as normal recipe edits. The backfill SHALL be idempotent (re-running it SHALL NOT duplicate or corrupt entries) and SHALL leave a recipe's other content unchanged.

#### Scenario: Backfill populates legacy recipes

- **WHEN** the backfill runs over recipes that predate the field
- **THEN** each gains a `perishable_ingredients` list derived by the import-time classifier, with no other content altered

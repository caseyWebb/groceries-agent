## ADDED Requirements

### Requirement: Season values draw from a canonical vocabulary

The `season` field SHALL draw from a canonical four-season vocabulary — `spring`, `summer`, `fall`, `winter` — defined once as a shared `SEASON_VOCAB` (a sibling to `PROTEIN_VOCAB` / `CUISINE_VOCAB` / `EQUIPMENT_VOCAB` in the shared vocab module). A recipe's canonical `season` SHALL use only these tokens; `[]` (year-round) remains a legal value and its presence/empty-array semantics (from *Per-field empty semantics for required recipe fields*) are unchanged.

Because `season` predates this vocabulary and has held free-form values, any deterministic consumer that matches a recipe's `season` against a **derived current season** SHALL normalize before comparison — case-folding and mapping the synonym `autumn` to `fall` — so existing recipes match correctly **without a data migration**. Normalization is performed at read time by the consumer; the stored value is not rewritten by this requirement.

#### Scenario: Canonical tokens describe a recipe's seasonality

- **WHEN** a recipe's seasonality is recorded
- **THEN** its `season` array uses only `SEASON_VOCAB` tokens (`spring | summer | fall | winter`), or `[]` for year-round

#### Scenario: A legacy synonym still matches on read

- **WHEN** a consumer matches a recipe carrying `season: ["Autumn"]` against a current season of `fall`
- **THEN** the consumer normalizes `"Autumn"` to `fall` (case-fold + synonym) and the recipe matches, with no rewrite of the stored value

#### Scenario: Year-round recipes are unaffected

- **WHEN** a recipe carries `season: []`
- **THEN** it is treated as in season in every season, unchanged by this vocabulary

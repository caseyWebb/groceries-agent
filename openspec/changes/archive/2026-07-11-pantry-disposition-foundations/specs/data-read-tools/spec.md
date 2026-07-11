# data-read-tools

## MODIFIED Requirements

### Requirement: read_pantry with partial filter support

The system SHALL provide `read_pantry(filter)` returning `{ items: [...] }`, supporting the
`category`, `location`, and `prepared_only` filters deterministically. `category` filters on
the controlled food taxonomy (`produce | dairy | meat | seafood | grains | bakery | canned |
condiments | oils | spices | baking | frozen | snacks | beverages`); `location` filters on the
kitchen location vocabulary (`fridge | freezer | pantry | spice_rack | counter | cabinet`);
returned items include both fields (either may be absent — NULL reads as
unassigned/uncategorized, never an error). For one deprecation window, a legacy
location-flavored `category` value (`pantry | fridge | freezer | spices`) SHALL be mapped onto
the corresponding `location` filter rather than returning nothing, so agents on a cached
plugin keep working across the vocabulary split. The `stale_only` filter SHALL return a
structured `unsupported` error, because freshness is an LLM-judged, prompt-resolved concern
(it depends on storage, whether a package was opened, and visual inspection — none of which is
in the repo) rather than a function the tool can compute. There is no shelf-life table backing
it: the curated `guidance/ingredient_storage/` tree informs put-away advice rather than gating
staleness.

#### Scenario: Filter by location

- **WHEN** `read_pantry({ location: "freezer" })` is invoked
- **THEN** only pantry items whose `location` is `freezer` are returned

#### Scenario: Filter by food category

- **WHEN** `read_pantry({ category: "produce" })` is invoked
- **THEN** only pantry items whose `category` is `produce` are returned

#### Scenario: A legacy category value maps onto the location filter

- **WHEN** `read_pantry({ category: "freezer" })` is invoked during the deprecation window
- **THEN** it behaves as `read_pantry({ location: "freezer" })` — items kept in the freezer are
  returned even though `freezer` is no longer a category value

#### Scenario: Prepared-only filter

- **WHEN** `read_pantry({ prepared_only: true })` is invoked
- **THEN** only items with a non-null `prepared_from` are returned

#### Scenario: Staleness not supported by the tool

- **WHEN** `read_pantry({ stale_only: true })` is invoked
- **THEN** the tool returns a structured `unsupported` error explaining that freshness is
  judged conversationally, not computed by the tool

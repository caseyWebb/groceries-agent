## ADDED Requirements

### Requirement: Attributed notes authored in the tenant's repo

The system SHALL support recipe **notes**: free-form markdown annotations attached to a recipe (shared or personal), authored in the authoring tenant's own repo (e.g. `notes/<slug>.md` or per-note entries). Each note SHALL carry its author (established structurally by the repo it lives in, not a spoofable field), a timestamp, body text, and an optional set of tags (e.g. `tweak`, `observation`). A tenant SHALL be able to attach multiple notes to the same recipe over time (append-mostly); authoring SHALL NOT modify shared recipe content.

#### Scenario: A note is authored without touching shared content

- **WHEN** tenant A adds a note "subbed gochujang for sriracha, better" to a shared recipe
- **THEN** the note is written to A's repo with A as author and a timestamp, and the shared recipe's content is unchanged

#### Scenario: Multiple notes accrete

- **WHEN** tenant A adds a second note to a recipe it has already annotated
- **THEN** both notes are retained, each with its own timestamp, rather than overwriting the first

### Requirement: Notes surfaced across the friend group

A read of a recipe's notes SHALL aggregate the non-private notes authored by all tenants in the group for that recipe, each attributed to its author, so the corpus reads as a collaborative cookbook. Aggregation SHALL be performed at read time across tenants' repos.

#### Scenario: Group notes are visible to all members

- **WHEN** tenant B reads notes for a recipe that tenant A annotated (non-private)
- **THEN** B sees A's note attributed to A, alongside B's own notes on that recipe

#### Scenario: Ratings and notes inform surfacing

- **WHEN** the agent surfaces a shared recipe a tenant has not tried
- **THEN** group signal (other tenants' notes and ratings) is available to be surfaced, e.g. "rated 4+ by others in your group"

### Requirement: Per-note privacy

A note SHALL support a `private` flag. A private note SHALL be visible only to its authoring tenant and SHALL NOT be surfaced to any other tenant. Notes default to shared (non-private) since the system is collaborative within a trusted group.

#### Scenario: Private note stays with its author

- **WHEN** tenant A marks a note `private`
- **THEN** the note appears only in A's reads of that recipe and never in any other tenant's

#### Scenario: Default note is shared

- **WHEN** tenant A adds a note without setting `private`
- **THEN** the note is shared and surfaced to the group

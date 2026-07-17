# planning-cadence — delta

## MODIFIED Requirements

### Requirement: Per-meal cadence is the planning-frequency preference

The system SHALL store the caller's cooking frequency as a per-meal **`cadence`** map — `{ breakfast, lunch, dinner }`, each an integer weekly count 0–7 — in the profile. `update_preferences` SHALL treat `cadence` as a defined key with **per-key merge semantics** consistent with the documented RFC 7396 merge-patch contract: `{ cadence: { lunch: 2 } }` sets lunch only, `{ cadence: { dinner: null } }` clears one key, and `cadence: null` clears the map — never a wholesale replacement. **`default_cooking_nights` is retired**: `update_preferences` SHALL reject it like any other unknown top-level key (the alias window closed once production convergence was verified), and `read_user_profile` SHALL NOT mirror it. Reads SHALL fall back gracefully: `read_user_profile` exports the stored map, or — when it is NULL — the fixed read-time derivation `{ breakfast: 0, lunch: 0, dinner: 5 }`. The migration SHALL have backfilled `cadence = { breakfast: 0, lunch: 0, dinner: N }` for every profile row whose `default_cooking_nights` was non-NULL — the defined column winning over any `custom`-bag shadow (precedence, not merge) — tolerating tenants with no profile row (no row created); the frozen `default_cooking_nights` column itself is now dropped, convergence having been verified (the `data-write-tools` capability).

#### Scenario: Migration maps the scalar onto the map

- **WHEN** the migration runs over a profile with `default_cooking_nights = 5`, one with NULL, one whose `custom` bag shadows a different value, and a tenant with no profile row
- **THEN** the first gets `cadence = {"breakfast":0,"lunch":0,"dinner":5}`, the NULL profile's `cadence` stays NULL, the shadowed profile's map is derived from the column (the `custom` bag is untouched and byte-identical), and the row-less tenant is untouched

#### Scenario: Read falls back to the fixed default

- **WHEN** `read_user_profile` runs for a member whose `cadence` is NULL
- **THEN** the export carries the derivation `{ breakfast: 0, lunch: 0, dinner: 5 }` and planning proceeds without error

#### Scenario: The cadence patch merges per key

- **WHEN** `update_preferences` applies `{ cadence: { lunch: 2 } }` to a stored `{"breakfast":0,"lunch":0,"dinner":5}`
- **THEN** the stored map becomes `{"breakfast":0,"lunch":2,"dinner":5}` — the other keys are preserved, not replaced

#### Scenario: The legacy key is rejected

- **WHEN** `update_preferences` receives `default_cooking_nights: 3`
- **THEN** the request is rejected like any other unknown top-level key, and the stored `cadence` is unchanged

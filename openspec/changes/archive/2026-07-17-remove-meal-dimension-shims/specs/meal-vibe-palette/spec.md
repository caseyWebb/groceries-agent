# meal-vibe-palette — delta

## MODIFIED Requirements

### Requirement: Meal-vibe CRUD is served by the meal_vibe tool family

The system SHALL expose palette **capture** on the member MCP surface as `add_meal_vibe` only; the palette is **read** through `read_user_profile().meal_vibes` (each vibe with its `meal`, `members`, and derived cadence status), and edit/remove are the member web app's vibes page over the same shared palette operations — there are no `list_meal_vibes`, `update_meal_vibe`, or `remove_meal_vibe` MCP tools, and no `*_night_vibe` alias name remains registered on any plane (the `add_night_vibe` dispatch alias, the last surviving one, closed with the `remove-meal-dimension-shims` cleanup). `add_meal_vibe` SHALL accept `meal` (default `'dinner'`) and `members`. The shared update operation SHALL keep **explicit-null field clearing**: a supplied `null` clears `cadence_days`, `base_weight`, `weather_affinity`, `weather_antipathy`, `season`, `facets`, or `members`; an absent field preserves. `meal` SHALL be settable (moving the vibe between meal palettes — no re-embed, since the embedding hash covers the phrase) but NOT nullable; `vibe` SHALL NOT be nullable. Write classes are unchanged (D15): vibe create/delete are class (b) keyed by the vibe id; vibe edit is class (a).

#### Scenario: Chat captures a vibe silently

- **WHEN** the agent calls `add_meal_vibe` with a phrase, `meal`, and metadata
- **THEN** the vibe lands in the caller's palette exactly as before, and the palette rides the next `read_user_profile`

#### Scenario: Explicit null clears a field

- **WHEN** the shared update operation (from the vibes page) is applied with `{ cadence_days: null }`
- **THEN** the vibe's `cadence_days` is cleared while every absent field is preserved

#### Scenario: Moving a vibe between meals does not re-embed

- **WHEN** the update operation sets `meal: "lunch"` on a dinner vibe without changing its phrase
- **THEN** the vibe now samples into the lunch palette and its `night_vibe_derived` embedding row is unchanged (the hash gates on the vibe text)

#### Scenario: Palette maintenance has no member chat tools

- **WHEN** the member MCP tool surface is enumerated
- **THEN** `add_meal_vibe` is the only meal-vibe tool; list/update/remove flows live on the member app's vibes page

## REMOVED Requirements

### Requirement: Deprecated night-vibe tool names dispatch onto the meal-vibe ops

**Reason**: `docs/TOOLS.md`'s meal-dimension removal condition is satisfied — the alias window closed on operator waiver (three-member deployment, operator-assisted) and the frozen-column data gate cleared (verified production convergence). `add_night_vibe` was the only one of the originally-named five old tool names still actually registered — `list_night_vibes`, `update_night_vibe`, `remove_night_vibe`, and `suggest_night_vibes` were never re-registered as chat tools once list/edit/remove moved to the member web app's vibes page, per the "Meal-vibe CRUD" requirement above. It is a hard removal with no replacement shim.

**Migration**: a stale caller invoking `add_night_vibe` receives the generic unknown-tool rejection, indistinguishable from a tool that never existed. `add_meal_vibe` is unaffected and unchanged.

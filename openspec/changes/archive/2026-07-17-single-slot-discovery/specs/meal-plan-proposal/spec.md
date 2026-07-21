# meal-plan-proposal — delta

## MODIFIED Requirements

### Requirement: Two-level meal-plan proposal

The system SHALL provide a synchronous, stateless `propose_meal_plan` tool that builds a proposed week in two levels: **(1) shape** — run **per meal**: the palette partitions by `meal`, and `sampleWeek` samples each meal's slots from that meal's vibes with that meal's count, weighted by cadence-debt as today (weather quotas apply to the dinner pass only — the `weather-bucket-planning` capability); **(2) fill** — for each slot's query vector, retrieve facet-gated candidates and select a recipe in **one** shared compose pass across all meals (one `assembleProposal`: cross-slot MMR/diversify, facet-spread, at-risk set-cover), still making at most one batched embedding call per request.

Per-meal counts SHALL come from a **`meals?: { breakfast?, lunch?, dinner? }`** parameter (each an integer 0–14, **per-window, not week-scaled**; the planning window continues to bound recurrence caps, not counts), with a per-meal default chain: explicit `meals` → the stored `cadence[meal]` → the read-time derivation (`dinner`: `default_cooking_nights ?? 5`; `breakfast`/`lunch`: 0). **`nights?`** SHALL be retained for one deprecation window as an alias for `meals.dinner = N`, ignored without error when `meals` is supplied (a docs/TOOLS.md Deprecations row). `lock`, `exclude`, `nudges`, `freeform`, `seed`, `slots[]`, and `boost_ingredients` are retained unchanged (D8/D20: the member-surface cuts are control removals only, never tool params); **`new_for_me` is retired** — accepted and ignored for one deprecation window (no error, no effect; a docs/TOOLS.md Deprecations row), discovery seeding being engine-internal (`weather-bucket-planning`). String `lock`s and the internally seeded discovery are **dinner** slots (a lock is "cook this this week" intent — dinner-shaped by construction; per-meal pinning is available via `slots[].recipe` or an `ephemeral_vibes[].meal` entry plus a pin).

The tool SHALL return a **structured** proposal (not prose): a **flat** `plan[]` in which each slot carries its **`meal`**, ordered breakfast → lunch → dinner and position-stable within each meal; per slot a chosen `main` (slug, title, description, score) with its corpus `sides`, the perishables it uses, and legibility `flags`; plus week-level `variety` diagnostics and the `diagnostics` (seed, λ, pool sizes) needed to reproduce or re-roll it — extended with `diagnostics.meals: { <meal>: { requested, filled, empty } }` and `diagnostics.attendance: { effective, ignored }`, with `diagnostics.nights` kept as the dinner alias for the deprecation window. The tool SHALL be **stateless** — it holds no proposal between calls and makes no implicit writes; committing a plan remains the caller's separate action.

#### Scenario: A request returns a shaped-and-filled multi-meal week

- **WHEN** a caller requests `meals: { breakfast: 2, dinner: 4 }`
- **THEN** the tool returns 2 breakfast slots sampled from the breakfast palette and 4 dinner slots from the dinner palette, each slot carrying its `meal`, ordered breakfast → lunch → dinner, with `diagnostics.meals` reporting per-meal requested/filled/empty — in one call

#### Scenario: Counts default from the cadence map

- **WHEN** a caller supplies no `meals` and no `nights` and their stored cadence is `{ breakfast: 0, lunch: 2, dinner: 5 }`
- **THEN** the proposal shapes 0 breakfast, 2 lunch, and 5 dinner slots

#### Scenario: The nights alias is window-scoped

- **WHEN** a caller supplies `nights: 4` and no `meals` during the deprecation window
- **THEN** the request behaves exactly as `meals: { dinner: 4 }`; and when both are supplied, `nights` is ignored without error

#### Scenario: Proposing writes nothing

- **WHEN** `propose_meal_plan` runs
- **THEN** it mutates no `meal_plan` or `grocery_list` state — proposing is read-only, and persisting the plan is a separate caller action

### Requirement: Stateless iteration and re-roll

The tool SHALL support iteration by re-invocation with constraints rather than server-held state: `lock` (pin chosen recipes as vibe-less locked slots), `exclude` (swap specified recipes out of every pool, alternate list, and pin), `nudges` (`max_time_total`, `variety` strength, a week-level `proteins` soft-boost list, and a `freeform` phrase), a `seed`, and per-slot **`slots` constraints** keyed by vibe id: `protein`/`cuisine` facet pins and an explicitly nullable `max_time_total` threaded into that slot's candidate gate with precedence **slot pin > global `nudges.max_time_total` > the vibe's own facets** (a `null` per-slot time cap lifts the vibe's own cap for that night); a `vibe` phrase overriding that slot's query vector (gate and vibe identity unchanged); and a `recipe` pin filling that slot with the named recipe while **keeping the slot's vibe identity and provenance** — resolved under the same rules as `lock` (case-insensitive, embedded, non-rejected, not excluded; an unresolvable pin is returned as an explicit empty slot, never silently dropped), admitted into the week's diversify state so the remaining slots diversify away from it, and marked on the returned slot. A `slots` constraint whose vibe id is not sampled this week SHALL be inert (no error) so a replayed client session survives palette edits. Given a `seed`, re-invocation SHALL be reproducible; changing only the `seed` SHALL yield a different valid week. At-risk pantry items SHALL be accepted as soft-priority inputs so use-it-up needs can shape selection; the discovery seed is NOT a caller input — the palette path derives at most one engine-internally and places it below the palette's own debt (`weather-bucket-planning`).

#### Scenario: Locked slots survive a re-roll

- **WHEN** a caller re-invokes with two slots `lock`ed and a new `seed`
- **THEN** the locked slots are preserved and the remaining slots are re-selected diversely against them

#### Scenario: At-risk pantry items bias without gating

- **WHEN** a caller passes at-risk pantry items as boost inputs
- **THEN** slots that use those items are favored, with no gated-out recipe admitted

#### Scenario: A per-slot facet pin narrows one night's gate

- **WHEN** a caller pins `protein: "fish"` on one sampled vibe's slot
- **THEN** that slot's candidate pool contains only fish recipes that also clear the vibe's other facets and the hard gate, and every other slot's pool is unaffected

#### Scenario: A null per-slot time cap lifts the vibe's own cap

- **WHEN** a vibe carries `max_time_total: 30` in its facets and the caller pins `max_time_total: null` on its slot
- **THEN** that slot's pool is not time-gated for this request, while the vibe's stored facets are unchanged

#### Scenario: A recipe pin keeps the slot's vibe identity

- **WHEN** a caller pins a resolvable recipe onto a sampled vibe's slot
- **THEN** the slot returns that recipe as its main with its `vibe_id` and reason intact and an explicit pinned marker, and the rest of the week's selection diversifies away from the pinned recipe

#### Scenario: A constraint for an unsampled vibe is inert

- **WHEN** the `slots` array names a vibe id that this week's shape did not sample (or that no longer exists in the palette)
- **THEN** the constraint has no effect and the request succeeds

### Requirement: A Claude-authored ephemeral vibe set shapes the week

`propose_meal_plan` SHALL accept an optional **ephemeral vibe set** — an ordered set of `{ vibe, facets, meal? }` entries authored by the caller for a single request, carrying no cadence history and not persisted to the palette. Each entry's **`meal`** defaults to `'dinner'`; the set therefore authors slots *with meals*. When the set is present, it SHALL shape the week: its entries become the slot vibes the engine fills and composes, replacing the saved-palette cadence-debt sampling for that request; each entry's `vibe` phrase is embedded and ranked exactly as a `slots[].vibe` override, its `facets` gate that slot, and its `meal` selects the slot's meal (and meal-default course gate). When the set is absent, `sampleWeek` SHALL shape the week from the saved palette by per-meal cadence-debt sampling. The ephemeral set is the same primitive as a saved meal vibe (a vibe phrase + optional facets + a meal); the only difference is lifespan. This makes the agent surface (which authors the set from interpreted intent) and the bare/web-app surface (which lets the palette shape the week) a single spectrum over one engine, one MMR pass, and one composition — the agent no longer hand-composes.

The ephemeral set SHALL respect the existing embedding budget: its phrases join the single batched embedding call that already covers `nudges.freeform` and `slots[].vibe` overrides (the `Off-hot-path composition and legibility` requirement), so a request whose ephemeral phrases are all cache-served makes no additional AI call, and a request supplying no ephemeral set and no override/freeform text makes no AI call at all. The ephemeral set SHALL NOT bypass the hard gate (diet / reject / makeability) or the diversify pass — it supplies slot intent, not selection.

Discovery seeding SHALL be **engine-internal and palette-path-only** (`weather-bucket-planning`): an ephemeral-driven week is never seeded with a discovery — the caller places one, if wanted, by authoring an entry that describes it or by pinning it with `lock`.

#### Scenario: An authored ephemeral vibe set shapes a multi-meal week

- **WHEN** `propose_meal_plan` is called with an ephemeral vibe set of three entries, one carrying `meal: "lunch"` and two omitting `meal`
- **THEN** the engine fills and composes one lunch slot and two dinner slots from those entries (embedding + ranking + facet-gating each like a slot override), and the saved palette's cadence-debt sampling does not drive slot selection for that request

#### Scenario: Absent ephemeral set falls back to the palette

- **WHEN** `propose_meal_plan` is called with no ephemeral vibe set
- **THEN** `sampleWeek` shapes the week from the saved meal-vibe palette by per-meal cadence-debt sampling, exactly as before

#### Scenario: The ephemeral set honors the single-embedding budget

- **WHEN** an ephemeral vibe set is supplied whose phrases are not all cache-served
- **THEN** the engine embeds them in the one batched call it already makes for freeform/override phrases, and a request whose ephemeral phrases are entirely cache-served triggers no additional AI call

#### Scenario: The ephemeral set does not bypass the hard gate

- **WHEN** an ephemeral entry's vibe would rank a recipe the diet / reject / makeability gate excludes
- **THEN** that recipe is not admitted — the ephemeral set supplies slot intent, and selection still runs through the hard gate and the MMR diversify

#### Scenario: An ephemeral week is never seeded with a discovery

- **WHEN** `propose_meal_plan` is called with an ephemeral vibe set while the caller's new-for-me set is non-empty
- **THEN** no discovery slot appears — the authored entries are the week, and a discovery enters only by the caller authoring or locking it

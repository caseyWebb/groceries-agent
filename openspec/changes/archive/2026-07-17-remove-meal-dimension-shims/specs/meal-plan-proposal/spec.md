# meal-plan-proposal — delta

## MODIFIED Requirements

### Requirement: Two-level meal-plan proposal

The system SHALL provide a synchronous, stateless `propose_meal_plan` tool that builds a proposed week in two levels: **(1) shape** — run **per meal**: the palette partitions by `meal`, and `sampleWeek` samples each meal's slots from that meal's vibes with that meal's count, weighted by cadence-debt as today (weather quotas apply to the dinner pass only — the `weather-bucket-planning` capability); **(2) fill** — for each slot's query vector, retrieve facet-gated candidates and select a recipe in **one** shared compose pass across all meals (one `assembleProposal`: cross-slot MMR/diversify, facet-spread, at-risk set-cover), still making at most one batched embedding call per request.

Per-meal counts SHALL come from a **`meals?: { breakfast?, lunch?, dinner? }`** parameter (each an integer 0–14, **per-window, not week-scaled**; the planning window continues to bound recurrence caps, not counts), with a per-meal default chain: explicit `meals` → the stored `cadence[meal]` → the read-time derivation (`dinner`: `5`; `breakfast`/`lunch`: 0). **`nights` is removed** — the key rejects like any unknown key (its deprecation window closed on verified production convergence of the frozen column it aliased), `meals.dinner` its sole successor. `lock`, `exclude`, `nudges`, `freeform`, `seed`, `slots[]`, and `boost_ingredients` are retained unchanged (D8/D20: the member-surface cuts are control removals only, never tool params); **`new_for_me` is removed** — the key rejects like any unknown key (its accept-and-ignore window was closed by operator waiver), discovery seeding being engine-internal (`weather-bucket-planning`). String `lock`s and the internally seeded discovery are **dinner** slots (a lock is "cook this this week" intent — dinner-shaped by construction; per-meal pinning is available via `slots[].recipe` or an `ephemeral_vibes[].meal` entry plus a pin).

The tool SHALL return a **structured** proposal (not prose): a **flat** `plan[]` in which each slot carries its **`meal`**, ordered breakfast → lunch → dinner and position-stable within each meal; per slot a chosen `main` (slug, title, description, score) with its corpus `sides`, the perishables it uses, and legibility `flags`; plus week-level `variety` diagnostics and the `diagnostics` (seed, λ, pool sizes) needed to reproduce or re-roll it — extended with `diagnostics.meals: { <meal>: { requested, filled, empty } }` and `diagnostics.attendance: { effective, ignored }`. **`diagnostics.nights` is removed** — `diagnostics.meals.dinner.requested` is its sole successor. The tool SHALL be **stateless** — it holds no proposal between calls and makes no implicit writes; committing a plan remains the caller's separate action.

#### Scenario: A request returns a shaped-and-filled multi-meal week

- **WHEN** a caller requests `meals: { breakfast: 2, dinner: 4 }`
- **THEN** the tool returns 2 breakfast slots sampled from the breakfast palette and 4 dinner slots from the dinner palette, each slot carrying its `meal`, ordered breakfast → lunch → dinner, with `diagnostics.meals` reporting per-meal requested/filled/empty — in one call

#### Scenario: Counts default from the cadence map

- **WHEN** a caller supplies no `meals` and their stored cadence is `{ breakfast: 0, lunch: 2, dinner: 5 }`
- **THEN** the proposal shapes 0 breakfast, 2 lunch, and 5 dinner slots

#### Scenario: The removed nights key rejects

- **WHEN** a stale caller passes `nights: 4`
- **THEN** the request is rejected like any unknown key — `meals.dinner` is the only way to set the dinner count

#### Scenario: Proposing writes nothing

- **WHEN** `propose_meal_plan` runs
- **THEN** it mutates no `meal_plan` or `grocery_list` state — proposing is read-only, and persisting the plan is a separate caller action

#### Scenario: The removed new_for_me key rejects

- **WHEN** a stale caller passes `new_for_me: [...]`
- **THEN** the request is rejected like any unknown key — the palette path seeds its single discovery internally regardless

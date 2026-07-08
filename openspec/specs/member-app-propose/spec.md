# member-app-propose Specification

## Purpose
TBD - created by archiving change member-app-propose. Update Purpose after archive.
## Requirements
### Requirement: Propose endpoints are thin adapters over the shared planner operation

The member app SHALL expose the propose surface as a session-gated `/api` route group calling shared operations extracted from the MCP tool closures — one operation running the full propose pipeline (context loads, week shaping, slot filling, assembly) called by both `propose_meal_plan` and `POST /api/propose`, and one resolving the tenant's preference-derived weather forecast called by both `get_weather_forecast` and `GET /api/propose/weather` — with the tools' observable behavior unchanged. The propose endpoint SHALL accept the tool's full input (nights, seed, lock, exclude, boost ingredients, nudges, per-slot constraints) and return the tool's result shape, so the tool and the endpoint are **one contract** maintained in the same pass. Structured errors (including the weather `no_location` family) SHALL cross the HTTP boundary through the shared error middleware with their codes intact.

#### Scenario: The endpoint and the tool return the same proposal

- **WHEN** the same tenant submits the same propose input through the MCP tool and through `POST /api/propose`
- **THEN** both return the same proposal, produced by the same shared operation

#### Scenario: A missing location is a structured state, not a failure page

- **WHEN** a member with no resolvable ZIP loads the propose page's weather strip
- **THEN** the weather endpoint returns the structured `no_location` code and the UI renders a quiet set-your-ZIP affordance while the rest of the flow works

### Requirement: The propose session lives client-side only

All propose-session state — seed, locks, per-slot recipe pins and facet pins, vibe overrides, excludes, nudges, freeform text — SHALL live client-side, persisted by the app and replayed as the full request body against the stateless endpoint on every change. The Worker SHALL NOT persist any propose-session state: no session rows, no KV session blobs, no server-held proposal between calls (the query-embedding cache stores content-addressed vectors, not sessions). Session resume and reproducibility SHALL rest entirely on the endpoint's determinism — the same request body yields the same week.

#### Scenario: A session resumes by replay

- **WHEN** a member returns to the propose page with a stored client session
- **THEN** the app re-submits the same request body and renders the same week, with no server-side session read

#### Scenario: Proposing writes no server state

- **WHEN** a member iterates through many rerolls, pins, and overrides without committing
- **THEN** no tenant data row, KV entry (beyond content-addressed embedding cache entries), or other server-side state records the session

### Requirement: The propose flow UI iterates live against the stateless endpoint

The propose page SHALL render the design bundle's flow: an intro state and an empty-palette state (production palettes start empty) linking to the palette page; a controls row (nights stepper, adventurousness slider mapped to the variety nudge, week-level protein-want chips, a debounced freeform phrase input); the weather forecast strip; a variety bar (nights, distinct cuisines/proteins, protein histogram) with the commit action; and one card per slot — main with description and facet chips, `why` chips, corpus side chips, waste/meal-prep/no-side flags, and the per-slot controls: lock (keep through rerolls, as an identity-preserving recipe pin), a swap menu offering the returned nearest-similar and different-cuisine picks plus the bounded alternates list, exclude ("not this one"), facet pin popovers (protein, cuisine, time — pinned chips clearable in place, including on an over-constrained empty slot), and a vibe panel (typed phrase or palette preset, with reset). Every change SHALL re-query the stateless endpoint while keeping the previous week rendered until the new one arrives; a reroll SHALL advance only the seed. The flow SHALL be reachable from the meal-plan page and the palette page.

#### Scenario: A dial change updates the week without flashing

- **WHEN** a member drags the adventurousness slider or toggles a protein want
- **THEN** the app re-queries with the updated request while the previous proposal stays visible until the new one renders

#### Scenario: A swap keeps the night's shape

- **WHEN** a member swaps a slot to the offered similar pick
- **THEN** the next request pins that recipe to the slot's vibe, the slot re-renders with the pick and its vibe identity intact, and the rest of the week re-diversifies around it

#### Scenario: An over-constrained night is relaxed in place

- **WHEN** a member's facet pins leave a slot with no candidate
- **THEN** the slot renders the empty reason with each pin shown and clearable in place, without resetting the wider session

### Requirement: Commit threads provenance through the existing plan ops

Committing a proposed week SHALL map each filled slot onto the existing meal-plan row ops — recipe slug, the slot's vibe id as `from_vibe`, the corpus side titles as the row's open-world sides, and a client-assigned open date within the planning window — as idempotent upserts keyed by recipe slug (replay-safe; an already-planned recipe merges rather than duplicating or erroring). No new commit endpoint SHALL be introduced. After commit the client session SHALL be cleared, so cooking a committed row later stamps the vibe's satisfaction provenance exactly as an agent-committed plan would.

#### Scenario: A committed slot carries its vibe provenance

- **WHEN** a member commits a week and later logs one of its recipes as cooked
- **THEN** the plan row carried the slot's `from_vibe`, and the cook stamps that vibe's `satisfied_vibe` provenance feeding cadence debt and the reconcile signals

#### Scenario: Committing an already-planned recipe converges

- **WHEN** a proposed main is already on the meal plan
- **THEN** the commit upserts by slug without duplicating the row, and the member is told those nights were already planned

### Requirement: The propose flow ships with model-free Playwright coverage

The propose flow SHALL ship with page objects and specs on the member-app Playwright harness, blocking in CI with per-area screenshots — and the suite SHALL run with **zero model calls**: the seed provides a deterministic palette with synthetic vibe and recipe vectors (production palettes are empty, so seeding is the only path to a filled proposal), and any spec exercising freeform text pre-warms the query-embedding cache with that exact phrase's vector so the embed path is exercised as a deterministic cache hit. Coverage SHALL include the empty-palette state, reroll and same-request stability, lock persistence across rerolls, facet pinning including the over-constrained empty slot, a swap via the returned alternates, freeform reshaping, and a commit verified on the plan page.

#### Scenario: The suite needs no Workers AI

- **WHEN** the propose specs run in CI
- **THEN** every proposal is computed from seeded vectors and the freeform spec hits the pre-warmed cache, with no Workers AI invocation

#### Scenario: A propose change cannot merge without its coverage

- **WHEN** a change touches the propose page, its routes, or the planner extensions' surfaced shapes
- **THEN** the corresponding page objects/specs are updated in the same change and the blocking Playwright job passes with fresh screenshots


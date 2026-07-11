# Proposal — pantry-disposition-foundations

## Why

The Retrospective's Waste analyzer (product-specs band 4, `stories/03-cost-and-waste-telemetry.md`)
is a read surface over telemetry that does not exist: today a pantry row leaves the kitchen
through a bare `remove` that records nothing, so there is no waste history for any analyzer to
read. Per the capture → retrieve → narrow doctrine, capture must land first, UI-free, so events
accumulate while the page redesigns (band 2's `pantry-page`) and the analyzers (band 4) are
built. This is the band-1 foundations change CHANGES.md names `pantry-disposition-foundations`.

Two structural problems block honest capture:

- **Today's pantry `category` conflates food taxonomy with storage location.** SCHEMAS.md
  documents `pantry | fridge | freezer | spices`, but the column is unvalidated free text and
  production holds 22 distinct values across 336 rows — location-flavored (`pantry` 74,
  `fridge` 32, `freezer` 37, `spice`/`spices`/`spice blend` 84) interleaved with food-flavored
  (`condiment` 27, `baking` 25, `canned goods` 13, `dairy` 9, …). Analytics needs the food
  taxonomy; the member app's put-away flows need the location. Page 06 splits them into two
  orthogonal, controlled fields.
- **The analytics `department` dimension (D17) must be stamped at capture**, derived
  deterministically from the item's canonical ingredient id — the same derivation pantry-add
  autofill will use (band 2) and the sibling `spend-capture-on-order-commit` change stamps on
  spend events. No identity→category memo exists today; this change introduces it on the
  ingredient-identity registry, filled by a bounded scheduled pass.

Production spike (2026-07-10, read-only against the production D1 `grocery-mcp`; full findings
and the acceptance-fixture table in design.md §8): pantry = 336 rows across 2 tenants, 0 NULL
categories, 0 `prepared_from` rows, 22 distinct free-text category values; every pantry row's
`normalized_name` resolves in the ingredient-identity registry (336/336), which holds 869
identities (798 concrete survivors — the category backfill's entire workload).

## What Changes

- **Pantry `location` dimension, orthogonal to `category`.** New nullable `location` column
  (controlled vocab: `fridge | freezer | pantry | spice_rack | counter | cabinet`) and
  `category` re-scoped to the controlled food taxonomy (`produce | dairy | meat | seafood |
  grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks |
  beverages`). One migration transposes legacy location-flavored category values onto
  `location` and maps exact food-flavored values onto the new vocab; everything unmappable
  reads NULL (uncategorized — never an error) and converges via the classifier pass.
  `update_pantry`/`read_pantry` and the `/api` pantry area gain `location`; legacy category
  values are accepted through a one-deprecation-window shim (D21 posture).
- **Removal-as-disposition.** `update_pantry` (and `POST /api/pantry/ops`) gains a `dispose`
  op — `disposition: "used" | "waste"` — that removes the row; `waste` additionally persists a
  waste event with ONE canonical reason enum (`spoiled | moldy | over_ripe | expired |
  freezer_burned | stale | forgot | bought_too_much | never_opened | other`). Dollar value is
  **never asked** — a tool-description-owned negative guarantee; band 4 derives value from
  spend history. Plain `remove` stays (correction/cleanup, records nothing). `used` is pure
  removal today (no consumption signal — pages/06 q2 resolved: deferred, the op shape leaves
  room).
- **Waste events** (`waste_events`, PK `(tenant, id)`): client-minted event id (D15 idempotency
  key; server-minted when the agent path omits it), item display name + canonical id,
  `prepared_from` snapshot, loose quantity snapshot, `occurred_at`, reason, and the D17
  `department` stamped immutably at capture — `prepared_from` rows stamp `leftovers`; otherwise
  the row's in-vocab category, else the identity memo, else NULL-pending, converged by the cron
  and never rewritten once set.
- **Identity category memo + scheduled pass.** `ingredient_identity.category` (the 14-value
  vocab + `household` as the non-food catch-all), filled by a new bounded, self-terminating
  `ingredient-category` scheduled job (batched `env.AI` classification through the `runAi`
  gateway, own `AiActivity`); the same pass backfills NULL pantry categories (never overwriting
  a set value) and stamps pending waste-event departments. This module is the ONE D17
  derivation the sibling `spend-capture-on-order-commit` change consumes.
- **Write-class registration** (member-app-offline delta): pantry dispose = class (b),
  idempotent, keyed on the client-minted event id; the new `location`/`category` fields ride
  the already-registered class (b) pantry upsert. Nothing else member-facing is introduced;
  no new online-only surface.
- **Docs lockstep, same pass:** TOOLS.md `read_pantry`/`update_pantry`, SCHEMAS.md pantry +
  `waste_events` + identity memo + `AiActivity`, ARCHITECTURE.md cron list.

## Non-goals

- **No UI** — the pantry page redesign (location group-by, multi-add, disposition modal) is
  band 2's `pantry-page`, which builds on this capture.
- **No spend events** — the sibling band-1 change `spend-capture-on-order-commit` owns them
  (it consumes this change's department module).
- **No value or avoidability** — value derives from spend history (band 4); avoidability is a
  versioned read-time reason(+item-class) table in the waste analyzer (band 4). Neither is
  stored or asked at capture.
- **No persona edits** — Appendix C places the put-away/waste-reason choreography in band 3;
  the tool descriptions shipped here carry the contract on their own (the tool/skill ownership
  test).

## Impact

- Affected specs: `data-write-tools` (2 ADDED), `data-read-tools` (1 MODIFIED),
  `ingredient-normalization` (1 ADDED), `member-app-offline` (1 MODIFIED).
- Affected code: one new migration; `packages/worker/src/` — `pantry-write.ts`,
  `session-db.ts`, `write-tools.ts`, `tools.ts`, `api/pantry.ts`,
  `grocery-pantry-reconcile.ts` (carry `location` through the re-key), new `department.ts` +
  `ingredient-category.ts`, `ai.ts` (activity), `index.ts` (`scheduled()` wiring); tests;
  `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`.
- Serial surfaces: `scheduled()` wiring (shared with `meal-dimension-foundations`' suggest-vibes
  cron and any in-flight change); `member-app-offline` spec (shared with band-3 grocery/walk
  changes and band-2 `pantry-page`); docs/TOOLS.md + SCHEMAS.md band-1 sections (siblings).
  Implementation MUST NOT run in parallel with those changes. `spend-capture-on-order-commit`
  consumes `src/department.ts` — implement this change first (or coordinate explicitly).

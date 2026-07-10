# spend-telemetry Specification (delta)

## ADDED Requirements

### Requirement: Spend is captured in two phases — snapshot at send, materialize at the purchase assertion

Spend telemetry SHALL be captured in two phases (D16). SNAPSHOT: an order flush that advances grocery rows to `in_cart` (the `place_order` Kroger flush and the satellite cart-fill receipt's first landing) SHALL persist a **send record** — one `order_sends` row (`store`, `location_id`, `fulfillment` path, `created_at`; the satellite send's id SHALL equal its order-list id so replays converge) plus one `order_send_lines` row per advanced line carrying the resolved pick (`sku`/`brand`/`size`), package `quantity`, the per-package `price_regular`/`price_promo`/`on_sale`/effective `unit_price`, sale `savings`, an `estimated` flag (`0` on send-path quotes), the capture-stamped `department`, the `provenance` class, and `for_recipes`. Fields the path cannot know SHALL be stored NULL-unknown (the satellite's single observed price populates `unit_price` only), never fabricated. MATERIALIZE: spend events SHALL be written by ONE shared `src/` writer at the purchase assertion — the guarded `in_cart → ordered` advance on every surface, per the `order-placement` lifecycle — **copying the snapshot line verbatim** (prices, department, provenance, store, fulfillment; `amount = unit_price × quantity`, NULL when unpriced), idempotent on the `(send_id, line_key)` primary key. Emission SHALL live inside the shared operations, never in a surface, and no path SHALL re-price or re-derive at materialize time. Snapshot prices are send-time quotes by definition — the Kroger cart is write-only and no fulfillment receipt exists — and no reconciliation step SHALL be implied or attempted.

#### Scenario: A Kroger flush snapshots and a later assertion materializes verbatim

- **WHEN** `place_order` flushes a resolved line at `{regular: 4.99, promo: 3.99, on_sale: true}` × 2 packages and the user later asserts "I placed the order"
- **THEN** the send line stores those prices with `savings: 1.00` and the materialized spend event copies them verbatim with `amount: 7.98` — no live re-pricing at assertion time

#### Scenario: Materialization is idempotent on (send, line)

- **WHEN** the purchase assertion for the same row is replayed (a retried satellite `mark_placed`, a re-landed receipt)
- **THEN** exactly one spend event exists for that `(send_id, line_key)` — the replay converges without duplicating

#### Scenario: The satellite snapshot stores only what was observed

- **WHEN** a cart-fill receipt reports a carted line with `product: { productId, description, price: 6.49 }`
- **THEN** its send line stores `unit_price: 6.49` with `price_regular`/`price_promo`/`on_sale`/`savings` NULL-unknown — nothing is fabricated to fill the Kroger-shaped fields

#### Scenario: Spend events are retained, not rolled up

- **WHEN** spend events age beyond any analyzer window
- **THEN** they are retained as line items indefinitely (voided events included) — no prune, no rollup

### Requirement: Negative rules — no purchase assertion, no spend

The capture SHALL enforce D16's negative rules. A row leaving `in_cart` without a purchase assertion (re-listed to `active`, removed, or rolled back by a failed cart write) SHALL write no spend and SHALL drop its send linkage. The terminal receive action SHALL price nothing itself — an agent that collapses ordered+received asserts the purchase by first advancing `in_cart → ordered` (the persona's receive choreography), and a bare removal of an `in_cart` row is NOT an assertion. Re-listing an `ordered` row SHALL void its materialized events (a `voided_at` stamp — never a delete; reads filter voided events out). Rows advanced by a manual `active → in_cart` write carry no send linkage, and a purchase assertion for a row without one SHALL write no spend event (band 3's shop-commit op extends coverage to unsnapshotted purchases). Never-marked orders SHALL surface as "awaiting mark-placed" (the retrospective spend section's count and the to-buy view's existing `in_cart` section) and SHALL never be auto-counted as spend.

#### Scenario: Re-listing an in_cart row writes nothing

- **WHEN** an `in_cart` row that was advanced by a flush is set back to `active`
- **THEN** no spend event is written and the row's send linkage is cleared — its snapshot lines simply never materialize

#### Scenario: Re-listing an ordered row voids its events

- **WHEN** an `ordered` row with materialized spend events is re-listed (to `active` or `in_cart`)
- **THEN** its events for that send are stamped `voided_at` (not deleted), the send linkage clears, and spend reads no longer count them

#### Scenario: A manual in_cart move never manufactures spend

- **WHEN** a member freely moves a row `active → in_cart` by hand and later marks it `ordered`
- **THEN** no send record backs the row, so no spend event is written — prices from an unrelated historical send are never resurrected

#### Scenario: An unmarked order is surfaced, not counted

- **WHEN** rows sit at `in_cart` under a send with no `ordered` assertion
- **THEN** spend aggregates exclude them and report their count as awaiting mark-placed

### Requirement: One canonical department dimension, stamped at capture

Every spend event (and, via the shared derivation, every waste event) SHALL carry a `department` from the ONE canonical analytics dimension, stamped immutably at capture (D17): the controlled food vocab — `Produce, Dairy, Meat, Seafood, Grains, Bakery, Canned, Condiments, Oils, Spices, Baking, Frozen, Snacks, Beverages` — plus `Other`, `Household`, and `Leftovers`. The stamp SHALL never be derived at read time and SHALL never come from store placement (`sku_cache` aisle data and Kroger product categories are presentation-only). Derivation SHALL be deterministic and identity-keyed, in one shared `src/` module: a non-food line (`kind` of `household`/`other`, or a non-grocery `domain` — the "2x4 lumber" fixture) SHALL stamp `Household`; a food line SHALL stamp its canonical ingredient id's memoized department (`ingredient_departments`, keyed by the IngredientContext funnel's id — the same source pantry-add autofill uses); a food id with no memo yet SHALL stamp `Other` — a real, deliberately-stamped vocab value, so "Not mapped" can never reach analytics. `Leftovers` SHALL be stamped only by waste capture over `prepared_from` pantry rows, never by spend. Events SHALL keep their capture-time stamp forever — memo or vocab evolution never rewrites history. The cost-per-meal exclusion set `{Household, Beverages}` SHALL be defined beside the vocab as the constant band 4's analyzer consumes.

#### Scenario: A household line stamps Household

- **WHEN** a "paper towels" (`kind: household`) or "2x4 lumber" (`domain: home-improvement`) line is snapshotted
- **THEN** its department is `Household` — included in spend, excluded from the cost-per-meal constant — with no ingredient-graph involvement

#### Scenario: A memoized food line stamps its department

- **WHEN** a "tomatillos" line is snapshotted after the classify pass memoized `tomatillos → Produce`
- **THEN** the send line and its later spend event both carry `Produce`

#### Scenario: A cold id stamps Other and keeps it

- **WHEN** a food line is snapshotted before its id has a memo row, and the classify pass later memoizes it
- **THEN** the event keeps its `Other` stamp forever while every future capture of that id stamps the memoized department

#### Scenario: Store placement never feeds the dimension

- **WHEN** a line's resolved product carries an aisle placement or Kroger category
- **THEN** the department stamp ignores them — placement data remains presentation-only for list grouping and the walk

### Requirement: The department memo is filled by a bounded scheduled classify pass

The `ingredient_departments` memo (shared corpus tier — identity-keyed, no tenant column) SHALL be filled by a bounded pass in the one `scheduled()` handler: each tick it SHALL collect distinct food canonical ids lacking a memo row from the tenant surfaces that stamp departments (`grocery_list` food rows, `pantry`, `order_send_lines`), classify a bounded batch with the small model under a closed-enum output contract (the food vocab plus `Other`; validator + corrective retry, per the `ingredient-classify` discipline), and memoize each result with `source` provenance. A classification failure SHALL skip the id (retried next tick), never memoize an out-of-vocab value, and never fail the tick's sibling jobs. Capture paths SHALL only read the memo — no tool or capture path SHALL invoke the model inline (the determinism boundary).

#### Scenario: The pass converges the memo

- **WHEN** the scheduled pass runs while grocery/pantry rows hold food ids with no memo
- **THEN** a bounded batch is classified into the closed vocab and memoized, and subsequent ticks continue until no unmemoized ids remain

#### Scenario: An invalid model answer never lands

- **WHEN** the model returns a value outside the closed vocab after retries
- **THEN** no memo row is written for that id and the id is retried on a later tick

#### Scenario: Capture never calls the model

- **WHEN** a send snapshot stamps departments
- **THEN** it resolves overrides and memo lookups only — no AI call occurs on the order path

### Requirement: Spend aggregates are agent-readable via retrospective; no spend-write tool exists

The `retrospective` tool SHALL return a read-only, household-scoped `spend` section: the trailing 4 ISO weeks' totals (`total`, `savings`, event and estimated counts) over non-voided events, the caller's `weekly_budget` (or null), and `awaiting_mark_placed` (current `in_cart` rows carrying a send linkage). The aggregation SHALL be plain SQL — no LLM in the read path. No MCP tool SHALL write spend events directly: the agent influences spend only through the shared order/list operations, and the writer is not a surface.

#### Scenario: The spend section reflects materialized events

- **WHEN** spend events exist within the trailing window and the tenant has `weekly_budget: 95`
- **THEN** `retrospective` returns per-week totals excluding voided events, `weekly_budget: 95`, and the current awaiting-mark-placed count

#### Scenario: No write tool

- **WHEN** the MCP tool surface is enumerated
- **THEN** no tool accepts a spend event; spend materializes only inside the shared status-advance operations

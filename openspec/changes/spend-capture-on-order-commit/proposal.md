# spend-capture-on-order-commit

## Why

The Retrospective's Spend analyzer (band 4) and the Order Review savings tiles (band 3) are read surfaces over telemetry that does not exist today: nothing records what an order cost. The prices ARE in hand at exactly one moment — `place_order` resolves every line against the live Kroger catalog (fresh `regular`/`promo` per SKU at the caller's location), and the satellite cart-fill receipt reports each carted product's observed price — but that moment is discarded: the Kroger cart is write-only (`PUT /v1/cart/add` carries only `{upc, quantity}` and can never be read back), so once the flush returns, the numbers are gone.

D16 fixes the contract: **snapshot at send, materialize at the purchase assertion**. This change is the band-1, UI-free half (D25(1)): the send-record snapshot on the existing order-commit paths (`place_order` + the satellite cart-fill receipt), spend events written by ONE shared `src/` writer at the purchase assertion, the D17 canonical `department` dimension stamped at capture, and the household weekly-budget preference (storage + tool contract; the UI control ships with band 2's `profile-planning-and-vibes-ui`). Band 3 EXTENDS this capture (impulse lines from order review, the manual-shop/walk path, savings tiles) via the same shared ops — never new UI wiring.

Production grounding (planning spike, 2026-07-10, read-only against the deployed D1): the `grocery_list` lifecycle columns are schema-complete but data-empty — **zero** rows have ever held `in_cart`/`ordered` or a non-null `ordered_at`; `order_lists` has 0 rows; `sku_cache` (20 legacy rows) **stores no prices**; the warmed flyer (KV `FlyerRollup`) carries `price.{regular,promo}` + derived `savings` per SKU. So there is no legacy purchase history to converge — the migration is purely additive, and the acceptance fixture is the **first real production order after deploy** (send record + spend events + department stamps verified in place), plus the 22 live `active` rows exercising the provenance mapping.

## What Changes

- **NEW capability `spend-telemetry`** — the capture contract: send records, the shared spend-event writer, the negative rules, the canonical department dimension + its identity-keyed derivation, and the read-only retrospective aggregate.
- **`place_order` persists a send record** (non-preview flush only): one `order_sends` row + per-line `order_send_lines` rows carrying `{sku/brand/size (the pick), quantity, regular + promo unit price, on_sale, effective unit price, sale savings, department, provenance, for_recipes}`, with `store`/`location_id`/`fulfillment: "kroger_online"` on the send. Written **in the same D1 batch as the in-cart advance** (exists iff the advance succeeded); the cart-failure rollback deletes it. The result gains an honest `send` field.
- **The satellite cart-fill receipt's first landing persists the same send record** (`fulfillment: "satellite"`, send id = the order-list id — deterministic, so the residual double-intake replay converges), from the receipt's carted/substituted observations (`product.price` is a single observed number: `unit_price` only; `regular`/`promo`/`on_sale`/`savings` are NULL-unknown).
- **`grocery_list` gains an internal `sent_in` column** — the send id a row's in-flight cart state belongs to. Stamped by the two snapshot-writing advances, never by a manual `active → in_cart` move; cleared when the row leaves the flight without a purchase assertion.
- **ONE shared writer (`src/spend.ts`) materializes `spend_events` at the purchase assertion** — the guarded `in_cart → ordered` advance on every surface (`update_grocery_list`, the member PATCH route it shares an op with, satellite `mark_placed`) — copying the snapshot verbatim, idempotent on `(send_id, line_key)`. Negative rules per D16: a row leaving `in_cart` without an assertion writes no spend; receive prices nothing itself; re-listing an `ordered` row **voids** its events (`voided_at`, never deleted); never-marked orders surface as "awaiting mark-placed", never auto-counted. A purchase assertion for a row with **no** send linkage writes no spend in band 1 (band 3's shop-commit op extends coverage to unsnapshotted purchases).
- **D17 department dimension, stamped at capture**: canonical enum = the controlled food vocab (`Produce, Dairy, Meat, Seafood, Grains, Bakery, Canned, Condiments, Oils, Spices, Baking, Frozen, Snacks, Beverages`) + `Other` + `Household` + `Leftovers` (waste-only; never stamped by spend). Derivation is deterministic and identity-keyed: kind/domain overrides (`kind: household`/`other`, non-grocery `domain` → `Household` — SCHEMAS.md's "2x4 lumber" row is the fixture) → the `ingredient_departments` memo (canonical ingredient id → department, shared corpus tier) → `Other`. The memo is filled by a new bounded scheduled classify pass (small model, closed-enum contract + validator, capture-once) — **this change ships the shared derivation module and memo that `pantry-disposition-foundations`' add-autofill and waste stamping consume** (the D17 "IngredientContext funnel piece", scoped here explicitly). Events keep their capture-time stamp forever; store placement (`sku_cache` aisle data, `LinePlacement`) stays presentation-only.
- **Weekly-budget preference**: `weekly_budget` joins the defined `update_preferences` surface (nonnegative number; `null` deletes; unset/`0` means "no budget line"), stored as a `profile` column and assembled into the `read_user_profile` preferences object. Contract only — the control is band 2's.
- **`retrospective` gains a minimal read-only `spend` section** (trailing 4 ISO weeks: total/savings/event count/estimated count; `awaiting_mark_placed`; `weekly_budget`) so the capture is agent-verifiable end-to-end and the choreography ("under budget 3 weeks running") works from band 1. Band 4's analyzer extends this. **No spend-write tool is minted.**
- **Persona (receive choreography)**: "I picked up the groceries" for rows still `in_cart` first advances them `in_cart → ordered` via `update_grocery_list` (the purchase assertion that records spend), then removes + restocks as today. `remove_from_grocery_list` never writes spend.
- Migration `migrations/d1/0049_spend_capture.sql` (next number confirmed against production `d1_migrations`): 4 new tables + 2 additive columns. No new bindings, routes, or cron triggers (the classify pass rides the existing single `scheduled()` trigger) — so no `run_worker_first` entry and no deploy merge-allowlist change.

## Capabilities

### New Capabilities

- `spend-telemetry`: snapshot-at-send / materialize-at-assertion, the one shared writer + idempotency + negative rules, the canonical department dimension (vocab, capture stamping, memo + classify pass), keep-forever retention, and the read-only retrospective spend aggregate.

### Modified Capabilities

- `order-placement`: the flush persists the send-record snapshot (ADDED); the lifecycle requirement gains the spend hooks — the guarded advance fires the writer, re-listing voids, rollback deletes the send, removes never write spend (MODIFIED).
- `grocery-list`: the schema gains the internal `sent_in` send-linkage column (MODIFIED).
- `satellite-order-cart-fill`: the receipt's first landing persists the send record; `mark_placed` fires the shared writer (MODIFIED).
- `data-write-tools`: `weekly_budget` joins the defined preferences surface (MODIFIED; the restated enumeration also picks up the already-shipped `planning_cadence_days`/`rotation` keys the spec text had drifted from).

## Impact

- `migrations/d1/0049_spend_capture.sql` — `order_sends`, `order_send_lines`, `spend_events`, `ingredient_departments`; `grocery_list.sent_in`, `profile.weekly_budget`.
- New `src/spend.ts` (snapshot statements + the one writer + void), new `src/departments.ts` (vocab, `departmentFor`, memo I/O), new `src/department-derivation.ts` (the classify cron job).
- `src/order.ts` / `src/order-shapes.ts` / `src/order-tools.ts` — snapshot dep threaded through `placeOrder`; `PlaceOrderResult.send`; provenance/department computed in `runPlaceOrder`; tool description.
- `src/session-db.ts` — `advanceInCartRows`/`rollbackInCartRows` carry the send batch + `sent_in`; `updateGroceryRow` hooks (record / void / clear); `advanceOrderedRows` records.
- `src/ingest.ts` — the order arm builds the satellite send record with its advance.
- `src/preferences.ts` / `src/profile-db.ts` / `src/write-tools.ts` — `weekly_budget`.
- `src/tools.ts` / `src/retrospective*.ts` — the retrospective `spend` section.
- `src/index.ts` — the department classify pass in `scheduled()` (job-health registered like its siblings).
- `docs/TOOLS.md` (`place_order`, `update_grocery_list`, `retrospective`, `update_preferences`), `docs/SCHEMAS.md` (spend telemetry section, `grocery_list.sent_in`, preferences block), `docs/ARCHITECTURE.md` (cron list + data model), `AGENT_INSTRUCTIONS.md` (receive choreography) + `aubr build:plugin --check`.
- Tests: `test/spend.test.ts`, `test/departments.test.ts`, extensions to `test/order*.test.ts`, `test/session-db/grocery` suites, `test/satellite*.test.ts`, `test/preferences.test.ts`, retrospective tests.
- D15 write classification (stated; **no `member-app-offline` delta needed**): this change adds **no member-reachable write surface**. The spend materialization rides the existing guarded status advance — already replay-safe (a second `ordered` write fails the `from: in_cart` guard) — and the writer itself dedupes on the server-derived `(send_id, line_key)` key; satellite receipt/mark-placed replays converge on the deterministic send id. No client-minted idempotency key is required because no client-originated write is introduced; band 3's walk/manual-shop session ids are where D15's client-minted keys arrive.

## Sequencing / serial-surface collisions

- `order-placement` spec + the shared commit ops: band 3's `order-review-rework` lands AFTER this change and extends them.
- `update_preferences`/`read_user_profile` TOOLS.md + SCHEMAS.md sections: shared with `brand-tier-model` and `meal-dimension-foundations` — implement serially with those siblings.
- `scheduled()` wiring: shared with `meal-dimension-foundations`' suggest-vibes cron — serialize.
- `src/departments.ts` + `ingredient_departments`: consumed by `pantry-disposition-foundations` (add-autofill, waste stamping) — that change builds on this module; don't implement the two in parallel.
- Migration numbering: `0049` is next; a band-1 sibling landing first renumbers this file.

## Resolved questions (story 03 §1 / §5)

1. **Are Kroger order prices authoritative (q1)?** Resolved by spike + code: the resolution-time product prices (`price.{regular,promo}` at the caller's location, fresh on every matcher/override resolution) are the ONLY obtainable numbers — the cart is write-only, there is no order/receipt API on this integration, and nothing later can be reconciled against. The snapshot is therefore **defined** as the send-time quote and is the spend truth by construction; per-package quotes for weight-priced items and fulfillment-time promo changes are documented caveats, not errors. `estimated` stays `0` on send-path lines (it marks band 3's fallback-priced events, not quotes). No reconciliation step exists or is planned.
2. **Per-line store override (q2)?** No. A line belongs to exactly one send and the send carries `store`/`location_id`/`fulfillment`; split shops arrive with band 3's shop-commit op, each commit carrying its own store context.
3. **Cost-per-meal denominator (q3)?** Band 4's decision; capture does not constrain it. This change ships the numerator exclusion constant (`{Household, Beverages}`) beside the enum so band 4 reads it rather than re-deriving.
4. **Member attribution on spend (q4)?** Not captured. Spend is household-scoped (`tenant`) — member identity does not exist at the credential layer until band 5 (D10); a member column can be added additively then if wanted. Noise for now.
5. **Retention/rollup (q5)?** Keep line items forever, no rollup: friend-group scale (production: 22 grocery rows total; spend volume is tens of rows/week) makes pruning premature; `voided_at` preserves audit; revisit only if volume demands.
6. **Provenance mapping** (story §1 "keep the mapping rule explicit"): a line is `planned` iff it entered the to-buy set from a stored `grocery_list` row (any `source` — an explicit add before the shop) or from the server-derived plan needs, **or** carries non-empty `for_recipes`; a caller-supplied `menu_needs` extra with no recipe attribution is `impulse`. Satellite pull-list lines are `planned` by construction (list ∪ plan only). All 22 production `active` rows are `ad_hoc` stored rows → `planned`, grounding the mapping.
7. **The department vocab gains `Other`** (a deliberate, stamped value — not "Not mapped"): D17 requires a total stamp at capture with no read-time derivation and no store-placement input, and the memo can be cold for a just-added id (the classify pass is a cron). `Other` is expected rare — list dwell time plus the per-tick classify warm the memo before most sends — and an event stamped `Other` keeps that stamp per D17's own immutability rule. Flagged for operator awareness since pages/06 enumerates 14 food categories without it (the mock is a painted door per D5; the vocab's exact membership is defined by the implementing changes).

## Depends On

Nothing unlanded. Independent of the other band-1 changes except for the serial surfaces above; `profile-planning-and-vibes-ui` (band 2) ships the budget control; band 3 extends capture; band 4 reads it.

# grocery-list — delta

## MODIFIED Requirements

### Requirement: Grocery list CRUD tools

The system SHALL provide one operations-form write tool, `update_grocery_list(operations)`, where each operation is `{ op: "add" | "update" | "remove", … }` — the `update_pantry` operations idiom — applied row-level against D1 with per-op `applied`/`conflicts` reporting and no `commit_sha`. The **`add`** operation SHALL carry the full former `add_to_grocery_list` contract: keyed by a **normalized name** that MERGEs a re-added name into the existing row (union `for_recipes`, reconcile `quantity`) via upsert rather than creating a duplicate. The normalized key SHALL be resolved through the shared `IngredientContext` funnel (the canonical ingredient id — normalize **and** capture) for a **food** row, and through `normalizeName` (lowercase + whitespace-collapse) for a **non-food** row, where a row is food iff its `kind` is `grocery` and its `domain` is grocery (or absent). An `add` MAY additionally accept an explicit canonical `id`: when supplied, it SHALL be validated as an already-canonical id that is a **live survivor** in the identity registry (NOT re-resolved through the funnel), stored as the row's canonical key with the human display kept separately; an `id` that is malformed or not a live survivor SHALL fall back to the `name` path when a name is present, else be rejected with `validation_failed` — an unresolvable key is NEVER stored. A non-food row SHALL NOT be resolved or captured. When a re-add or an add-by-id merges into an existing row, the surviving row SHALL keep its existing `name`/`display_name` rather than adopt the incoming surface form, so a merge never fragments or corrupts the rendered label. A surface SHALL render a row's human label as its explicit `display_name` override when set; else, for an **id-named** row (its stored `name` equals its canonical key), the identity node's label (`display_name`, else the `base (detail)` synthesis); else the stored `name` — the node label resolved at read converges as the reconcile backfills the node's `display_name`, so a legacy id-named row heals with no row edit. The `add` operation's optional `substitutes_for` capture signal is unchanged. New items SHALL be created with `status: active`. The **`remove`** operation SHALL resolve its query through the same funnel so a case/quantity/alias-varying removal hits its row; a removal never writes spend. The **`update`** operation SHALL carry the former patch contract, including the `status` lifecycle guard enforced in the shared update operation (so every caller — the tool, the app plane, and any HTTP surface — gets the identical guarantee): transitions between `active` and `in_cart` freely writable in both directions (including re-listing an `ordered` row back to `active`); a write of `status: "ordered"` accepted **only** when the row's current status is `in_cart` (the user-asserted "I placed the order" advance), stamping `ordered_at`; any other write of `ordered` rejected with a structured `validation_failed` carrying the attempted transition, leaving the row unchanged; the spend-materialization/void guarantees riding those transitions unchanged. The order-flow advance operations (`place_order`'s in-cart advance and the satellite receipt flush's ordered advance) are distinct code paths and SHALL be unaffected by the guard. The capture aliases are closed (operator waiver): `add_to_grocery_list` and `remove_from_grocery_list` are not registered, and the old single-patch `update_grocery_list` form is rejected as `malformed_data` — the ops form is the whole contract.

#### Scenario: Re-adding an existing item merges

- **WHEN** an `add` operation names an item already present on the list
- **THEN** the existing row is upserted (merged `for_recipes`, reconciled `quantity`) and no duplicate row is created

#### Scenario: Adding by canonical id keys exactly and renders a clean display

- **WHEN** an `add` op carries an explicit `id` of `cabbage::color-red` and a `name` of "Red cabbage" (e.g. the app materializing an accepted sibling swap)
- **THEN** the row stores `cabbage::color-red` as its key and "Red cabbage" as its `name` (validated as a live survivor, not re-resolved), it dedups/advances against any existing `cabbage::color-red` row, and every surface renders "Red cabbage" — never the raw id

#### Scenario: A multi-item capture is one operations call

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** one `update_grocery_list` call carries one `add` op per item, each applied as its own row write with per-op reporting

#### Scenario: Cart moves are freely writable

- **WHEN** an `update` op sets an `active` item to `in_cart`, or an `in_cart` item back to `active`
- **THEN** the write is applied unconditionally, in either direction

#### Scenario: Ordered cannot be minted from active

- **WHEN** an `update` op attempts to set an `active` item directly to `ordered`
- **THEN** the operation is rejected with a structured `validation_failed` carrying the attempted transition, and the row is unchanged

#### Scenario: The closed capture aliases are unknown tools

- **WHEN** a stale plugin calls `add_to_grocery_list` or `remove_from_grocery_list` (windows closed by operator waiver)
- **THEN** the call receives the generic unknown-tool rejection — capture goes through ops-form `update_grocery_list`

#### Scenario: The old single-patch form is rejected

- **WHEN** a caller invokes `update_grocery_list` in the retired single-patch shape (window closed by operator waiver)
- **THEN** the call is rejected as `malformed_data` naming the ops form, and nothing is written

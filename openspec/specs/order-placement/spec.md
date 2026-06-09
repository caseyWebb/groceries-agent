# order-placement Specification

## Purpose
TBD - created by archiving change order-placement. Update Purpose after archive.
## Requirements
### Requirement: Resolve the grocery list at order time

`place_order` SHALL resolve the **whole** to-buy set at order time — not at capture time — so the cart reflects current availability. The to-buy set SHALL be `grocery_list ∪ (menu needs) − (pantry has)`. Each item SHALL be resolved via the Change 05 matcher (`match_ingredient_to_kroger_sku`) with cache revalidation against current price and curbside/delivery availability. Items the matcher returns as `ambiguous` or `unavailable` SHALL be collected and surfaced as a **single batch checkpoint** for the user to disposition; the cart write SHALL NOT proceed for those items until resolved.

#### Scenario: Whole list resolved against current availability

- **WHEN** `place_order` runs with items on the grocery list
- **THEN** each is resolved via the matcher with cache revalidation, and a cache hit that is no longer fulfillable is re-resolved rather than used

#### Scenario: Ambiguous/unavailable items batched for decision

- **WHEN** one or more items resolve to `ambiguous` or `unavailable`
- **THEN** `place_order` returns them together as a checkpoint for the user to decide, and does not add those items to the cart unilaterally

### Requirement: Write the Kroger cart and persist learned mappings

For the resolved set, `place_order` SHALL add items to the Kroger cart via `PUT /v1/cart/add` and SHALL append newly learned ingredient→SKU mappings to `skus/kroger.toml` through the Change 06 atomic-commit engine. The cart write and the SKU-cache commit SHALL be **independent best-effort** operations — neither is transactional with the other, and a failure of one SHALL NOT corrupt the other. `place_order` SHALL return honest partial status and SHALL NOT report a populated cart when the cart write failed.

#### Scenario: Resolved items added and mappings cached

- **WHEN** the resolved set is non-empty and the cart write succeeds
- **THEN** the items are added via `PUT /v1/cart/add` and the new SKU mappings are committed to `skus/kroger.toml`

#### Scenario: Honest partial failure

- **WHEN** the SKU-cache commit succeeds but the cart write fails (or vice versa)
- **THEN** `place_order` reports the true status of each operation and never claims the cart is populated when it is not

### Requirement: Order lifecycle with user-asserted transitions

The order lifecycle SHALL be `active → in_cart → ordered → received`. `place_order` SHALL advance resolved items to `in_cart`. Because the Kroger cart API is write-only and unreadable, transitions past `in_cart` SHALL be **user-asserted**, never agent-verified: an "I placed the order" assertion advances `in_cart → ordered`; an "I picked up the groceries" assertion advances `ordered → received`, which is terminal — the item is removed from the list and, for `grocery`-kind items only, the corresponding `pantry.toml` quantity is restocked. The agent SHALL NOT claim an order was placed or received without the user's assertion.

#### Scenario: place_order marks items in_cart

- **WHEN** `place_order` adds resolved items to the cart
- **THEN** those grocery-list items advance to `status: in_cart`

#### Scenario: Pickup restocks the pantry and clears the list

- **WHEN** the user asserts "I picked up the groceries"
- **THEN** the ordered items are removed from the grocery list and `grocery`-kind items restock their pantry entries; `household`/`other` items do not touch the pantry

#### Scenario: Stale-cart reminder on a new order

- **WHEN** a new order begins while the prior list still has `in_cart` items never confirmed `ordered`
- **THEN** the agent reminds the user to clear the Kroger cart manually before proceeding, rather than silently double-adding

### Requirement: Quantity and partial-stock prompting

`place_order` SHALL default the buy quantity to one package per item unless the user specifies otherwise, consistent with the no-portion-math stance. When the pantry holds a **partial** of an ingredient the plan needs, the agent SHALL tell the user how much the plan needs (aggregated from the recipes' stated amounts) and ask whether to buy more — it SHALL NOT silently net partials against the order.

#### Scenario: Partial triggers a prompt

- **WHEN** an ingredient on the to-buy set is also present in the pantry as a partial
- **THEN** the agent surfaces the plan's required amount and asks whether to add it, rather than auto-deciding

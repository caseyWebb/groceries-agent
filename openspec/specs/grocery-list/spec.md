# grocery-list Specification

## Purpose
TBD - created by archiving change git-write-tools. Update Purpose after archive.
## Requirements
### Requirement: Grocery list is stored in and served from D1

The grocery list SHALL be stored as rows in the per-tenant D1 `grocery_list` table (keyed by `(tenant, normalized_name)`), not as a `grocery_list.toml` file or a `state:<username>:grocery_list` JSON array in KV. `read_grocery_list` SHALL query rows (a status filter applied as a `WHERE` clause); `add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list` and the order/cart status transitions SHALL be row-level upsert/update/delete (dedup by normalized name), not whole-array rewrites. Writes are strongly consistent (read-after-write).

#### Scenario: Adding an item inserts/updates one row

- **WHEN** `add_to_grocery_list` adds an item
- **THEN** a single `grocery_list` row is upserted for the caller, leaving other items untouched, and an immediately following read sees it

#### Scenario: Status filter is a query

- **WHEN** `read_grocery_list` is called filtered to `active`
- **THEN** the result comes from `WHERE tenant=? AND status='active'`, not by loading and filtering the whole list

### Requirement: Grocery list schema

The grocery list SHALL be an ingredient-level, **SKU-free** buy list of committed buy-intent that accumulates across a week. Each item SHALL carry: `name` (required, the order-time search term), `quantity` (loose buy amount, same looseness as pantry), `kind` (`grocery` | `household` | `other`, default `grocery`), `domain` (free string identifying the kind of store it's bought at — common values `grocery` | `home-improvement` | `garden` | `pharmacy`; default `grocery`), `status` (`active` | `in_cart` | `ordered`, required), `source` (`ad_hoc` | `menu` | `pantry_low` | `stockup`), `for_recipes` (recipe slugs; may be empty), `note` (freeform or null), `added_at` (ISO date, required), and `ordered_at` (ISO date or null). **`received` SHALL NOT be a stored status value**: receiving is the terminal receive *action* — the row is removed from the list and, for `grocery`-kind items only, the pantry is restocked — identical across every fulfillment mode (Kroger pickup, satellite checkout, in-store walk). The schema SHALL be documented in `docs/SCHEMAS.md`, and the list SHALL be agent-writable side-effect state (not user-curated config). Items SHALL NOT store a resolved Kroger SKU — resolution is deferred to order time. `domain` is orthogonal to `kind`: `kind` governs pantry reconcile on receive, `domain` governs which store-type a walk includes the item in.

#### Scenario: Item conforms to schema

- **WHEN** an item is written to the `grocery_list` table
- **THEN** it carries a `name`, a `status` from the legal set (`active` | `in_cart` | `ordered`), an `added_at` date, and no resolved SKU, and it passes write-time validation

#### Scenario: Receiving removes the row rather than storing a terminal status

- **WHEN** the user asserts groceries were picked up / received
- **THEN** each received item's row is removed (and `grocery`-kind items restock the pantry) — no row is ever written with `status: "received"`

#### Scenario: Non-food item is representable

- **WHEN** a household item such as "paper towels" is added
- **THEN** it is stored with `kind = "household"` and is not tied to any recipe or pantry entry

#### Scenario: Domain defaults to grocery

- **WHEN** an item is added with no `domain` supplied
- **THEN** it is stored with `domain = "grocery"` and validates unchanged (rows without a `domain` are read as `grocery`)

#### Scenario: Non-grocery item carries its domain

- **WHEN** a "2x4 lumber" item is added with `domain = "home-improvement"`
- **THEN** it is stored with that domain, included in an in-store walk for a `home-improvement` store, and excluded from a `grocery` walk

### Requirement: Grocery list CRUD tools

The system SHALL provide `read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, and `remove_from_grocery_list` for single-item live edits, each a row-level D1 operation that returns without a `commit_sha`. `add_to_grocery_list` SHALL be keyed by a **normalized name** and MERGE a re-added name into the existing row (union `for_recipes`, reconcile `quantity`) via upsert rather than creating a duplicate. The normalized key SHALL be resolved through the shared `IngredientContext` funnel (the canonical ingredient id — normalize **and** capture) for a **food** row, and through `normalizeName` (lowercase + whitespace-collapse) for a **non-food** row, where a row is food iff its `kind` is `grocery` and its `domain` is grocery (or absent). A non-food row SHALL NOT be resolved or captured, so the ingredient identity graph only ever ingests real food vocabulary. `remove_from_grocery_list` SHALL resolve its query through the same funnel so a case/quantity/alias-varying removal hits its row. New items SHALL be created with `status: active`. `update_grocery_list` SHALL guard the `status` lifecycle in the shared update operation (so every caller — the tool and any HTTP surface — gets the identical guarantee): transitions between `active` and `in_cart` SHALL be freely writable in both directions (including re-listing an `ordered` row back to `active`); a write of `status: "ordered"` SHALL be accepted **only** when the row's current status is `in_cart` (the user-asserted "I placed the order" advance) and SHALL stamp `ordered_at`; any other write of `ordered` SHALL be rejected with a structured `validation_failed` error carrying the attempted transition, leaving the row unchanged. The order-flow advance operations (`place_order`'s in-cart advance and the satellite receipt flush's ordered advance) are distinct code paths and SHALL be unaffected by the guard. The tool description SHALL state this guarantee. Because each write is a single-row D1 upsert/update/delete (no whole-file read-modify-write), several mutations in one turn are simply a sequence of row-level writes — there is no batch/commit tool and no full-file replay to drop concurrent updates.

#### Scenario: Re-adding an existing item merges

- **WHEN** `add_to_grocery_list` is called with a name already present on the list
- **THEN** the existing row is upserted (merged `for_recipes`, reconciled `quantity`) and no duplicate row is created

#### Scenario: Surface-form variants of a food item merge to one row

- **WHEN** a food item is on the list as "scallions" and `add_to_grocery_list` is called with "green onions" (or "2 lb chicken breast" when "chicken breast" is present)
- **THEN** both resolve to the same canonical id, so the add MERGES into the existing row rather than creating a second, surface-form-fragmented row

#### Scenario: A non-food item is not routed through the ingredient graph

- **WHEN** `add_to_grocery_list` is called with a `household`/`other` item or a non-grocery `domain` (e.g. "AA batteries", "potting soil")
- **THEN** the row is keyed by `normalizeName` and the name is NOT resolved or enqueued to the novel-term queue

#### Scenario: New item starts active

- **WHEN** a not-yet-present item is added
- **THEN** a `grocery_list` row is created with `status: "active"` and an `added_at` date, with no `commit_sha`

#### Scenario: Read returns the current list

- **WHEN** `read_grocery_list` is called
- **THEN** it returns the current rows with their fields, including `status` and `source`

#### Scenario: A multi-item capture is a sequence of row writes

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** each item is upserted as its own `grocery_list` row (no batch commit tool, no per-item git commit)

#### Scenario: Cart moves are freely writable

- **WHEN** `update_grocery_list` sets an `active` item to `in_cart`, or an `in_cart` item back to `active`
- **THEN** the write is applied unconditionally, in either direction

#### Scenario: The user-asserted order-placed advance stamps ordered_at

- **WHEN** `update_grocery_list` sets an `in_cart` item to `ordered` (the user asserting the order was placed)
- **THEN** the row advances to `ordered` and `ordered_at` is stamped with today's date

#### Scenario: Ordered cannot be minted from active

- **WHEN** `update_grocery_list` attempts to set an `active` item directly to `ordered`
- **THEN** the write is rejected with a structured `validation_failed` error carrying the attempted transition, and the row is unchanged

### Requirement: Prompted promotion from pantry

When a pantry item is low or out, the system SHALL treat adding it to the grocery list as a prompted, user-confirmed decision and SHALL NOT auto-add it. An item promoted from pantry SHALL be recorded with `source: "pantry_low"`. Observation (pantry quantity) and intent (the buy list) are kept as distinct facts.

#### Scenario: Low pantry item is offered, not auto-added

- **WHEN** the user reports an item is low or out and the agent considers it for the buy list
- **THEN** the item is added to the `grocery_list` table only after the user confirms, recorded with `source: "pantry_low"`

### Requirement: Provenance supports order-time dedup and aggregation

The list's `source` and `for_recipes` fields SHALL carry enough provenance for order-time reconciliation without storing portion math. The order-time to-buy set SHALL be `grocery_list(active) ∪ menu-needs − pantry-has`, where **menu needs are derived server-side from the meal plan's recipes' derived full ingredient lists** (see the derived to-buy read requirement) rather than materialized into rows at plan time; `for_recipes` SHALL let the agent aggregate how much the menu needs of an ingredient from the recipes' stated amounts. Explicit `source: "menu"` rows remain legal and meaningful: they are **materializations** — a derived need pinned or edited into an explicit row (or an open-world side's world-knowledge ingredients, which have no recipe to derive from) — and they merge with the derived need under the same canonical id. Lifecycle transitions past `active` (`in_cart`, `ordered`, and the terminal receive action) are driven by the order-placement flow and the user-asserted transitions.

#### Scenario: Menu-derived item records its recipes

- **WHEN** an ingredient reaches the list as an explicit menu row (a materialization or an open-world side ingredient)
- **THEN** it is recorded with `source: "menu"` and any contributing recipe slugs in `for_recipes`

#### Scenario: A materialized row and its derived need do not double-count

- **WHEN** the order-time to-buy set is computed while an ingredient exists both as a derived plan need and as an explicit `source: "menu"` row
- **THEN** the two merge on the canonical id into a single to-buy line with unioned `for_recipes`

### Requirement: The to-buy set is a derived, first-class read

The system SHALL expose the order-time to-buy set as a read — computed at read time from the `active` grocery list, the meal plan's derived ingredient needs, and the pantry, joined on canonical ingredient ids by the same shared set-algebra operation `place_order` uses — via the MCP `read_to_buy` tool and the member app's grocery read surface, both calling one shared operation. Derived lines SHALL carry `source:"menu"`-shaped provenance (`origin: "plan"`, `for_recipes`) and SHALL exist only in the read: no reconcile, cron, or write path SHALL materialize plan needs into `grocery_list` rows automatically — materialization SHALL happen only through an explicit edit/pin (the standard add upsert). Pantry-covered needs SHALL be returned as a distinct section (never silently dropped), and planned recipes with no derived ingredient list SHALL be reported by slug.

#### Scenario: The plan is the source of truth for derived lines

- **WHEN** the meal plan changes (a recipe added, removed, or swapped)
- **THEN** the next to-buy read reflects the change with no intervening write to `grocery_list`

#### Scenario: No automatic materialization

- **WHEN** the to-buy read computes derived lines
- **THEN** it writes nothing: repeated reads with unchanged inputs return the same lines and leave `grocery_list` untouched


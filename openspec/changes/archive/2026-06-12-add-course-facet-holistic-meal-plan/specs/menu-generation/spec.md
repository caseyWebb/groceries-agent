## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather context by calling `read_pantry`, `read_preferences`, `read_taste`, `ready_to_eat_available`, `kroger_flyer`, **and `list_recipes({ status: "active" })`** together (in parallel) **before** assembling a proposal, so that pantry contents, sale data, ready-to-eat availability, preferences, taste, and the **full active corpus (mains and sides together)** all inform the same proposal. The `list_recipes` call is the **single faceted load**: because `course` rides every entry's frontmatter, one call returns active mains and sides with full metadata and the agent buckets them by `course` — there SHALL NOT be a separate later call to source sides. The **raw pantry** (`read_pantry`) SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins by reasoning over it), not merely the post-selection buy list. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. `kroger_prices` is a *costing* input issued after a tentative menu (mains plus sides) exists (it needs the chosen ingredients), not part of the up-front selection batch.

#### Scenario: Open-ended request gathers selection context before proposing

- **WHEN** the user says "make me a menu"
- **THEN** the agent calls `read_pantry`, `read_preferences`, `read_taste`, `ready_to_eat_available`, `kroger_flyer`, and `list_recipes({ status: "active" })` before presenting any menu proposal, and issues no `verify_pantry_*` call

#### Scenario: One faceted load returns mains and sides together

- **WHEN** the up-front batch runs
- **THEN** the single `list_recipes({ status: "active" })` result carries `course` on every entry, the agent buckets it into mains and sides, and no separate side-sourcing `list_recipes` call is made later in the flow

#### Scenario: Pantry informs selection, not just the buy list

- **WHEN** the member has salmon and bok choy on hand and makes an open-ended request
- **THEN** the agent reasons over the loaded pantry to favor recipes that use what is already on hand, before finalizing the proposed set

#### Scenario: Pantry confirmation pass is not skipped

- **WHEN** any menu request is made
- **THEN** the agent runs the comprehensive pantry confirmation pass (including staples and spices) by reasoning over the loaded pantry, rather than proposing a menu without considering pantry state

### Requirement: To-buy list assembled from recipe content and the loaded pantry

The to-buy list SHALL be produced by the agent reasoning over the chosen recipes' content and the loaded pantry, not by a `verify_pantry_*` tool. At the cost/confirm step the agent SHALL load each chosen **recipe's** full content (`read_recipe`) — mains and corpus sides, which it needs to cook regardless — match the recipe's ingredients against the loaded pantry (treating semantic equivalents like `scallion`/`green onion` as on-hand, surfacing genuinely-absent items as to-buy), and emit the result directly as `grocery_list_ops`, attributing each item to the recipe(s) needing it. For an **open-world side** (which has no recipe to read), the agent SHALL enumerate its ingredients from world knowledge (e.g. roasted broccoli → broccoli, olive oil, garlic), match them against the loaded pantry the same way, and emit the absent ones as to-buy. Presence-only stance holds: the agent SHALL NOT net quantities against the buy list (quantity reconciliation stays the order-placement partials flow). The buy list SHALL be confirmed conversationally before commit, so a missed or mismatched item is caught before it is persisted.

#### Scenario: To-buy comes from read_recipe + pantry reasoning, not a verify tool

- **WHEN** the user agrees to a menu and the agent assembles the buy list
- **THEN** the agent loads the chosen recipes via `read_recipe`, matches their ingredients against the loaded pantry, and emits `grocery_list_ops` for the absent items — issuing no `verify_pantry_*` call

#### Scenario: Open-world side ingredients come from world knowledge

- **WHEN** a chosen open-world side ("roasted broccoli") has no corpus recipe
- **THEN** the agent enumerates its ingredients from world knowledge, matches them against the loaded pantry, and adds the absent ones to the buy list without a `read_recipe` call for the side

#### Scenario: Semantic on-hand match avoids a needless buy

- **WHEN** a chosen recipe calls for `scallions` and the loaded pantry contains `green onions`
- **THEN** the agent treats it as on-hand (not added to the buy list), as a confirmable judgment rather than a string match

### Requirement: Capture to grocery list, never flush to cart

On agreement, the agent SHALL persist the menu's to-buy items to `grocery_list.toml` via `commit_changes`/`add_to_grocery_list` (ingredient-level, SKU-free), and SHALL record the agreed recipes as `[[planned]]` rows in `meal_plan.toml` (committed cook intent), setting `planned_for` to the intended cooking night when known, along with side effects such as pantry verifications. **Corpus sides** (`course: side` recipes) are recipes and SHALL be captured the same way as mains: each chosen corpus side earns its own `[[planned]]` slug row, its to-buy ingredients are added to `grocery_list.toml`, and any side draft imported during plate-rounding plus any new `pairs_with` edge SHALL be committed in the same operation. **Open-world sides** (free-text plate companions with no corpus recipe) SHALL instead be captured as a `sides` array on their **accompanying main's** `[[planned]]` row, and their world-knowledge-derived ingredients SHALL be added to `grocery_list.toml` with `source = "menu"`, `for_recipes = []` (no slug to attribute to), and a `note` identifying the side (e.g. "for the roasted-broccoli side"). The agent SHALL NOT bump `last_cooked` on menu agreement — `last_cooked` moves only when a cook is asserted and logged (see the cooking-history capability). The menu flow SHALL NOT call `place_order` or otherwise write the Kroger cart. Cart population SHALL occur only on an explicit order request.

#### Scenario: Agreed menu captures intent without touching the cart

- **WHEN** the user agrees to a proposed menu
- **THEN** the agent commits the to-buy items to `grocery_list.toml`, writes the agreed recipes to `meal_plan.toml`, and does NOT call `place_order` or write the Kroger cart

#### Scenario: Agreed corpus side captures as its own planned recipe

- **WHEN** the user agrees to a menu in which a main was rounded out with a `course: side` corpus recipe
- **THEN** the agent writes a `[[planned]]` slug row for the side, adds the side's to-buy ingredients to `grocery_list.toml`, and commits any new `pairs_with` edge or imported side draft in the same commit

#### Scenario: Agreed open-world side captures on the main's row and flows to the buy list

- **WHEN** the user agrees to a menu in which a main was rounded out with an open-world side ("roasted broccoli")
- **THEN** the agent writes `sides = ["roasted broccoli"]` on the main's `[[planned]]` row (no separate slug row), and adds the side's absent ingredients to `grocery_list.toml` as `source = "menu"`, `for_recipes = []`, with a `note` identifying the side — all in the same commit, cart untouched

#### Scenario: Agreement does not record a cook

- **WHEN** the user agrees to a proposed menu
- **THEN** no `cooking_log.toml` entry is appended and no recipe's `last_cooked` is changed

#### Scenario: Empty-cart case is stated explicitly

- **WHEN** the pantry already covers everything the agreed menu needs
- **THEN** the agent says so explicitly, commits any pantry verifications, writes the agreed recipes to `meal_plan.toml`, and adds nothing to `grocery_list.toml`

### Requirement: Plate-rounding with side pairings

When assembling a menu, the agent SHALL round out each main that is not an already-complete plate by surfacing or sourcing a savory side (starch, vegetable, salad, or bread). Whether a main is an already-rounded plate (a one-pot dish, a composed grain bowl, a protein-plus-vegetable sheet-pan dinner) SHALL be **inferred by the agent at plan time** from the recipe's content — there is no persisted `standalone` flag to gate on, and the agent SHALL NOT prompt for a side when it judges the main already stands alone. For a non-standalone main, if its `pairs_with` already names one or more **corpus sides**, the agent SHALL surface those remembered sides for the user to choose from rather than sourcing a new one. A chosen side MAY be either a **corpus side** (a `course: side` recipe, sourced via the faceted load already in hand) or an **open-world side** (a trivial preparation named from world knowledge — "white rice", "a simple arugula salad" — that needs no recipe file). The plate-rounding judgment SHALL be part of the single holistic reasoning pass over the faceted load and loaded pantry (see "Holistic plate reasoning over one faceted load"), not a separate phase that issues its own recipe-search calls. Drink, wine, and dessert pairings are out of scope for this capability.

#### Scenario: Already-rounded main is not prompted for a side

- **WHEN** the agent judges a chosen main to be an already-rounded one-pot plate
- **THEN** the agent does not propose or source a side for it and proceeds to assemble the proposal — without writing or reading any persisted standalone flag

#### Scenario: Remembered corpus pairing is surfaced

- **WHEN** a non-standalone main's `pairs_with` already names a corpus side recipe
- **THEN** the agent surfaces that remembered side for the user to accept rather than searching for a new one

#### Scenario: Open-world side rounds out a main

- **WHEN** a non-standalone main has no remembered pairing and the natural companion is a trivial preparation (e.g. steamed rice)
- **THEN** the agent MAY propose it as an open-world side, without minting a recipe for it

#### Scenario: Chosen side joins the pantry and pricing pass

- **WHEN** the user accepts a side (corpus or open-world) for a main
- **THEN** the agent reasons over the side's ingredients against the loaded pantry and includes the side's to-buy ingredients in the `kroger_prices` call alongside the mains' ingredients

### Requirement: Side pairing bootstrap when the edge is empty

When a non-standalone main has an empty `pairs_with` and the natural companion warrants a saved recipe (a side with technique worth keeping, not a one-line preparation), the agent SHALL bootstrap a **corpus** pairing at plan time: it SHALL prefer existing `course: side` recipes (already in hand from the faceted load), then the RSS discovery pool (`fetch_rss_discoveries`), then a web parse (`parse_recipe`); it SHALL propose at most two candidate sides in chat; and on the user accepting such a side it SHALL ensure the side exists as a recipe (importing it as a `status: draft` recipe via the discovery path when it does not already exist, classified with `course: [side]`) and SHALL record the pairing by adding the side's slug to the main's `pairs_with` through `update_recipe`. The recorded edge is shared content, so a later menu request for the same main SHALL find the pairing already present and surface it. When the natural companion is instead a **trivial open-world side**, the agent SHALL NOT import a recipe or record a `pairs_with` edge — it proposes the open-world side directly (re-derived by reasoning each time, since it has no slug to remember). The bootstrap SHALL select sides by plate fit.

#### Scenario: Empty pairs_with bootstraps a corpus side

- **WHEN** a non-standalone main has an empty `pairs_with`, the natural companion warrants a saved recipe, and the user requests a menu including it
- **THEN** the agent searches corpus-then-RSS-then-web, proposes one or two savory sides, and asks the user to choose

#### Scenario: Accepted corpus bootstrap imports the side and records the edge

- **WHEN** the user accepts a proposed corpus side that is not yet in the corpus
- **THEN** the agent imports it as a `status: draft` recipe with `course: [side]` and adds its slug to the main's `pairs_with` in the same commit

#### Scenario: Trivial companion stays open-world, not recorded

- **WHEN** the natural companion is a one-line preparation (steamed rice, dressed greens)
- **THEN** the agent proposes it as an open-world side and records no `pairs_with` edge and imports no recipe

#### Scenario: Recorded pairing is reused next time

- **WHEN** a later menu request includes the same main whose `pairs_with` now names the previously-recorded corpus side
- **THEN** the agent surfaces the recorded side and does not re-run the bootstrap search

## ADDED Requirements

### Requirement: Holistic plate reasoning over one faceted load

On a menu request, the agent SHALL perform menu selection and plate-rounding as a **single holistic reasoning pass** over the one faceted active-recipe load (mains and sides bucketed by `course`) and the loaded pantry, rather than as sequenced phases each issuing their own recipe-search calls. In this one pass the agent SHALL reason across: (a) the **menu** of mains, pulled toward what the pantry already holds; (b) **sides**, both corpus (`course: side`) and open-world; (c) **expiry-matching** — biasing the menu toward pantry items likely to spoil soon, judged from each item's `added_at`, `category` (e.g. `fridge` faster than `freezer`/`pantry`), and `prepared_from`, since the pantry carries no explicit expiry date; and (d) **inventory substitutions** — stand-ins the member already has for an otherwise-absent ingredient. Only after this pass produces a tentative full plate (mains plus sides) SHALL the agent issue the `kroger_prices` costing call and present the proposal for confirmation.

#### Scenario: Sides are reasoned in the same pass as mains, not a later phase

- **WHEN** the agent assembles a proposal from the faceted load
- **THEN** mains and their sides are chosen together in one reasoning pass over the loaded set and pantry, with no separate side-sourcing tool calls issued after the mains are picked

#### Scenario: Expiry-matching pulls the menu toward soon-to-spoil items

- **WHEN** the loaded pantry shows a fridge item added many days ago whose freshness is waning
- **THEN** the agent biases the menu toward a recipe (or open-world side) that uses that item, reasoning from `added_at`/`category` rather than any stored expiry date

#### Scenario: Costing runs last on the full plate

- **WHEN** the holistic pass has produced a tentative plate of mains and sides
- **THEN** the agent issues a single `kroger_prices` call over the combined to-buy set (mains, corpus sides, and open-world side ingredients) before presenting the proposal — not before the plate is settled

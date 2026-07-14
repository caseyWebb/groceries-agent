# spend-telemetry Specification

## Purpose
TBD - created by archiving change spend-capture-on-order-commit. Update Purpose after archive.
## Requirements
### Requirement: Spend is captured in two phases — snapshot at send, materialize at the purchase assertion

Spend telemetry SHALL be captured in two phases (D16). SNAPSHOT: an order flush that advances grocery rows to `in_cart` (the `place_order` Kroger flush and the satellite cart-fill receipt's first landing) SHALL persist a **send record** — one `order_sends` row (`store`, `location_id`, `fulfillment` path, `created_at`; the satellite send's id SHALL equal its order-list id so replays converge) plus one `order_send_lines` row per advanced line carrying the resolved pick (`sku`/`brand`/`size`), package `quantity`, the per-package `price_regular`/`price_promo`/`on_sale`/effective `unit_price`, sale `savings`, an `estimated` flag (`0` on send-path quotes), the `department` stamp (NULL only while pending classification — see the department requirement), the `provenance` class, and `for_recipes`. Fields the path cannot know SHALL be stored NULL-unknown (the satellite's single observed price populates `unit_price` only), never fabricated. MATERIALIZE: spend events SHALL be written by ONE shared `src/` writer at the purchase assertion — the guarded `in_cart → ordered` advance on every surface, per the `order-placement` lifecycle — **copying the snapshot line verbatim** (prices, department — a pending NULL copies as NULL, provenance, store, fulfillment; `amount = unit_price × quantity`, NULL when unpriced), idempotent on the `(send_id, line_key)` primary key. Emission SHALL live inside the shared operations, never in a surface, and no path SHALL re-price or re-derive at materialize time. Snapshot prices are send-time quotes by definition — the Kroger cart is write-only and no fulfillment receipt exists — and no reconciliation step SHALL be implied or attempted.

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

The capture SHALL enforce D16's negative rules, each homed in a shared operation — never in a skill. A row leaving `in_cart` without a purchase assertion (re-listed to `active`, removed, or rolled back by a failed cart write) SHALL write no spend and SHALL drop its send linkage. The terminal receive action SHALL price nothing itself, and the shared removal operation SHALL never write spend — a bare removal of an `in_cart` row is NOT an assertion (a remove is also "changed my mind"). Any operation that completes a receive for rows still `in_cart` (the collapsed ordered+received assertion — e.g. the shared shop-commit/receive operation when it ships) SHALL internally perform the purchase assertion first: advance through the shared guarded transition, materialize via the one writer, then complete the receive; until such an operation exists, receive is realized as removals (which write no spend) and the persona's advance-first receive choreography is advisory. Re-listing an `ordered` row SHALL void its materialized events (a `voided_at` stamp — never a delete; reads filter voided events out). Rows advanced by a manual `active → in_cart` write carry no send linkage, and a purchase assertion for a row without one SHALL write no spend event (band 3's shop-commit op extends coverage to unsnapshotted purchases). Never-marked orders SHALL surface as "awaiting mark-placed" (the retrospective spend section's count and the to-buy view's existing `in_cart` section) and SHALL never be auto-counted as spend.

#### Scenario: Re-listing an in_cart row writes nothing

- **WHEN** an `in_cart` row that was advanced by a flush is set back to `active`
- **THEN** no spend event is written and the row's send linkage is cleared — its snapshot lines simply never materialize

#### Scenario: Re-listing an ordered row voids its events

- **WHEN** an `ordered` row with materialized spend events is re-listed (to `active` or `in_cart`)
- **THEN** its events for that send are stamped `voided_at` (not deleted), the send linkage clears, and spend reads no longer count them

#### Scenario: A manual in_cart move never manufactures spend

- **WHEN** a member freely moves a row `active → in_cart` by hand and later marks it `ordered`
- **THEN** no send record backs the row, so no spend event is written — prices from an unrelated historical send are never resurrected

#### Scenario: A bare removal writes no spend, with no skill involved

- **WHEN** an `in_cart` row is removed through the shared removal operation (a collapsed receive expressed as removes, or a changed mind) by any caller — skill-guided or not
- **THEN** no spend event is written and the send linkage dies with the row — the guarantee is the operation's, not the choreography's

#### Scenario: An unmarked order is surfaced, not counted

- **WHEN** rows sit at `in_cart` under a send with no `ordered` assertion
- **THEN** spend aggregates exclude them and report their count as awaiting mark-placed

### Requirement: Spend lines stamp the one canonical department dimension at capture, pending until classified

Every send line and spend event SHALL carry a `department` from the ONE canonical analytics dimension (D17) owned by `src/department.ts`: the snake_case food vocab — `produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages` — plus `household` and `leftovers`, with NO other value. The stamp SHALL never be derived at read time and SHALL never come from store placement (`sku_cache` aisle data and Kroger product categories are presentation-only). Derivation SHALL be deterministic and identity-keyed via a grocery-line helper in that shared module: a non-food line (`kind` of `household`/`other`, or a non-grocery `domain` — the "2x4 lumber" fixture) SHALL stamp `household` immediately (never pending; included in spend, excluded from cost-per-meal); a food line SHALL stamp its canonical ingredient id's memoized category (`ingredient_identity.category`, representative-resolved — the same memo pantry-add autofill and waste stamping read); a food id not yet classified SHALL be stored **NULL = pending classification**, filled exactly once (NULL → value, never a rewrite) by the shared `ingredient-category` scheduled job — so a capture that races the classifier records pending rather than a guess, "Not mapped" never reaches analytics (band 4 reads stamped values and the backlog drains to zero), and a stamped value is never rewritten (vocab/memo evolution never rewrites history). `leftovers` SHALL be stamped only by waste capture over `prepared_from` pantry rows, never by spend lines. The cost-per-meal exclusion set `{household, beverages}` SHALL be defined beside the vocab in `src/department.ts` as the constant band 4's analyzer consumes. Capture paths SHALL only apply overrides and read the memo — no tool or capture path SHALL invoke the model inline (the determinism boundary).

#### Scenario: A household line stamps household immediately

- **WHEN** a "paper towels" (`kind: household`) or "2x4 lumber" (`domain: home-improvement`) line is snapshotted
- **THEN** its department is `household` — never pending, included in spend, excluded from the cost-per-meal constant — with no ingredient-graph involvement

#### Scenario: A memoized food line stamps its category

- **WHEN** a "tomatillos" line is snapshotted after the `ingredient-category` job memoized its identity as `produce`
- **THEN** the send line and its later spend event both carry `produce`

#### Scenario: A cold id records pending and converges to the true category

- **WHEN** a food line is snapshotted before its identity has classified
- **THEN** its department is stored NULL (pending), and once the identity classifies the fill stamps the TRUE category on the NULL rows exactly once — never rewriting an already-stamped value

#### Scenario: Store placement never feeds the dimension

- **WHEN** a line's resolved product carries an aisle placement or Kroger category
- **THEN** the department stamp ignores them — placement data remains presentation-only for list grouping and the walk

#### Scenario: Capture never calls the model

- **WHEN** a send snapshot stamps departments
- **THEN** it resolves overrides and memo lookups only — no AI call occurs on the order path

### Requirement: Pending spend departments are filled by the shared ingredient-category job

The shared `ingredient-category` scheduled job (owned by the pantry-disposition capability: classify unclassified identity survivors → backfill pantry categories → stamp pending waste events) SHALL additionally fill `order_send_lines.department` and `spend_events.department` where NULL, from the identity memo via each row's `line_key` (alias → identity → representative `category`, any memo value including `household`). The fill SHALL be NULL → value only, bounded, and idempotent; no separate job, `scheduled()` wiring, or AI activity SHALL be introduced for spend. No separate enqueue mechanism is needed: every food line key is a canonical ingredient id minted through the IngredientContext funnel, so pending ids appear in the classify phase's existing backlog, and non-food keys never need classification (the `household` override stamps them at capture).

#### Scenario: Pending spend rows drain across ticks

- **WHEN** send lines and spend events hold NULL departments whose identities have classified (or classify this tick)
- **THEN** the job's fill phase stamps them from the memo, the pending count decreases monotonically, and a replayed tick rewrites nothing

#### Scenario: A stamped spend row is never revisited

- **WHEN** the memo for an identity later changes (a reclassify migration)
- **THEN** send lines and spend events already stamped keep their capture-time value — the fill touches NULL rows only

### Requirement: Spend aggregates are agent-readable via retrospective; no spend-write tool exists
The `retrospective` tool SHALL return a read-only, household-scoped `spend` value produced by the shared `readSpendAnalyzer` operation. Its optional `spend_range` input SHALL accept exactly `4w`, `8w`, or `12w` and SHALL default to `4w` when omitted; the existing cooking `period` input SHALL remain independent. The existing profile retrospective result SHALL expose the same object at `.spend` and SHALL retain the four-week default. The object SHALL preserve the legacy `weekly_budget`, `weeks[].total`, `weeks[].savings`, `weeks[].events`, `weeks[].estimated`, and `awaiting_mark_placed` fields while adding the range, date bounds, coverage, KPI, breakdown, driver, and insight fields defined by this specification. No LLM SHALL participate in the aggregate read. No MCP tool SHALL write spend events directly: spend SHALL continue to materialize only inside the existing shared purchase-assertion and shop-completion operations.

#### Scenario: An omitted MCP spend range preserves the legacy default
- **WHEN** an authenticated member invokes `retrospective` without `spend_range`
- **THEN** `.spend.range` is `4w`, `.spend.weeks` contains four chronological ISO-week buckets, and the cooking result continues to use the independently selected `period`
#### Scenario: An explicit MCP spend range changes only spend analysis
- **WHEN** an authenticated member invokes `retrospective` with `spend_range: "12w"` and a cooking `period`
- **THEN** `.spend` is the shared twelve-week analyzer object and the cooking period's behavior is unchanged
#### Scenario: Existing profile retrospective callers remain compatible
- **WHEN** an existing caller reads the profile retrospective surface without a spend-range argument
- **THEN** its `.spend` value uses the same shared analyzer operation with the four-week default and retains all legacy Spend fields with their compatible types
#### Scenario: The MCP read is household scoped
- **WHEN** an authenticated MCP identity reads retrospective while another tenant has spend facts in the same database
- **THEN** `.spend` contains only facts owned by the identity's resolved tenant and no public input can select the other tenant
#### Scenario: No spend-write tool exists
- **WHEN** the MCP tool surface is enumerated
- **THEN** no tool accepts a spend event or analyzer aggregate for writing, and invoking `retrospective` performs no write or other side effect

### Requirement: The Spend analyzer uses bounded UTC ISO-week windows
`readSpendAnalyzer(env, tenant, range, now?)` SHALL accept exactly `4w`, `8w`, or `12w`, map the range to N weekly buckets, and treat `now.toISOString().slice(0, 10)` as the authoritative UTC `as_of` date. Weeks SHALL start on ISO Monday and end on Sunday. If `current_start` is the Monday containing `as_of`, the selected window SHALL be `selected_start = current_start - (N - 1) * 7 days` through `selected_end = as_of`, inclusive. The matched prior window SHALL be `prior_start = selected_start - N * 7 days` through `prior_end = as_of - N * 7 days`, inclusive. The selected response SHALL contain exactly N buckets oldest first; each bucket SHALL expose its Monday `week_start`, Sunday `week_end`, `through` equal to the earlier of that Sunday and `as_of`, and `is_partial` equal to whether `through` precedes `week_end`.

The spend-fact read SHALL be bounded on both sides from `prior_start` through `as_of`, the cooking-log denominator read SHALL be bounded from `selected_start` through `as_of`, and future-dated facts SHALL be excluded. Profile budget and current awaiting-placement counts SHALL be tenant-bounded current-state reads and SHALL NOT be given invented historical dates. The operation SHALL receive the resolved internal tenant and every database read SHALL include that tenant; no API or tool input SHALL accept a tenant id.

#### Scenario: Four weeks include the current partial ISO week
- **WHEN** the analyzer reads `4w` on UTC Wednesday 2026-07-15
- **THEN** it returns four buckets from Monday 2026-06-22 through the bucket beginning Monday 2026-07-13, `selected_end` is 2026-07-15, and the final bucket has `through: "2026-07-15"` and `is_partial: true`
#### Scenario: A Sunday closes the current bucket
- **WHEN** the analyzer reads on a UTC Sunday
- **THEN** the final bucket's `through` equals its `week_end` and `is_partial` is false
#### Scenario: Each supported range has a matched prior shape
- **WHEN** `4w`, `8w`, or `12w` is requested on any weekday
- **THEN** the selected result has respectively 4, 8, or 12 chronological buckets and the prior interval ends on the same weekday exactly N weeks earlier
#### Scenario: The largest range remains bounded
- **WHEN** `12w` is requested
- **THEN** spend facts are read only from the matched 24-week span through `as_of`, and cooking facts are read only from the selected twelve-week span through `as_of`
#### Scenario: Future facts are not pulled into the current analysis
- **WHEN** the tenant has spend or cooking rows dated after `as_of`
- **THEN** those rows affect neither the selected buckets nor the prior comparison nor the meal denominator
#### Scenario: UTC date boundaries are not reinterpreted
- **WHEN** stored spend and cooking facts carry ISO dates around a civil-timezone boundary
- **THEN** the analyzer groups the stored date values by UTC ISO Monday without inferring a household timezone or rewriting capture meaning
#### Scenario: Tenant isolation applies to every analyzer source
- **WHEN** two tenants have overlapping spend dates, cooking dates, profile budgets, and awaiting-placement rows
- **THEN** a read for one tenant uses only that tenant's facts from all four sources
### Requirement: The Spend analyzer exposes one additive, coverage-aware aggregate
The shared result SHALL contain `range`, `as_of`, `selected_start`, `selected_end`, `prior_start`, `prior_end`, overall `status`, `coverage`, normalized `weekly_budget`, chronological `weeks`, `awaiting_mark_placed`, `kpis`, `breakdowns`, `top_drivers`, and `insight`. `coverage` SHALL contain monetary, department, and savings coverage. Monetary coverage SHALL expose `status`, `event_count`, `priced_event_count`, `unpriced_event_count`, `estimated_event_count`, and `known_amount`. Department coverage SHALL expose `status`, `event_count`, `classified_event_count`, and `pending_event_count`. Savings coverage SHALL expose `status`, `event_count`, `known_event_count`, `unknown_event_count`, and `known_savings`.

Each week SHALL retain numeric legacy `total`, `savings`, `events`, and `estimated` values and SHALL additionally expose its date bounds, partial flag, overall status, all three coverage objects, and `over_budget`. A legacy numeric total or savings value SHALL be the known subtotal only; adjacent coverage SHALL make missing or estimated input explicit and no consumer SHALL present such a subtotal as complete when its status says otherwise.

For a set of selected non-voided events, monetary status SHALL be `empty` when there are no events, `unavailable` when there are events but no priced event, `partial` when at least one event is priced and at least one event is unpriced or estimated, and `complete` otherwise. Department status SHALL be `empty` with no events, `unavailable` when no event has a captured department, `partial` when some but not all events have a department, and `complete` otherwise. Savings status SHALL apply the analogous empty/unavailable/partial/complete rule to null versus non-null savings values. Estimated amounts SHALL contribute to known monetary subtotals while forcing monetary status to `partial`.

Overall status SHALL be `empty` with no events, `unavailable` when monetary status is unavailable, `partial` when monetary status is partial or department status is not complete, and `complete` otherwise. Each week SHALL derive these statuses from that week's own facts. Missing departments SHALL never create a `Not mapped` key or any other synthetic classification.

#### Scenario: Empty history is distinct from unavailable history
- **WHEN** the selected window contains no non-voided spend event
- **THEN** overall, monetary, department, and savings statuses are `empty`, all event counts and known subtotals are zero, and the result is not labelled unavailable
#### Scenario: Fully unpriced history remains observable
- **WHEN** the selected window contains spend events but every `amount` is null
- **THEN** monetary and overall status are `unavailable`, event and unpriced counts report the recorded facts, `known_amount` and legacy totals remain zero, and no monetary value is fabricated
#### Scenario: Mixed priced and unpriced history reports a known partial subtotal
- **WHEN** at least one selected event has a usable amount and at least one has a null amount
- **THEN** monetary and overall status are `partial`, `known_amount` and legacy totals sum only usable amounts, and priced and unpriced counts identify the missing portion
#### Scenario: Estimated prices remain usable but visibly partial
- **WHEN** all selected events have amounts and at least one has `estimated=1`
- **THEN** estimated amounts contribute to `known_amount`, `estimated_event_count` is positive, and monetary and overall status are `partial`
#### Scenario: Pending classification makes an otherwise priced result partial
- **WHEN** every selected event has an exact usable amount but at least one has a null department
- **THEN** monetary status is `complete`, department status and overall status are `partial`, and the pending count is reported without a synthetic department item
#### Scenario: Savings missingness does not change spend status
- **WHEN** selected events have complete exact amounts but some `savings` values are null
- **THEN** monetary spend can remain complete, savings coverage is partial, and `known_savings` plus the legacy savings subtotal includes only non-null savings
#### Scenario: Weekly coverage is derived from each bucket
- **WHEN** one selected week is fully priced and another contains only unpriced events
- **THEN** the first week reports its own complete monetary subtotal, the second reports unavailable monetary coverage and a zero known subtotal, and the aggregate coverage reflects all selected events
#### Scenario: Voided events do not enter coverage
- **WHEN** a selected-date event has `voided_at` set
- **THEN** it contributes to no count, subtotal, status, bucket, KPI, breakdown, driver, or insight input
### Requirement: Spend KPIs use exact denominators and truthful missing-data behavior
All monetary inputs SHALL be converted to integer cents by rounding each stored decimal once, summed as integers, and converted back at output. Currency metrics SHALL round to cents and percentages, including trend, SHALL round to one decimal. Any percentage or ratio whose denominator is zero SHALL be `null` unless this requirement defines the empty cost-per-meal amount as exact zero.

`total_spend` SHALL use monetary coverage status: its amount SHALL be `0` for empty, `null` for unavailable, and the known subtotal for partial or complete coverage. `average_per_week` SHALL use the same status and SHALL divide the known subtotal by N, including zero-valued empty weeks and the current partial bucket; it SHALL NOT prorate by elapsed days.

Cost per meal SHALL count each selected `cooking_log` row of type `recipe` or `ad_hoc` exactly once. Breakfast, lunch, dinner, project, and legacy null `meal` values SHALL count; `ready_to_eat` SHALL not. Servings, quantities, household size, and weights SHALL not be inferred. Its numerator SHALL include priced, non-voided selected spend events whose non-null capture-stamped department is not `household` or `beverages`; total spend SHALL continue to include priced Household and Beverages events.

The cost numerator SHALL be `empty` with no spend event. It SHALL be `unavailable` when a pending department or eligible unpriced row could affect the numerator and there is no priced eligible row; it SHALL be `partial` when a priced eligible row exists and any eligible row is unpriced or estimated or any row's department is pending; otherwise it SHALL be `complete`, including the exact zero produced solely by classified excluded-department rows. With zero qualifying meals the KPI SHALL return `amount: null`, status `unavailable`, and reason `zero_meals`. With meals but an unavailable numerator it SHALL return `amount: null` and reason `numerator_unavailable`. With an empty numerator it SHALL return exact amount `0`; with a partial or complete numerator it SHALL divide `known_numerator` by `meal_count` and retain that numerator status.

Trend SHALL compare selected total spend with its same-shaped prior interval. An empty side SHALL be an exact zero for comparison; an estimated or unpriced side SHALL be incomplete. Reason precedence SHALL be `current_incomplete`, then `prior_incomplete`, then `prior_zero`. Only a complete-or-empty current side, a complete prior side, and positive prior known amount SHALL yield `(current - prior) / prior * 100`; every other case SHALL yield `percent: null`, status `unavailable`, and the applicable reason.

`weekly_budget` SHALL be null when the stored budget is absent or non-positive. A null budget SHALL yield `over_budget: null`. With a positive budget, a week whose known subtotal already exceeds the budget SHALL yield `true` even when the calendar week or price coverage is partial. Otherwise an unavailable or partial monetary week SHALL yield `null`; otherwise it SHALL yield `false`. `is_partial` SHALL independently communicate whether the calendar week can still accumulate facts.

#### Scenario: Average per week uses all selected buckets
- **WHEN** known selected spend is $80 for an `8w` request whose current week is partial
- **THEN** average per week is $10.00 and no elapsed-day weighting is applied
#### Scenario: Cost per meal counts each qualifying cooking event once
- **WHEN** the selected cooking log has one recipe breakfast, one ad-hoc dinner, one recipe project, one recipe row with null meal, and one ready-to-eat row
- **THEN** `meal_count` is four, regardless of servings or meal labels, and the ready-to-eat row is excluded
#### Scenario: D17 exclusions apply only to cost per meal
- **WHEN** selected priced spend is $20 produce, $8 beverages, and $12 household with two qualifying cooking rows
- **THEN** total spend is $40, `known_numerator` is $20, and cost per meal is $10.00
#### Scenario: An excluded-only numerator is exact zero
- **WHEN** every selected spend event is fully priced, exactly classified as Household or Beverages, and there is at least one qualifying meal
- **THEN** cost numerator status is `complete`, `known_numerator` is zero, and cost per meal is $0.00
#### Scenario: A pending department prevents a fabricated cost numerator
- **WHEN** a selected priced row has a null department and no priced eligible row establishes a known numerator
- **THEN** cost per meal is unavailable with reason `numerator_unavailable`, even when qualifying meals exist
#### Scenario: A known numerator can be partial
- **WHEN** at least one selected eligible row is priced and another eligible row is unpriced or estimated, or any selected row awaits department classification
- **THEN** the known eligible amount is returned, cost numerator status is `partial`, and cost per meal is labelled partial rather than exact
#### Scenario: No qualifying meals yields no ratio
- **WHEN** selected spend is known but there are no selected recipe or ad-hoc cooking rows
- **THEN** cost per meal is `null` with status `unavailable` and reason `zero_meals`, never infinity or a per-serving guess
#### Scenario: Empty spend with meals has an exact zero numerator
- **WHEN** there are qualifying selected cooking rows but no selected spend events
- **THEN** cost numerator status is `empty`, `known_numerator` is zero, and cost per meal is $0.00
#### Scenario: Trend is available against a positive complete prior range
- **WHEN** the matched prior known spend is complete at $100 and current complete known spend is $75
- **THEN** trend is available at -25.0 percent
#### Scenario: Current zero can produce a negative-one-hundred-percent trend
- **WHEN** the selected range is empty and the matched prior range is complete at a positive amount
- **THEN** trend is available at -100.0 percent
#### Scenario: Zero prior spend never produces infinity
- **WHEN** the matched prior range has exact zero spend
- **THEN** trend is unavailable with `percent: null` and reason `prior_zero`
#### Scenario: Trend reason precedence is deterministic
- **WHEN** current coverage is incomplete and prior coverage is also incomplete or zero
- **THEN** trend is unavailable with reason `current_incomplete`; otherwise a prior incomplete side precedes `prior_zero`
#### Scenario: A positive budget distinguishes known overage from uncertainty
- **WHEN** a partial current week has a $95 budget and $100 of known spend
- **THEN** `over_budget` is true even though the week or price coverage remains partial
#### Scenario: A partial week below budget is not declared under budget
- **WHEN** monetary coverage is partial or unavailable, its known subtotal does not exceed a positive budget, and the week may have missing value
- **THEN** `over_budget` is null rather than false
#### Scenario: Missing and zero budgets hide the budget comparison
- **WHEN** the stored weekly budget is null, zero, or negative
- **THEN** analyzer `weekly_budget` and every `over_budget` value are null
#### Scenario: Arithmetic rounds once per stored amount
- **WHEN** stored decimal amounts require fractional-cent conversion or a percentage has additional decimal places
- **THEN** each amount is rounded once to cents before summation, output currency is cents-rounded, and output percentages are rounded to one decimal
### Requirement: Spend breakdowns and top drivers use captured facts and deterministic ordering
Department, store, and provenance breakdowns SHALL group only their immutable captured values and SHALL never reclassify history. A null department SHALL be omitted from department items and retained in department coverage; store SHALL use its raw captured key without a registry lookup; provenance keys SHALL be exactly `planned` and `impulse`. Presentation labels SHALL split an ASCII key on runs of `_` or `-`, lowercase each word, capitalize its first character, and join words with spaces; provenance SHALL display `Planned` and `Impulse`. Labels SHALL NOT alter grouping keys.

Every breakdown group with at least one event SHALL appear even if all of its amounts are unknown. Each item SHALL expose raw `key`, deterministic `label`, known `amount`, total `event_count`, `priced_event_count`, `unpriced_event_count`, and `percentage`. Department `known_denominator` SHALL be known priced amount having a non-null department; store and provenance denominators SHALL be total known priced amount. Percentage SHALL be null at a zero denominator. Items SHALL sort by amount descending and then raw key ascending. Department breakdown status SHALL equal the combined overall monetary-and-department status; store and provenance breakdown status SHALL equal monetary coverage status.

Top drivers SHALL group by captured `line_key` and SHALL include only groups having at least one priced event. `total_count` SHALL report the eligible group count before capping and `items` SHALL contain at most six. A driver SHALL expose key, representative name and department, known amount, total event count, priced and unpriced event counts, and percentage of total known spend. Event count SHALL count rows, not package quantity. The representative name and department SHALL come from the same latest row by `occurred_on` descending, then `send_id` descending; a null representative department SHALL remain null. Drivers SHALL sort by amount descending, event count descending, and line key ascending. A driver percentage SHALL be null when total known spend is zero.

#### Scenario: Department uses its captured analytics key
- **WHEN** selected events carry `produce`, `beverages`, and a null department
- **THEN** the department breakdown has Produce and Beverages items, no `Not mapped` item, and coverage counts the pending row
#### Scenario: Store and provenance use capture-time values
- **WHEN** selected events carry stored store and provenance keys
- **THEN** breakdowns group those exact keys, without consulting current store registry, placement, cart, pantry, or classification state
#### Scenario: An unpriced-only group remains visible
- **WHEN** a captured department, store, or provenance group has events but no usable amount
- **THEN** its item appears with zero known amount, its event and unpriced counts remain visible, and its percentage is null when the applicable denominator is zero
#### Scenario: Breakdown ties use raw keys
- **WHEN** two breakdown groups have the same known amount
- **THEN** they order by raw key ascending, independent of database row order or presentation label
#### Scenario: Department percentages use only classified known spend
- **WHEN** selected known spend includes a priced row whose department remains null
- **THEN** that row contributes to total spend but not the department denominator, item, or percentages
#### Scenario: A driver groups repeated line events and counts rows
- **WHEN** the same `line_key` appears in three selected spend events with arbitrary package quantities
- **THEN** one driver sums their known amounts and reports `event_count: 3`, not the sum of quantities
#### Scenario: Driver representative selection is deterministic
- **WHEN** a driver's rows have different names or departments
- **THEN** name and department come together from the row latest by date and then greatest send id, with no dependence on query order
#### Scenario: Driver ties and cap are deterministic
- **WHEN** more than six eligible drivers include equal amounts and event counts
- **THEN** all eligible groups contribute to `total_count`, the sorted first six appear, and the final tie is resolved by line key ascending
### Requirement: Spend insight selection is deterministic and truthful
The analyzer SHALL select exactly one server-authored insight using this fixed ladder, with no LLM, randomness, hash rotation, or heuristic threshold:

1. Empty overall status: `No recorded spend in this range.`
2. Monetary unavailable: `Spend is unavailable because none of the recorded purchases in this range has a usable price.`
3. Any partial overall status: `Known spend is incomplete: {clauses}.`
4. Complete status: `{Department label} was the largest department at {currency}.` followed only by available planned/impulse and trend clauses.

For a partial insight, clauses SHALL be included in this order when their counts are positive: `{n} purchase(s) had no usable price`, `{n} purchase(s) used an estimated price`, and `{n} purchase(s) is/are awaiting department classification`. Singular grammar SHALL be used at one; multiple clauses SHALL be comma-separated with `and` before the last. Currency SHALL be `$` plus cents-rounded amount with exactly two decimal places.

For complete data with positive known total, the analyzer SHALL append ` Planned purchases were {p.toFixed(1)}% of known spend; impulse purchases were {i.toFixed(1)}%.`, treating an absent provenance group as zero percent. It SHALL append a trend clause only when trend is available: ` Spend was {abs.toFixed(1)}% higher than the matched prior range.`, the corresponding `lower` sentence, or ` Spend was unchanged from the matched prior range.` at zero. Awaiting placement SHALL remain a separate notice and SHALL NOT affect insight selection.

#### Scenario: Empty data uses the empty template
- **WHEN** overall status is empty
- **THEN** insight is exactly `No recorded spend in this range.`
#### Scenario: Fully unpriced data uses the unavailable template
- **WHEN** monetary status is unavailable
- **THEN** insight is exactly `Spend is unavailable because none of the recorded purchases in this range has a usable price.`
#### Scenario: Partial clauses have fixed order and grammar
- **WHEN** partial data has one unpriced purchase, two estimated purchases, and one pending department
- **THEN** insight is exactly `Known spend is incomplete: 1 purchase had no usable price, 2 purchases used an estimated price, and 1 purchase is awaiting department classification.`
#### Scenario: Complete insight starts with the deterministic top department
- **WHEN** complete data has two departments tied for largest known amount
- **THEN** insight uses the first department under amount-descending then raw-key-ascending breakdown order and formats its amount with exactly two decimal places
#### Scenario: Optional complete clauses require available inputs
- **WHEN** complete known spend is positive and trend is available
- **THEN** insight appends planned and impulse percentages followed by the exact higher, lower, or unchanged trend sentence
#### Scenario: Unavailable trend is omitted rather than guessed
- **WHEN** data is otherwise complete but trend is unavailable
- **THEN** the complete insight omits any trend sentence
#### Scenario: Awaiting placement remains separate from analyzed spend
- **WHEN** current grocery rows await mark-placed
- **THEN** `awaiting_mark_placed` reports their count, the rows do not enter spend facts, and the insight ladder does not change because of that count
### Requirement: Spend analysis is a read-time projection of existing immutable facts
The analyzer SHALL read existing non-voided `spend_events`, qualifying `cooking_log` rows, profile `weekly_budget`, and current awaiting-placement rows through `db(env)` and SHALL perform no insert, update, delete, mutation helper, cache fill, queue action, cron invocation, or other side effect. It SHALL add no analyzer table, materialized rollup, schema migration, index, binding, scheduled aggregation, or cron job. Existing tenant/date indexes SHALL serve bounded reads. The existing ingredient-category job SHALL remain the only eventual fill for null capture-stamped departments; the analyzer SHALL neither invoke it nor wait for it.

Late or backdated facts SHALL appear on the next read when their authoritative date is inside the bounded window. Existing event identity SHALL continue to suppress duplicate materialization, and existing void facts SHALL remove corrected events without analyzer mutation. Independent queries SHALL observe committed state before or after concurrent writers without promising a cross-table snapshot; a later refresh SHALL converge on the committed facts. Existing nullable rows and databases already migrated through the current schema SHALL remain valid inputs.

The analyzer SHALL NOT introduce or redesign cart ownership or recovery, grocery or pantry ownership tokens, generic compare-and-swap, re-key convergence, order settlement or compensation, operation registries or generated concurrency oracles, satellite receipt atomicity, generic error handling, capture, correction, transaction ownership, or classification heuristics.

#### Scenario: A late fact appears on the next bounded read
- **WHEN** a backdated spend event commits with `occurred_on` inside the selected window after an earlier analyzer response
- **THEN** a refreshed response includes it in the authoritative bucket and aggregate without a backfill or historical mutation
#### Scenario: Existing identity suppresses a duplicate replay
- **WHEN** an existing purchase assertion or shop-completion request replays for the same event identity
- **THEN** the analyzer sees the one materialized event produced by existing idempotency and adds no separate duplicate guard or registry
#### Scenario: A correction uses the existing void fact
- **WHEN** an event counted by an earlier read is subsequently voided through the existing correction path
- **THEN** a refreshed analyzer omits it without deleting or rewriting historical telemetry
#### Scenario: Concurrent commits are observed without a synthetic snapshot protocol
- **WHEN** independent spend, cooking, profile, or grocery writes commit while analysis queries run
- **THEN** the response reflects committed facts visible to each read before or after those commits, performs no coordination write, and a refresh converges
#### Scenario: Pending classification converges only through the existing job
- **WHEN** a selected spend event initially has a null department and the ingredient-category job later fills it
- **THEN** a subsequent analyzer read reflects the stored department while the analyzer itself schedules, classifies, and writes nothing
#### Scenario: Previously migrated rows remain readable
- **WHEN** the analyzer runs against a database migrated before this code change with nullable historical Spend fields
- **THEN** it computes the documented coverage from existing columns without requiring a new migration, index, backfill, synthetic state, or fallback value
#### Scenario: Repeated reads are side-effect free
- **WHEN** the same authenticated analyzer request is repeated with unchanged committed facts and clock
- **THEN** it returns the same ordered aggregate and leaves database, cache, queue, and scheduled state unchanged
### Requirement: Spend analyzer contracts and tests use production entry points
The operation, MCP schema and result, member API contract, member UI, `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, `packages/worker/AGENT_INSTRUCTIONS.md`, and living OpenSpec specifications SHALL describe the same range, UTC boundary, aggregate fields, coverage, denominator, classification, ordering, insight, authorization, compatibility, and read-only behavior. Architecture documentation SHALL explicitly state that Spend aggregation occurs at read time and adds no analyzer cron.

Focused tests SHALL invoke the production `readSpendAnalyzer` operation against current SQLite migrations, the registered production MCP `retrospective` tool, and the composed session-gated member API. They SHALL NOT introduce a parallel analyzer model that primarily validates itself. Fresh-schema and previously migrated-schema coverage SHALL use the same existing columns and indexes and SHALL confirm that no Spend analyzer migration is required.

#### Scenario: Operation coverage enters through the production reader
- **WHEN** tests exercise ranges, boundaries, coverage, KPIs, classifications, ties, rounding, late facts, duplicates, void corrections, and refresh after concurrent commits
- **THEN** they call the production analyzer against migrated SQLite facts rather than duplicating its reduction in a test-only implementation
#### Scenario: Tool coverage enters through the registered MCP surface
- **WHEN** tests verify omitted and explicit `spend_range` behavior
- **THEN** they invoke the registered `retrospective` tool and compare its `.spend` value with the shared aggregate contract
#### Scenario: Contract documentation stays aligned
- **WHEN** the analyzer ships
- **THEN** tool, schema, architecture, persona, API, UI, and living-spec documentation all state the same additive shape and read-only guarantees, and generated-plugin validation remains clean

### Requirement: Review impulse lines use the shared D16 send operation

A bare item added during Order Review SHALL be classified `impulse` only when final send successfully materializes and advances it through the same shared D16 send operation as planned lines. Its send snapshot SHALL carry current resolved pick, package quantity, quote/savings, store, fulfillment, department and `provenance:impulse`; later purchase assertion SHALL materialize that immutable snapshot through the one shared writer. Preview, broader/manual search, staged selection, skip, unavailability, revalidation failure, cart failure with successful compensation, and UI confirmation SHALL emit no spend event and SHALL NOT write a standalone telemetry record.

#### Scenario: Sent impulse materializes only at purchase assertion
- **WHEN** a review-added extra reaches the Kroger cart and is later included in Mark order placed
- **THEN** its send line already carries impulse provenance and one spend event is materialized verbatim at the assertion

#### Scenario: Previewed or left-off impulse emits nothing
- **WHEN** an impulse is previewed but skipped, unresolved, or rejected by final revalidation
- **THEN** no send line or spend event exists for it

### Requirement: Order Review totals use the D16 quote source

The review preview MAY show a transient estimate produced by the same pure send-line quote builder, labeled as a current preview. After send, Order Review and Grocery SHALL derive item count, estimated total, and flyer savings from the persisted `order_send_lines` for that send id, which is the same source later copied into spend events. A missing send snapshot SHALL render those values unavailable; no surface SHALL substitute client arithmetic or stale preview totals.

#### Scenario: Confirmation and later spend share one quote
- **WHEN** a send records a promo-priced line and is later marked placed
- **THEN** Order Review confirmation totals that persisted line and the spend event copies the same quote verbatim

#### Scenario: Missing snapshot stays visibly unknown
- **WHEN** telemetry recording degrades but the Kroger cart write succeeds
- **THEN** confirmation reports the cart success and snapshot error while omitting persisted total/savings

### Requirement: Walk and manual-shop spend materializes from the completion receipt

The one shared `src/spend.ts` write boundary SHALL materialize spend for every shop-commit receipt line at completion; neither `/api`, MCP tools, member UI, nor skills SHALL write spend directly. For each grocery-domain line the deterministic estimate ladder SHALL use, in order, the most recent matching SKU-cache store price, the current matching warmed flyer, the household's most recent non-voided paid unit price for the canonical key, then NULL-unpriced. It SHALL make no external request. A loose quantity SHALL use an unambiguous leading positive count or one with `quantity_assumed=true`.

Every `store_walk`/`manual_shop` event SHALL carry `estimated=1`, even when a cached price exists, plus price source, resolved store/fulfillment, capture-time department, provenance, unit price/amount/savings when known, and a deterministic tenant/session/line identity. An unpriced line SHALL still produce an estimated event with NULL price/amount. The immutable shop receipt SHALL be the replay source and SHALL never be re-priced.

#### Scenario: Estimation follows the exact ladder
- **WHEN** SKU cache misses, a current flyer price exists, and last-paid also exists for a committed line
- **THEN** the event/receipt use the flyer value, mark it estimated with `price_source:'flyer'`, and perform no live lookup

#### Scenario: Last-paid fills after store sources miss
- **WHEN** neither store SKU cache nor warmed flyer can price a line but the household has a non-voided prior paid unit price
- **THEN** shop completion copies that unit price with `price_source:'last_paid'` and `estimated=1`

#### Scenario: Unpriced purchase remains observable
- **WHEN** every fallback misses
- **THEN** one estimated spend event and receipt line remain with NULL unit price/amount rather than a fabricated total

#### Scenario: Replay does not re-price or duplicate
- **WHEN** a completed shop request replays after caches or last-paid history change
- **THEN** it returns the original stored pricing and exactly one spend event exists for that session/line

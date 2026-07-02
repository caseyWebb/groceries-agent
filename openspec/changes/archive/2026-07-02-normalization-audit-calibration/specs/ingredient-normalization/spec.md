## ADDED Requirements

### Requirement: Specialization ids are bounded to a single detail segment

Resolution construction (the capture job and the alias re-audit, which share the same builder) SHALL NOT concatenate a specialization id onto a match that already carries a detail segment. When the classifier returns SPECIALIZATION and the chosen match id contains `::`, the decision SHALL be demoted to SAME with the match — the alias points at the match, no node is minted, and no deeper id is constructed — with the demotion recorded in the decision's log detail (the proposed detail and a demotion marker). A canonical id deeper than `base::detail` SHALL never be constructible by any deterministic path (the novel-mint path is already bounded by canonical-id validation).

#### Scenario: A re-specialization of an already-detailed match is demoted to SAME

- **WHEN** the confirm for `'atlantic sockeye salmon fillets'` returns SPECIALIZATION with match `salmon fillets, skin-on::species-atlantic-sockeye` and detail `species-atlantic-sockeye`
- **THEN** the resolution is SAME with `salmon fillets, skin-on::species-atlantic-sockeye` — no `salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye` id is constructed — and the log detail records the demotion with the proposed detail

#### Scenario: The guard applies at capture and at the alias re-audit alike

- **WHEN** either the capture job or the alias re-audit pass receives a SPECIALIZATION pick whose match id already contains `::`
- **THEN** both apply the same demotion (they construct resolutions through the same builder), and the alias re-audit counts the result as a kept mapping when the match resolves to the standing survivor

#### Scenario: A specialization of a bare base is unaffected

- **WHEN** the confirm returns SPECIALIZATION with a detail-less match (e.g. match `ground beef`, detail `fat-80-20`)
- **THEN** the id `ground beef::fat-80-20` is constructed exactly as before the guard existed

### Requirement: Segment-overflow repair reconcile

The capture job SHALL run a deterministic per-tick sub-pass (no model calls) that repairs any surviving `source='auto'` identity node whose id contains more than one detail segment (three or more `::`-separated segments) onto its two-segment prefix. When the prefix node exists and resolves to a different survivor, the overflow node SHALL merge into the prefix via the representative pointer. When the prefix node exists but currently resolves TO the overflow node (the overflow is its family's root), the pass SHALL re-root the family — clear the prefix's representative and point the overflow's representative at the prefix — in one atomic batch. When no prefix node exists, the pass SHALL mint the prefix (base and detail derived from the id, search term flattened, embedding NULL for the backfill) and point the overflow at it. Every repair SHALL be logged. `source='human'` overflow nodes SHALL never be modified. The pass SHALL be idempotent and self-quiescing: once no surviving auto node exceeds two segments it plans nothing.

#### Scenario: The live production overflow node is re-rooted under its prefix

- **WHEN** the pass finds surviving node `salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye` whose 2-segment prefix `salmon fillets, skin-on::species-atlantic-sockeye` exists with its representative pointing at the overflow node
- **THEN** the prefix's representative is cleared, the overflow's representative is set to the prefix, the repair is logged, and every alias or key that pointed at the overflow now resolves to the prefix through the chain

#### Scenario: An overflow whose prefix survives elsewhere merges normally

- **WHEN** an overflow node's 2-segment prefix exists and resolves to a survivor other than the overflow node
- **THEN** the overflow merges into the prefix via the representative pointer (the existing merge primitive, cycle-guard intact)

#### Scenario: A missing prefix is minted before the repair

- **WHEN** an overflow node's 2-segment prefix does not exist in the registry
- **THEN** the prefix node is minted (embedding NULL, embedded later by the backfill) and the overflow's representative is pointed at it, in the same batch

#### Scenario: The pass quiesces and never touches human nodes

- **WHEN** the pass runs over a registry with no surviving auto node deeper than two segments, or encounters a `source='human'` overflow node
- **THEN** it plans no writes for the converged registry and skips the human node (counted, unmodified)

### Requirement: Structural edge guarantee

The edge re-audit job SHALL run a deterministic per-tick pre-pass (no model calls) that (a) deletes any `source='auto'` edge whose endpoints resolve to the same survivor through the representative pointer — regardless of audit stamp — logging each deletion, and (b) ensures every surviving two-segment identity node `X::detail` has an edge of some kind from `X::detail` to its exact base `X`: when none exists, a `general` edge SHALL be inserted born-stamped (never re-entering the audit backlog), minting the base node `X` (embedding NULL, for the backfill) when it is absent, and logging each insertion. The pre-pass SHALL run every tick including when the audit backlog is empty, SHALL be write-capped per tick, and SHALL be idempotent — a converged registry plans nothing.

#### Scenario: The wrongly-dropped structural class is restored deterministically

- **WHEN** the pre-pass runs while surviving nodes `rotel (original)::heat-mild`, `snacking pickles::form-chips`, and `serrano or jalapeño peppers::form-diced` have no edge to their bases (the audit dropped them as "distinct products")
- **THEN** a `general` edge from each node to its exact base is inserted born-stamped with no model call, and each insertion is logged

#### Scenario: A missing base node is minted for the guarantee

- **WHEN** a surviving node `X::detail` has no edge to `X` and no node `X` exists
- **THEN** the base node `X` is minted (embedding NULL, embedded later by the backfill) and the structural edge is inserted in the same pass

#### Scenario: A stamped self-loop left behind by a repair is swept

- **WHEN** the segment-overflow repair points the overflow node at its prefix, turning the overflow's born-stamped structural edge into a representative-resolved self-loop
- **THEN** the pre-pass deletes that edge even though it carries an audit stamp, and logs the deletion

#### Scenario: A converged registry is a no-op

- **WHEN** the pre-pass runs and every surviving two-segment node already has its base edge and no auto edge self-loops
- **THEN** it plans no writes and spends no model calls

### Requirement: One-shot replay of edge-drop decisions

The edge re-audit job SHALL re-evaluate every pre-existing `edge_drop` decision in the normalization log exactly once under the recalibrated direction check, bounded per tick and oldest-first, and SHALL mark each processed row in its log detail (a replay timestamp plus the outcome) so the pass drains its backlog and quiesces to a no-op. The edge SHALL be parsed from the row's `from -[kind]-> to` term with a strict pattern; an unparseable row SHALL be marked and skipped with no model call. Rows dropped deterministically (self-loop, human-reverse), rows whose edge is structural with a surviving from-node (the guarantee restores those), and rows whose from-endpoint is missing or merged away SHALL be marked with no model call. Every other row SHALL get one recalibrated direction check over the resolved endpoints: when the FROM→TO direction holds and no resolved reverse edge exists, the edge SHALL be re-inserted with its original endpoints, born-stamped, and the restoration SHALL be logged as a distinct outcome referencing the replayed row; when the direction does not hold, the row is marked with the verdict and nothing is inserted. When a resolved reverse edge EXISTS, the replay SHALL NOT withhold — it SHALL re-decide the pair with that same single direction check under the 2-cycle semantics: a forward-only verdict restores the dropped edge AND deletes the standing reverse (logged, born-marked, referencing the replayed row) even when the reverse carries an earlier keep stamp; a mutual verdict restores the dropped edge and keeps the reverse; a reverse-only verdict marks the row and leaves the reverse; a neither verdict marks the row and deletes the reverse. A `source='human'` standing reverse SHALL win deterministically (no model call, no restore), and a structural standing reverse SHALL never be deleted and SHALL block the restore (no model call). A transient failure SHALL leave the row unmarked for a later tick; a contract-invalid check SHALL mark the row without restoring. Edge-drop rows written after this change SHALL be born-marked, and edge decision log rows SHALL carry structured from/to/kind detail fields going forward.

#### Scenario: A wrongly-dropped containment edge is restored by the recalibrated check

- **WHEN** the replay processes the drop row for `honey raisins -[containment]-> raisins` and the recalibrated direction check answers that FROM satisfies TO
- **THEN** the edge is re-inserted born-stamped with its original endpoints, a restoration log row referencing the replayed row is appended, and the source row is marked replayed

#### Scenario: A both-deleted 2-cycle is restored in the true direction only

- **WHEN** the replay processes the two cardamom drop rows (`whole cardamom pods -[containment]-> ground cardamom` and `ground cardamom -[general]-> whole cardamom pods`)
- **THEN** the whole→ground edge is restored and the ground→whole row is marked with a not-holding verdict and stays deleted

#### Scenario: A replayed drop with a standing reverse is re-decided as a pair

- **WHEN** the replay processes the drop row for `whole frozen chicken -[containment]-> chicken tenderloin` while the wrongly-kept reverse `chicken tenderloin -[general]-> whole frozen chicken` stands (auto, non-structural), and the recalibrated direction check answers forward-only
- **THEN** the dropped edge is restored born-stamped, the standing reverse is deleted despite its earlier keep stamp (logged with the pair marker and the replayed row's id), the row is marked, one model call was spent, and no 2-cycle exists afterward

#### Scenario: Human and structural standing reverses are immune in a pair re-decision

- **WHEN** the replay finds the standing reverse of a drop row is `source='human'`, or is a structural edge with a surviving from-node
- **THEN** no model call is spent, the reverse is untouched, the restore does not happen, and the row is marked with the deterministic reason

#### Scenario: Deterministic and dead rows are marked without model calls

- **WHEN** the replay encounters a drop row noted self-loop or human-reverse, a structural row whose from-node survives, a row whose from-node was merged away (e.g. `fish sauce::type-sea-salt -[general]-> fish sauce`), or a row whose term does not parse
- **THEN** each is marked replayed with its reason and no classifier call is spent

#### Scenario: The replay is one-shot and self-quiescing

- **WHEN** every pre-existing drop row carries the replay mark and new drop rows are born-marked
- **THEN** the pass selects nothing and spends no model calls, and a partially-completed tick resumes exactly where it stopped (unmarked rows only)

## MODIFIED Requirements

### Requirement: Canonical nodes and the full-id join

The system SHALL model ingredient identity as a graph of canonical **nodes** named `base` or `base::detail` (e.g. `ground-beef`, `ground-beef::fat-80-20`, `cheese::cheddar`, `chicken::thighs`), where the string is a readable label. A canonical id SHALL contain at most one detail segment: no deterministic path (novel canonical validation, specialization construction, or any reconcile) constructs an id deeper than `base::detail`, and a deeper id observed in the registry is a defect the segment-overflow repair converges. The **deterministic join key** for `sku_cache`, `brand_prefs`, grocery-list dedup, and cross-recipe overlap SHALL be the **full canonical id**, after synonym-merge through the `representative` pointer. Deterministic code SHALL NOT use base equality (the id prefix up to the first `::`) as a blanket join, because same-base nodes may be non-interchangeable varieties. The **base** SHALL serve only as a readable grouping, the matcher's search-term fallback, and the "-any" anchor (an unqualified request resolves to the bare base node). A detail token's value SHALL NOT be parsed or interpreted by deterministic code — details are opaque labels; fit judgment is deferred to read-time reasoning over the visible labels and edges.

#### Scenario: Full id is the join; synonyms merge, varieties do not

- **WHEN** `"scallions"` and `"green onions"` both resolve (via `representative`) to `green-onion`, while `"cheddar"` resolves to `cheese::cheddar` and `"mozzarella"` to `cheese::mozzarella`
- **THEN** the two onion forms share one join key (one SKU-cache/brand-pref/overlap entry), while the two cheeses remain distinct join keys and are NOT treated as the same ingredient despite sharing base `cheese`

#### Scenario: Unqualified request resolves to the bare base

- **WHEN** a recipe ingredient is just `"ground beef"` (no product detail)
- **THEN** it resolves to the bare base node `ground-beef` (the "-any" anchor), which the matcher searches as "ground beef" and buys cheapest-acceptable

#### Scenario: Detail values are opaque to deterministic code

- **WHEN** deterministic code compares `ground-beef::fat-80-20` and `ground-beef::fat-90-10`
- **THEN** it reports them as distinct ids without interpreting `80-20` vs `90-10`; whether one satisfies a request for the other is a read-time judgment over the visible labels and any captured edge

### Requirement: Conservative collapse and prep-versus-product stripping

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm — or the deterministic lexical-identity fast path below — SHALL create an alias-to-existing id. As the one deterministic exception, a term whose punctuation-insensitive lexical form (lowercased, punctuation collapsed to spaces, whitespace normalized) exactly equals that of a surviving node id or a known alias variant SHALL resolve as SAME to that survivor with no model call — a mechanical identity, not a similarity collapse; when two distinct survivors share the lexical form, the fast path SHALL be skipped and the normal confirm flow applies. The fast path SHALL apply at capture and at the alias re-audit alike. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it changes *which product a shopper would buy* (fat ratio, flour type, egg size, cut); a **preparation** qualifier that does not change the SKU ("diced", "minced", "shredded", "softened") SHALL strip to the base. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`). A **distinct product** SHALL NOT be recorded as a SPECIALIZATION of a superficially-similar candidate — a specialization's detail narrows the SAME product, it never attaches a different product to a lookalike base (dried dates are not a variety of a dried-fruit blend; canned salmon is not a form of fresh skin-on fillets; a loaf of bread is not a type of bread flour; a finishing salt is not a kind of fish sauce) — the confirm prompt SHALL state this rule with counter-examples. The confirm prompt SHALL also state that a term differing from a candidate only in punctuation, pluralization, or word order is the SAME product.

#### Scenario: High similarity does not force a collapse

- **WHEN** `"baking powder"` is queued and cosines very near `baking-soda`
- **THEN** the confirm returns NOVEL (distinct base) and no alias between them is written

#### Scenario: Preparation qualifier strips to base

- **WHEN** `"diced yellow onion"` is queued
- **THEN** it resolves to base `yellow-onion` (the dice is a preparation, not a product qualifier) rather than minting `yellow-onion::diced`

#### Scenario: Doubt defaults to preserving the distinction

- **WHEN** the classifier is uncertain whether a qualified term is an alias of or a specialization of a candidate
- **THEN** it specializes (preserving the qualifier) rather than collapsing, so no distinction is destroyed

#### Scenario: A distinct product is not a lookalike's specialization

- **WHEN** `"dried medjool dates"` is queued and its nearest candidate is `dried fruit blend`
- **THEN** the confirm returns NOVEL (a distinct product), not a SPECIALIZATION like `dried fruit blend::type-medjool-dates`

#### Scenario: A punctuation-only variant resolves deterministically

- **WHEN** `"salmon fillets skin-on"` is queued (or re-audited) while the node `salmon fillets, skin-on` survives, and no other survivor shares its lexical form
- **THEN** it resolves SAME to `salmon fillets, skin-on` with no embedding comparison and no classifier call, and the fast-path resolution is logged

### Requirement: Stable ids with union-find merges

The system SHALL treat canonical ids as **append-only, stable join keys** — an id, once minted, SHALL NOT be renamed, because `sku_cache`, `brand_prefs`, `ingredients_key`/`perishable_ingredients`, and `grocery_list` key on it. When the capture job later discovers that two already-minted ids are the same identity (a synonym that surfaced after both bases were independently minted), it SHALL merge them by setting a **`representative` pointer** from one id to the other rather than rewriting any dependent row. Resolution SHALL follow the representative chain transitively to the surviving id. Dependent tables SHALL NOT be key-rewritten on a merge. A merge MAY be proposed by a signal **other than embedding similarity** — in particular, two distinct ids that repeatedly resolve to the **same Kroger SKU** in `sku_cache` are candidate synonyms — so cross-lexical synonyms that embeddings do not retrieve (e.g. `zucchini`/`courgette`) can still be collapsed, subject to the same conservative confirm. A co-resolution pair the confirm REJECTS SHALL be remembered in shared D1 state that survives restarts — keyed by the pair's surviving ids in canonical order, with the decision time — and SHALL NOT be re-proposed to the confirm while the rejection is fresh (a long backoff); a post-backoff re-proposal that is rejected again SHALL refresh the memory. A pair whose surviving ids change through later merges SHALL be eligible again immediately (the memory keys on survivors, so a materially-changed graph re-opens the question). Suppressed pairs SHALL be counted in the job summary; a transient confirm failure SHALL NOT record a rejection.

#### Scenario: Late-discovered synonym merges without key rewrites

- **WHEN** `scallion` and `green-onion` were minted as separate bases and the job later confirms they are the same
- **THEN** one id's `representative` is set to the other and all reads resolve transitively to the survivor, with no update to `sku_cache`/`brand_prefs`/`grocery_list` rows

#### Scenario: Minted ids are never renamed

- **WHEN** a better-structured id would be preferable for an existing base
- **THEN** the existing id is retained and new aliases point at it, rather than renaming the id and orphaning dependent rows

#### Scenario: Same-SKU co-resolution proposes a cross-lexical merge

- **WHEN** two distinct ids (e.g. `zucchini` and `courgette`, which embeddings do not retrieve as neighbors) repeatedly resolve to the same Kroger SKU in `sku_cache`
- **THEN** a merge is proposed from that signal and, on a conservative confirm, one id's `representative` is set to the other — collapsing a synonym the embedder missed

#### Scenario: A rejected pair is remembered, not re-asked every tick

- **WHEN** the confirm rejects the pair `pecorino romano`/`parmesan` (a shared SKU, distinct products)
- **THEN** the rejection is recorded with its decision time, later ticks suppress the pair without a classifier call (counted in the summary), the pair is re-confirmed once after the backoff elapses, and a merge of either id's family (changing a survivor) makes the pair eligible again immediately

### Requirement: Rolling re-audit of pre-hardening alias decisions

The system SHALL run a scheduled alias re-audit pass over `source='auto'` alias mappings that carry no audit stamp, bounded per tick and oldest-decided first, that converges pre-hardening decisions to the hardened rules with no operator action. A **self-alias** (the variant string equals the row's node id — the alias every mint writes for its own node) SHALL be stamped audited deterministically, with no embedding and no model call. **Every other** eligible mapping SHALL be re-decided by the hardened classifier confirm — candidates retrieved from the current registry by cosine over the variant's embedding, always including the currently-mapped (representative-resolved) node — with the confirm-distance guard applied to the pick exactly as at capture (a distant pick rejects to a verbatim NOVEL mint). The re-decision SHALL be applied via existing primitives only: re-pointing the alias (auto source, fresh `decided_at`), minting a node (canonical-id synthesis applies), or a `representative` merge — never deleting a node and never touching a `source='human'` row. A re-decision that RESOLVES to the standing mapping's survivor — a SAME on the survivor, a SPECIALIZATION demoted by the segment guard onto it, or a NOVEL whose proposed canonical id (raw or validated — an existing id may legitimately fail mint validation, e.g. contain a comma) resolves to it — SHALL be applied as a keep (the mapping re-committed and stamped); in particular a NOVEL canonical equal to the standing id SHALL never fall through to a verbatim mint of the variant (a duplicate node that only re-derives the standing mapping). When an applied re-point strands a `source='auto'` node with no remaining aliases, the pass SHALL merge that node into the re-decision's resolved node so it leaves the retrieval set. Every classifier re-decision SHALL be appended to the normalization log with an audit marker and the previous mapping in its detail. A contract-invalid confirm SHALL keep the existing mapping and stamp it (never destroy on an undecidable); a transient failure SHALL leave the row un-stamped for a later tick. Alias rows written by capture, re-confirm, and the re-audit itself SHALL be born already-stamped, so the pass drains its backlog and quiesces to a no-op.

#### Scenario: A self-alias is stamped with no model call

- **WHEN** the pass selects an auto alias whose variant equals its node id (e.g. `olive oil` → `olive oil`)
- **THEN** the row is stamped audited with no embedding and no classifier call, and no log row is written

#### Scenario: A high-cosine distinct-product alias is re-pointed by the classifier

- **WHEN** the pass re-decides `'sesame seeds'` → `toasted sesame seeds::toast` (a mapping whose variant↔node cosine sits ABOVE the confirm minimum) and the hardened confirm returns NOVEL with canonical `sesame seeds`
- **THEN** a `sesame seeds` node is minted, the alias is re-pointed to it with a fresh auto `decided_at`, the row is stamped, and the log records the correction with the audit marker and the previous mapping

#### Scenario: A guard-rejected pick falls back to a verbatim novel mint

- **WHEN** the confirm for `'flaky sea salt'` picks a candidate whose cosine to the variant is below the confirm minimum
- **THEN** the pick is rejected, the variant is minted as a verbatim NOVEL node, the alias is re-pointed to it, and the guard rejection is recorded in the log detail

#### Scenario: A confirmed mapping is kept and stamped

- **WHEN** the confirm returns SAME against the currently-mapped node's survivor
- **THEN** the mapping stands (re-committed with a fresh `decided_at`), the row is stamped, and the decision is logged with the audit marker

#### Scenario: A re-decision that only re-derives the standing mapping is a keep

- **WHEN** the confirm for `'atlantic sockeye salmon fillets'` (standing survivor `salmon fillets, skin-on::species-atlantic-sockeye`) returns SPECIALIZATION on that survivor with a duplicate detail, or NOVEL with a canonical equal to it
- **THEN** the standing mapping is kept and stamped — no deeper id is constructed, no verbatim variant node is minted — and the keep is logged with the audit marker

#### Scenario: A stranded wrong-mint node is merged away

- **WHEN** a re-point moves the last alias off a `source='auto'` node (e.g. `fish sauce::type-sea-salt` after `'flaky sea salt'` is re-pointed)
- **THEN** that node's `representative` is set to the re-decision's resolved node — it exits cosine retrieval and stray references resolve through the chain — and the merge is logged; a human node, or a node retaining other aliases, is never merged this way

#### Scenario: Human aliases are immune

- **WHEN** the pass scans for eligible rows
- **THEN** a `source='human'` alias is never selected, re-decided, or stamped by the audit

#### Scenario: Failures never destroy a standing mapping

- **WHEN** the confirm for an eligible row is contract-invalid after the retry budget
- **THEN** the existing mapping is kept and the row is stamped (logged as a fail-safe keep); and **WHEN** the failure is transient (`env.AI`/D1) **THEN** the row is skipped un-stamped and retried on a later tick with nothing written

#### Scenario: Born-audited writes make the pass self-quiescing

- **WHEN** capture, re-confirm, or the re-audit itself writes an alias row after this change
- **THEN** the row carries the audit stamp at write time, and once the pre-hardening backlog is drained the pass selects nothing and spends no model calls

### Requirement: Rolling re-audit of auto satisfies edges

The system SHALL run a scheduled edge re-audit pass over `source='auto'` edges that carry no audit stamp, bounded per tick, correcting the pre-hardening edge backlog. An edge whose endpoints resolve to the same node through the `representative` pointer SHALL be deleted deterministically, with no model call. A **structural edge** — one whose `from_id` is exactly its `to_id` plus a single detail segment (`X::detail → X`) and whose `from_id` is itself a surviving node — SHALL be kept and stamped deterministically, with no model call, and SHALL never be deleted by the pass, including as the reverse side of a 2-cycle resolution. An edge whose resolved reverse pair exists (any kind) SHALL be resolved: against a `source='human'` reverse edge the auto edge is deleted deterministically (human authority); otherwise one classifier direction-check SHALL decide — the edge(s) matching the answered direction are kept and stamped, the rest deleted, with mutual satisfaction keeping both and "neither" deleting both (structural edges excepted as above). A standing edge SHALL be validated by the same direction check and deleted when the FROM→TO direction does not hold. The direction check SHALL define satisfies as "having FROM acceptably fulfills a request for TO" — NOT "FROM is the identical product": a member fulfills a request for a category concept it belongs to, and a more complete form fulfills a request for its derived form; the distinct-products refusal applies to same-level specific products only. `source='human'` edges SHALL never be selected or deleted. Every deletion SHALL be logged (an edge-audit outcome with the direction verdict in its detail, structured from/to/kind fields, and the replay-exempt mark); a contract-invalid check SHALL keep the edge and stamp it; a transient failure SHALL leave the edge un-stamped for a later tick. Edges written by capture, re-confirm, the structural guarantee, and the replay SHALL be born already-stamped, so the pass drains its backlog and quiesces to a no-op.

#### Scenario: A representative-resolved self-loop is deleted with no model call

- **WHEN** an auto edge's endpoints resolve to the same surviving node
- **THEN** the edge is deleted outright, the deletion is logged, and no classifier call is spent

#### Scenario: A structural edge is exempt from the model and from deletion

- **WHEN** the pass audits `rotel (original)::heat-mild -[general]→ rotel (original)` (or `snacking pickles::form-chips -[general]→ snacking pickles`) while the from-node survives
- **THEN** the edge is kept and stamped deterministically with no direction check, and no verdict — including a 2-cycle resolution on its pair — can delete it

#### Scenario: A structural-shaped edge from a merged-away node is not exempt

- **WHEN** the pass audits an edge shaped `X::detail → X` whose from-node has been merged away (its representative is set)
- **THEN** the exemption does not apply and the edge is handled by the resolved-endpoint rules (self-loop deletion or the normal direction check)

#### Scenario: A 2-cycle is resolved by one direction check

- **WHEN** the pass audits `whole cardamom pods -[containment]→ ground cardamom` while `ground cardamom -[general]→ whole cardamom pods` also exists (both auto) and the direction check answers that only whole-satisfies-ground holds
- **THEN** the containment edge is kept and stamped, the reverse edge is deleted, and one classifier call was spent on the pair

#### Scenario: A human reverse edge wins deterministically

- **WHEN** an auto edge's resolved reverse pair exists as a `source='human'` edge
- **THEN** the auto edge is deleted with no model call and the human edge is untouched

#### Scenario: A wrong-satisfies standing edge is dropped

- **WHEN** the direction check for `spaghetti -[general]→ rigatoni` (or `garlic powder -[membership]→ italian seasoning`) answers that FROM does not satisfy a request for TO
- **THEN** the edge is deleted and the drop is logged with the verdict

#### Scenario: A membership edge onto a category concept is kept

- **WHEN** the direction check evaluates `sweet maui mango habanero sauce -[membership]→ hot sauces (various)`
- **THEN** the recalibrated check answers that the member fulfills a request for the category and the edge is kept and stamped

#### Scenario: A valid standing edge is stamped

- **WHEN** the direction check confirms the FROM→TO satisfies direction holds
- **THEN** the edge is kept and stamped audited, and is never re-selected

#### Scenario: Undecidable and transient checks never delete

- **WHEN** the direction check is contract-invalid after the retry budget
- **THEN** the edge is kept and stamped (logged as a fail-safe keep); and **WHEN** the failure is transient **THEN** the edge is skipped un-stamped and retried on a later tick

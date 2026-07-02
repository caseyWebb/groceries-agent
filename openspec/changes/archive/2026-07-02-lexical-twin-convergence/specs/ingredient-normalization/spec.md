## MODIFIED Requirements

### Requirement: Conservative collapse and prep-versus-product stripping

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm — or the deterministic lexical-identity fast path below — SHALL create an alias-to-existing id. As the one deterministic exception, a term whose lexical form exactly equals that of a surviving node id or a known alias variant SHALL resolve as SAME to that survivor with no model call — a mechanical identity, not a similarity collapse; when two distinct survivors share the lexical form, the fast path SHALL be skipped and the normal confirm flow applies. The lexical form SHALL be punctuation- and plural-insensitive: lowercased, punctuation collapsed to spaces, whitespace normalized, and each letters-only token of at least 4 characters folded by a conservative plural rule (`-ies` → `-y`, `-oes` → `-o`, else one trailing `-s` stripped unless the token ends `-ss`, `-us`, or `-is`) — the same pluralization-is-the-same-product rule the confirm prompt states, applied deterministically; an irregular plural the fold misses falls through to the classifier (fragmentation at worst, never a mis-collapse). Word-order folding SHALL NOT be attempted. The fast path SHALL apply at capture and at the alias re-audit alike. Within a capture tick, a node minted mid-batch SHALL join the batch's live lexical map immediately (its id, and its surface term when the form differs) — exactly as just-minted nodes join the retrieval set in-tick — so the second twin of a same-batch pair resolves through the fast path instead of minting; an appended key that collides with an existing entry for a different survivor SHALL make that key ambiguous (the fast path SHALL NOT fire on it for the rest of the tick), and a key already ambiguous at batch start SHALL stay ambiguous regardless of appends. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it changes *which product a shopper would buy* (fat ratio, flour type, egg size, cut); a **preparation** qualifier that does not change the SKU ("diced", "minced", "shredded", "softened") SHALL strip to the base. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`). A **distinct product** SHALL NOT be recorded as a SPECIALIZATION of a superficially-similar candidate — a specialization's detail narrows the SAME product, it never attaches a different product to a lookalike base (dried dates are not a variety of a dried-fruit blend; canned salmon is not a form of fresh skin-on fillets; a loaf of bread is not a type of bread flour; a finishing salt is not a kind of fish sauce) — the confirm prompt SHALL state this rule with counter-examples. The confirm prompt SHALL also state that a term differing from a candidate only in punctuation, pluralization, or word order is the SAME product.

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

#### Scenario: A plural variant resolves deterministically

- **WHEN** `"onions"` is queued while the node `onion` survives, and no other survivor shares its lexical form
- **THEN** it resolves SAME to `onion` through the fast path with no classifier call

#### Scenario: A same-batch twin hits the fast path against a mid-batch mint

- **WHEN** `"onion"` and `"onions"` are drained in the same capture tick with neither in the registry, and `"onion"` mints first
- **THEN** `"onions"` resolves SAME to the just-minted `onion` through the in-tick lexical append and no second node is minted

#### Scenario: An in-tick lexical collision makes the key ambiguous

- **WHEN** a mid-batch mint's lexical form collides with an existing map entry for a different survivor
- **THEN** the key becomes ambiguous, later same-form terms this tick skip the fast path and take the normal confirm flow, and no deterministic alias is written on the collided key

## ADDED Requirements

### Requirement: Retroactive lexical-twin merge reconcile

The capture job SHALL include a bounded, deterministic per-tick reconcile (no model calls, running even on an empty queue) that converges surviving lexical twins: two surviving nodes whose ids share one lexical form are the same product by the same mechanical evidence the lexical fast path acts on, so the pair SHALL be merged via the representative pointer. The pass SHALL merge only pairs where both nodes are auto-sourced and both share the same concreteness (both concrete or both concept); a pair involving a human-sourced node, a pair of mixed concreteness (consistent with the concept-concrete merge guard), and a lexical form shared by three or more survivors SHALL be skipped and counted, never guessed. The survivor SHALL be the lexicographically smaller id (the co-resolution auto/auto convention; for suffix twins this prefers the singular), so a rerun is stable and independent of mutable alias state. The pass SHALL be bounded per tick, SHALL log each merge through the standard merge machinery, SHALL count merges and deliberate skips in the job summary, and SHALL leave a transiently-failed merge unmerged for a later tick (unmerged is the retry state). Merged losers leave the surviving set, so the pass self-quiesces; dependent aliases, edges, and keyed surfaces SHALL converge through the existing representative-chain machinery, never by key rewrites in this pass.

#### Scenario: A plural twin pair collapses to the singular survivor

- **WHEN** `onion` and `onions` both survive as auto concrete nodes sharing one lexical form
- **THEN** the reconcile merges `onions` into `onion` (the lexicographically smaller id) with no classifier call, and the merge is counted in the job summary

#### Scenario: Twin abstract concepts merge

- **WHEN** `chile` and `chiles` both survive as auto concept nodes (`concrete = 0`) sharing one lexical form
- **THEN** the reconcile merges `chiles` into `chile`, consolidating the duplicated membership fan-in through representative resolution

#### Scenario: Mixed concreteness never merges

- **WHEN** two surviving auto nodes share a lexical form but one is a concept and the other concrete
- **THEN** the pair is skipped and counted, and no merge is written

#### Scenario: Human nodes never merge away

- **WHEN** a surviving human-sourced node shares a lexical form with a surviving auto node
- **THEN** the pair is skipped and counted, and neither node is merged

#### Scenario: An ambiguous lexical form is never guessed

- **WHEN** three or more surviving nodes share one lexical form
- **THEN** the group is skipped and counted, and no merge is written

#### Scenario: The reconcile self-quiesces

- **WHEN** the reconcile runs on a registry whose twins were merged on an earlier tick
- **THEN** it finds no surviving twin pair, writes nothing, and reports zero merges

#### Scenario: Bounded per tick

- **WHEN** more twin pairs survive than the per-tick cap
- **THEN** the pass merges at most the cap this tick and converges the remainder on later ticks

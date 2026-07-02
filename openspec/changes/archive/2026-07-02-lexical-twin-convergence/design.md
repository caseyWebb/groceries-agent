## Context

The clean-derivation rebuild left four lexical twin pairs in production (verified this morning, all LIVE + AUTO): `onion`/`onions` (concrete, 2 vs 1 aliases, `onions` minted first and even re-confirmed), `chile`/`chiles` (**both `concrete = 0`** — twin abstract classes with duplicated membership fan-in: `chiles de arbol`, `thai bird chiles`, `green chilies`, `poblano peppers` each edge to both), `chili pepper`/`chili peppers` (concrete), and `tomato`/`tomatoes` (concrete, found by the planning spike's suffix scan). Zero *exact*-lexical-key duplicates exist among the 542 live nodes — the fast path holds everywhere its equivalence reaches.

Two gaps compose the defect:

1. **Same-tick blindness.** The lexical map is built once at batch start (`reconcileNormalization`, ingredient-normalize.ts:642); mid-batch mints join the retrieval + collision sets in-tick (lines 656–661) but not the lexical map.
2. **Premise correction — plural twins never shared a key.** The task framing assumed the production pairs share a `lexicalKey`. They do not: `lexicalKey` (line 194) folds punctuation only, and its docstring deliberately declines pluralization folding. `lexicalKey("onions") ≠ lexicalKey("onion")`, so an in-tick append alone would *not* have prevented any of the observed pairs, and a retro merge keyed on the unmodified function would find none of them — the acceptance fixture would be unreachable. Only the stochastic classifier (whose prompt states "pluralization = SAME product" as a mechanical rule, ingredient-classify.ts:75) stands between a plural pair and a twin, and production shows it failing under same-batch pressure.

## Goals / Non-Goals

**Goals:**
- The second twin of a same-batch pair resolves deterministically through the fast path (no second node).
- Surviving twins — the four production pairs first — converge via a bounded, deterministic, self-quiescing reconcile with no model calls.
- The fast path, the alias re-audit, and the retro merge all act on one shared definition of lexical equivalence.

**Non-Goals:**
- `scallion`/`green onion` (semantic pair): no special-casing, no prompt hints — the operator wants to observe whether the organic LLM passes find it unaided.
- The chile abstraction sprawl (`chile` vs `chili` vs `chili pepper`): different lexical keys, judgment-level, untouched.
- Word-order folding, stemming beyond the conservative plural rule, and any change to `mergeIdentities` or the D1 schema.

## Decisions

### D1. Fold plurals inside `lexicalKey` (deviation from the task premise, load-bearing)

`lexicalKey` gains a conservative token-level plural fold: for whitespace tokens matching `/^[a-z]{4,}$/` — `-ies` → `-y` (berries), `-oes` → `-o` (tomatoes), else strip one trailing `-s` unless the token ends `-ss`/`-us`/`-is` (glass, molasses-safe, hummus, couscous, asparagus). Tokens with digits or `:` (id-shaped) never fold.

*Why here and not a parallel "twin key":* part 1's stated acceptance ("the second twin then hits the fast-path") and part 2's predicate ("pairs sharing the same lexicalKey") both require plural equivalence to be visible to the *same* key the fast path uses. A separate fold only for the retro merge would leave same-batch plural twins minting forever (healed a tick later — churn by design) and would split lexical equivalence into two subtly different relations. One function, one relation: fast path, alias re-audit, and retro merge stay provably consistent — any pair the retro merge would collapse is exactly a pair the fast path would have aliased had the forms arrived on different ticks (arrival-order independence).

*Why folding is safe enough to overturn the earlier "deliberately NOT attempted" stance:* (a) the confirm prompt already mandates pluralization = SAME as a mechanical rule — the fold determinizes an instruction the LLM was already required to apply without judgment, unlike word-order folding which stays excluded; (b) the ambiguity rule is unchanged — whenever the registry itself holds both forms as distinct survivors (the one observable hint they might differ), the fast path abstains; (c) the fold fails safe — an irregular plural it misses ("peaches, radishes", "leaves") falls through to the classifier, fragmentation at worst; a false positive requires two *distinct real products* differing only by a plural suffix, which the grocery domain does not offer (audited against the 542-node production registry: the only fold-collisions are the four genuine twin pairs).

### D2. In-tick lexical append mirrors the retrieval-set append, with explicit ambiguity state

`buildLexicalMap` currently swallows its `ambiguous` set (keys deleted, indistinguishable from absent). It gains an optional `ambiguousOut?: Set<string>` out-parameter (the alias re-audit call site is untouched), and a new exported `appendLexicalForm(map, ambiguous, form, survivor)` reproduces the builder's add-semantics incrementally: a key in `ambiguous` never re-enters; a collision with a different survivor deletes the entry and marks the key ambiguous. The batch loop appends next to the existing `identityVecs.push` (mint paths only, `r.node` set — novel, specialization, disjunction): `r.id`, plus `r.term` when its form differs (the alias variant that `commitResolution` writes). Without the out-parameter a mint whose key was batch-start-ambiguous would silently repopulate the map and the fast path would guess among 3+ nodes — the explicit set is what makes the append safe.

### D3. Retro merge predicate: LIVE, AUTO/AUTO, same-concreteness pairs; everything else skips and counts

- **Abstract/abstract pairs merge.** Production forces the decision: `chile`/`chiles` are both concepts and are in the acceptance fixture. Two same-key concepts are the same class; merging consolidates their duplicated membership fan-in through representative resolution.
- **Mixed concrete/concept pairs never merge**, consistent with the concept-concrete merge guard precedent (a shared surface across the concreteness boundary is class-vs-member structure, not identity evidence).
- **Any human involvement skips.** Stricter than co-resolution's human-survivor rule, deliberately: co-resolution spends a classifier confirm before merging; this pass spends none, so it acts only where both sides are machine-derived. Operator intent is never auto-merged on purely mechanical evidence (the segment-repair convention).
- **3+ survivors on one key skip and count** — the retro mirror of the fast path's ambiguity rule: never guess.

### D4. Survivor selection: lexicographically smaller id (improving on the suggested alias-count rule)

The task suggested "more alias rows wins; tie → lexicographically shorter id". Rejected in favor of the plain lexicographically-smaller-id rule because: (a) it is the **existing auto/auto convention** — `reconcileCoResolution` line 616 picks exactly this; (b) alias counts are mutable state, so the suggested rule's outcome depends on *when* the pass first runs, while lexicographic order is a property of the ids alone — deterministic across time, not just within a run; (c) for suffix twins the loser is `survivor + suffix`, and a strict prefix always sorts first, so the singular provably survives in every twin pair — whereas the alias-count rule picks the plural `tomatoes` in production (2 aliases vs 1). Fixture outcome: survivors `onion`, `chile`, `chili pepper`, `tomato`. Re-pointing churn is immaterial (1–2 alias rows, converged by the existing alias-target machinery).

### D5. Placement, bounds, failure handling — the segment-repair shape

`reconcileLexicalTwins(deps, summary)` runs in `reconcileNormalization` immediately after `reconcileSegmentOverflow` and before `reconcileDisjunctions`/`reconcileCoResolution`, so the later passes read post-merge chains. It reuses `deps.identitySources()` and `deps.merge()` (`mergeIdentities` — cycle-guarded, logs a standard `merge` row like co-resolution's; no new D1 surface, `corpus-db.ts` untouched). Bounded by a new `LEXICAL_TWIN_MAX_PER_TICK = 5` (`deps.twinMergeMaxPerTick`), groups processed in sorted key order for determinism. A read failure logs and returns (never fails the tick); a merge failure logs and leaves the pair for a later tick (unmerged is the retry state — not counted as a skip, so `lexicalTwinSkipped` measures only standing deliberate skips). Born-quiesced: merged losers have `representative` set and leave the live filter; with D2 shipped, new same-batch twins cannot form, so the pass converges the backlog and then no-ops.

### D6. Summary counters and docs

`NormalizeSummary` gains `lexicalTwinMerged` and `lexicalTwinSkipped` (camelCase, mirroring `segmentRepaired`/`segmentSkipped`). SCHEMAS.md's ingredient-identity narrative documents both plus the plural-insensitive lexical form; ARCHITECTURE.md's capture bullet is updated in lockstep. The admin **Status** page renders `job_runs.summary` generically (`Object.entries`, status.tsx:189) and the audits-page cards curate only the alias/edge/sku/disjunction fields — so no admin surface changes and no Playwright run (verified, stated here per the repo rule).

## Risks / Trade-offs

- **[Fold false-positive: two distinct products differing only by plural suffix]** → Domain audit found none among 542 production ids; the guard list (`-ss`/`-us`/`-is`, ≥ 4 letters) protects the known hazard classes; the ambiguity rule abstains whenever both forms exist as survivors; the confirm prompt's own mechanical rule already collapses these pairs when the classifier obeys it. Residual risk accepted and documented.
- **[Fold misses irregular plurals ("radishes", "leaves", "cherries" only via `-ies`)]** → Fails safe to the classifier exactly as today; a missed twin the classifier then mints is healed by the retro pass whenever the miss still folds equal, else it is a semantic pair and out of scope.
- **[Alias re-audit behavior shifts implicitly (shared `lexicalKey`)]** → Intended: same evidence, same relation. The audit's distance-guarded confirm flow is unchanged for non-matching forms; full vitest run gates regressions.
- **[Retro merge acts without an LLM confirm]** → Scoped to exactly the evidence class the fast path already acts on deterministically; auto/auto only; same-concreteness only; 2-node groups only; bounded; every merge logged through `mergeIdentities`.
- **[A twin pair could re-form between the merge and the next map build]** → The batch-start map marks the pair's shared key ambiguous while both survive (fast path abstains, classifier decides); after the merge the key resolves uniquely to the survivor. No oscillation: the pass never re-splits.

## Migration Plan

No migration, no schema change, no admin change. Deploy via the normal pipeline; acceptance is observed in production within a few ticks: the four twin pairs collapse to `onion`, `chile`, `chili pepper`, `tomato` (losers gain `representative`; aliases/edges/keyed surfaces converge through alias-target convergence, sku-cache rekey, the grocery/pantry reconcile, and the projection re-resolution), and `lexicalTwinMerged` totals 4 across the converging ticks, then the counter goes quiet.

## Open Questions

None — the abstract-pair question was settled by production data (both `chile`/`chiles` are concepts → same-concreteness pairs merge), and survivor selection is fixed by D4.

## Why

The clean-derivation rebuild (verified against production this morning) left four lexical twin pairs in the identity graph — `onion`/`onions`, `chile`/`chiles` (both abstract), `chili pepper`/`chili peppers`, and `tomato`/`tomatoes` — all LIVE, AUTO pairs out of 542 live nodes. Ultra-common terms arrive in the same capture batch (`NORMALIZE_MAX_PER_TICK = 25`); the lexical fast-path map is built once at batch start, and mid-batch mints join the retrieval set in-tick but not the lexical map, so the second twin of a same-batch pair misses the fast path. Compounding this, `lexicalKey` folds punctuation only — a plural twin never shares a lexical key with its singular, so even a batch-start map cannot unify `onion`/`onions`: today only the stochastic classifier stands between a plural pair and a duplicate mint, and production shows it failing. Twin nodes fragment the join keys the whole pipeline hangs off (`sku_cache`, `brand_prefs`, `ingredients_key`, grocery/pantry dedup) and duplicate concept membership fan-in (production `chile`/`chiles` each carry a full copy of the membership edges).

## What Changes

- **Conservative plural fold in `lexicalKey`**: the lexical form becomes punctuation- **and plural-**insensitive via a token-level fold (`-ies`→`-y`, `-oes`→`-o`, else strip one trailing `-s` unless the token ends `-ss`/`-us`/`-is`; letters-only tokens of ≥ 4 chars). This is the premise the rest of the change stands on: without it neither the in-tick append nor a retro merge keyed on lexical equality can touch the observed production pairs. The confirm prompt already states pluralization = SAME product as a mechanical rule; the fold makes deterministic what the classifier is already instructed to do deterministically. The existing ambiguity rule (two distinct survivors sharing a key → fast path abstains) is the safety valve, unchanged.
- **In-tick lexical map appends**: when the capture drain commits a resolution that mints a node, the new node's lexical key(s) (id, plus the surface term when it differs) join the batch's live lexical map — exactly parallel to how just-minted nodes join the retrieval set in-tick. An appended key that collides with an existing entry for a different survivor becomes ambiguous (removed; the fast path never fires on it), mirroring `buildLexicalMap`'s semantics.
- **Retro lexical-twin merge reconcile**: a bounded, deterministic, self-quiescing per-tick step in the capture job (same shape as the segment-overflow repair) that finds pairs of LIVE, AUTO nodes whose ids share a lexical key and same concreteness, and merges them via `mergeIdentities` — no LLM call; lexical-key equality is the same evidence the fast path already acts on deterministically. Survivor = the lexicographically smaller id (the existing co-resolution auto/auto rule; for suffix twins this always prefers the singular). Pairs involving a human node, mixed concreteness (the concept-concrete merge guard precedent), or 3+ same-key survivors are skipped and counted, never guessed. Merged losers leave the live set, so the predicate self-quiesces; aliases/edges/keyed surfaces converge through the existing representative machinery (alias-target convergence, sku-cache rekey, grocery reconcile, projection re-resolution).
- **Two additive job-summary counters** (`lexicalTwinMerged`, `lexicalTwinSkipped`), documented in SCHEMAS.md; the admin Status page renders summary fields generically, so no admin surface changes.

The four production pairs are the acceptance fixture: within a few ticks of deploy each pair collapses to one survivor (`onion`, `chile`, `chili pepper`, `tomato`).

Explicitly out of scope: `scallion`/`green onion` (semantic, non-lexical — deliberately left for the organic LLM passes to find unaided; no special-casing, no prompt hints) and the chile abstraction sprawl (`chile` vs `chili` vs `chili pepper` — different lexical keys, judgment-level).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ingredient-normalization`: the lexical fast-path requirement (Conservative collapse and prep-versus-product stripping) gains the plural-insensitive lexical form and the in-tick map append with collision-ambiguity semantics; a new requirement adds the retroactive lexical-twin merge reconcile.

## Impact

- `packages/worker/src/ingredient-normalize.ts`: `lexicalKey` fold, `buildLexicalMap` ambiguity export, in-tick append in the batch loop, new `reconcileLexicalTwins` sub-pass + per-tick cap, `NormalizeSummary` fields, `NormalizeDeps` cap wiring. No new D1 reads/writes — the step reuses `identitySources()` and `merge()` (`mergeIdentities`); no migration; `corpus-db.ts` untouched.
- `packages/worker/src/ingredient-alias-audit.ts`: no code change, but its lexical re-pointing inherits the plural fold through the shared `lexicalKey`/`buildLexicalMap` (same evidence, consistent behavior).
- Tests: `packages/worker/test/ingredient-normalize.test.ts` (fast-path fold, in-tick append, collision ambiguity, retro merge suite mirroring the segment-repair block); any suites asserting punctuation-only lexical behavior updated.
- Docs in lockstep: `openspec/specs/ingredient-normalization/spec.md` (via delta), `docs/SCHEMAS.md` (lexical-form narrative + summary counters), `docs/ARCHITECTURE.md` (capture bullet).

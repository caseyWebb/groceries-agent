## 1. Lexical equivalence (the fold) and the in-tick append

- [x] 1.1 Add the conservative plural fold to `lexicalKey` in `packages/worker/src/ingredient-normalize.ts` (private `foldPluralToken`: letters-only tokens ≥ 4 chars; `-ies`→`-y`, `-oes`→`-o`, else strip one trailing `-s` unless the token ends `-ss`/`-us`/`-is`) and update the docstring (punctuation- and plural-insensitive; word-order folding still excluded)
- [x] 1.2 Give `buildLexicalMap` an optional `ambiguousOut?: Set<string>` out-parameter (populated with the dropped keys; existing call sites unchanged) and export `appendLexicalForm(map, ambiguous, form, survivor)` mirroring the builder's add/collision semantics (an already-ambiguous key never re-enters; a different-survivor collision deletes the entry and marks the key)
- [x] 1.3 In `reconcileNormalization`, thread a `Set<string>` through the batch-start `buildLexicalMap` call and, in the batch loop's existing `if (r.node)` append block, append `r.id` (and `r.term` when its lexical form differs) via `appendLexicalForm`

## 2. Retro lexical-twin merge reconcile

- [x] 2.1 Add `LEXICAL_TWIN_MAX_PER_TICK = 5` and `twinMergeMaxPerTick` to `NormalizeDeps` + `buildNormalizeDeps`; add `lexicalTwinMerged`/`lexicalTwinSkipped` to `NormalizeSummary` + `emptySummary`
- [x] 2.2 Implement `reconcileLexicalTwins(deps, summary)` (segment-repair shape: guarded `identitySources()` read, group live nodes by `lexicalKey(id)`, sorted key order, per-tick cap): merge auto/auto same-concreteness 2-node groups via `deps.merge(loser, survivor)` with survivor = lexicographically smaller id; skip+count human-involved pairs, mixed-concreteness pairs, and 3+-node groups; log-and-leave transient merge failures uncounted
- [x] 2.3 Wire it into `reconcileNormalization` after `reconcileSegmentOverflow`, before `reconcileDisjunctions`

## 3. Tests (packages/worker/test/ingredient-normalize.test.ts unless noted)

- [x] 3.1 Fold + fast-path: `lexicalKey` fold unit coverage (plural pairs incl. `tomatoes`→`tomato`, guards `-ss`/`-us`/`-is`, short/digit/`:` tokens untouched); a queued plural resolves SAME to the surviving singular with no confirm call; both forms live → ambiguous → classifier decides
- [x] 3.2 In-tick append: same-batch twin pair → second twin aliases to the first's mint, exactly one node minted, `lexical` counted; a mid-batch mint colliding with an existing different-survivor entry → key ambiguous → later same-form term takes the confirm flow and both nodes stand (no false merge); a batch-start-ambiguous key stays ambiguous after a same-key mint
- [x] 3.3 Retro merge describe block (mirroring the segment-overflow block): twin pair merges with survivor-selection assertions (loser/survivor args to `deps.merge`, `lexicalTwinMerged` counted); abstract/abstract pair (concrete 0/0) merges; mixed concreteness skips+counts; human-involved pair skips+counts; 3+-node group skips+counts; per-tick cap bounds merges; quiescence — a second run over the post-merge registry (loser has `representative`) merges nothing and counts zero
- [x] 3.4 Run the FULL vitest suite and fix any suite asserting punctuation-only lexical behavior (alias-audit/disjunction suites inherit the fold through the shared `lexicalKey`)

## 4. Docs in lockstep + validation

- [x] 4.1 Update `docs/SCHEMAS.md` (punctuation- and plural-insensitive lexical form; the retro twin-merge plain `merge` rows; `lexicalTwinMerged`/`lexicalTwinSkipped` summary counters) and `docs/ARCHITECTURE.md`'s capture bullet (fold + in-tick append + twin reconcile), present tense, no history narration
- [x] 4.2 Verify no admin surface change is needed (Status page renders summary generically; audits cards curate only alias/edge/sku/disjunction fields) — no Playwright run required; state this in the final report
- [x] 4.3 Full battery: `tsc --noEmit` (worker) x3 runs green, FULL `vitest run` green, `openspec validate lexical-twin-convergence` from repo root passes

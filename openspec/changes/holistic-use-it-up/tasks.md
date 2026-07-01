## 1. Stateful coverage in the selection core (de-risk the math first)

- [ ] 1.1 `src/diversify.ts` — extend `DiversifyState` with `remainingAtRisk: Map<string, number>` (the demand multiset, item → still-uncovered count); `newDiversifyState()` seeds it empty. Add coverage tuning to `DiversifyParams` (`coverageWeight`, plus reuse of the tiered `perishWeight`/`keyWeight`/`overlapCap` shape from `semantic-search.ts`), defaulted in `DEFAULT_DIVERSIFY_PARAMS`.
- [ ] 1.2 `selectOne` — add the bounded coverage term `coverageWeight · cover(c)` to the MMR objective, where `cover(c)` sums the tiered weight of each candidate item **still** in `remainingAtRisk` (>0), saturated at `overlapCap`; on pick, **decrement** each claimed item's count to a floor of 0 and record which items were claimed (for the caller's reporting). Pure, deterministic, gate-agnostic (still only reorders survivors).
- [ ] 1.3 `admit` (locked picks) also decrements the demand for items the locked recipe claims, so a locked use-it-up recipe doesn't leave its items falsely uncovered.
- [ ] 1.4 `test/diversify.test.ts` — coverage term picks an at-risk recipe over an equally-relevant non-cover; multi-serving (count 2) is claimed by two picks; single-count claimed once; saturation caps a hoarder; `coverageWeight=0` reduces exactly to today's behavior; determinism under a fixed seed.

## 2. Derive the at-risk demand from the pantry (always-on)

- [ ] 2.1 `src/meal-plan-proposal-tool.ts` — load the caller's `pantry`; build the corpus **perishable vocabulary** (alias-normalized union of `perishable_ingredients` across the index) and mark a pantry item at-risk when its `normalized_name` is a member. Age-weight from `added_at` (older = higher), with a freshness floor. Map `quantity → count` (`full`→2, `partial`/`low`→1, explicit numeric→that, capped). Produce the demand multiset.
- [ ] 2.2 Union `boost_ingredients` (normalized) into the demand as an explicit override with a guaranteed count; the pantry-derived items still participate. Thread the multiset into `ProposalCtx`.
- [ ] 2.3 `buildPool` — stop applying the uniform use-it-up boost inside the planner (pass empty `boostItems` to `rankCandidates` for the pool score, or weight it to zero) so the stateful term is the single home for use-it-up and there's no double-count. (`search_recipes`' passive boost is untouched.)
- [ ] 2.4 Seed `state.remainingAtRisk` from `ctx` in `assembleProposal` before the fill loop.

## 3. Residual + claimed-item reporting

- [ ] 3.1 `src/meal-plan-proposal.ts` — after the fill, read the leftover `remainingAtRisk` (>0) as plan-level `uncovered_at_risk`; set each main's `uses_perishables` from the items it actually **claimed** (not any listed perishable), and push a "uses your X (going bad)" `why`. Keep the per-slot single-use `flags.waste` as a hint.
- [ ] 3.2 `ProposalResult` gains `uncovered_at_risk`; wire it through the tool return.
- [ ] 3.3 `test/meal-plan-proposal.test.ts` — always-on coverage with no `boost_ingredients`; multi-serving split across two slots; `uncovered_at_risk` names the leftovers; a main reports only claimed items; coverage never admits a gated-out recipe.

## 4. Docs (lockstep)

- [ ] 4.1 `docs/TOOLS.md` — `propose_meal_plan`: use-it-up is now always-on (pantry-derived), `boost_ingredients` is an override, and the return carries `uncovered_at_risk`.
- [ ] 4.2 `docs/ARCHITECTURE.md` — the set-cover-in-the-fill note (demand multiset threaded through the sequential selection; keyword+alias, no vectors; residual honesty). No `SCHEMAS.md` change (no new tables).

## 5. Verify

- [ ] 5.1 `aubr typecheck` + `aubr test` green.
- [ ] 5.2 Re-run the spike harness (`spike/meal-plan-examples/use-it-up.*`) against the real corpus to set `coverageWeight`, the `quantity→count` map, and the age floor from the Open Questions — confirm coverage rises toward IDEAL (spike baseline 2/4, D-split 1 → target 4/4, split 2) without visibly degrading vibe relevance. *(Manual; feeds the default tuning.)*
- [ ] 5.3 `openspec validate "holistic-use-it-up"` passes.

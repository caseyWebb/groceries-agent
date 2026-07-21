# Tasks — single-slot-discovery

## 1. Sampler tier order

- [x] 1.1 `packages/worker/src/night-vibe-schedule.ts`: move the new-for-me block (step 2.5) below the overdue block (→ step 3.5); overdue `gatingQuotas` computes over post-pinned slots, the seed ledger over the post-overdue remainder; update the doc comment's tier list; rollover/bucket semantics unchanged.

## 2. Engine derivation + param retirement

- [x] 2.1 `packages/worker/src/meal-plan-proposal-tool.ts`: on the palette path (no ephemeral set driving), derive the seed internally — `readNewForMe(env, tenant.id, tenant.member, floor)` with the `list_new_for_me` window, first slug passing the existing resolve rules (visible/embedded/not rejected/excluded/locked), ≤1 seed into `sampleWeek`. Ephemeral path: no seed.
- [x] 2.2 `new_for_me` input: accepted and ignored (no error, no effect) — drop its plumbing; keep the key in the schema for the window.
- [x] 2.3 Descriptions: `propose_meal_plan` + `display_meal_plan` — discovery placement is engine-internal (one slot, after the palette's debt); `new_for_me` line removed (deprecation table documents the window).

## 3. Persona

- [x] 3.1 `packages/plugin/AGENT_INSTRUCTIONS.md` plan flow: drop `list_new_for_me()` from step 1's context reads and the fold-in sentence from step 2 (the engine seasons the week itself); `build-plugin.mjs --check` + census green.

## 4. Tests + docs + verification

- [x] 4.1 Sampler tests: overdue-before-discovery ordering; debt-saturated week rolls the seed over; single-seed placement unchanged bucket semantics.
- [x] 4.2 Engine tests: palette path places exactly one internally derived discovery (several available); ephemeral path places none; `new_for_me` passed → ignored without error.
- [x] 4.3 `docs/TOOLS.md`: both tool sections; `list_new_for_me` section notes plan placement is engine-internal (the read is conversational); Deprecations row for `new_for_me` with the standard removal condition.
- [ ] 4.4 `aube run typecheck`; worker suite; plugin tests; `openspec validate single-slot-discovery --strict`; archive.

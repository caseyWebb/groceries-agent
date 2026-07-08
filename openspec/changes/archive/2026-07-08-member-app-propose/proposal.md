# Proposal — member-app-propose

## Why

The member web app plan (`docs/plans/web-app.md` on the plan branch, §10 phase P2) calls for the
propose flow: the **W1 propose-tool extensions** (plan §5) followed by the full "plan your week"
UI. `propose_meal_plan` already does two-level planning — vibe palette → cadence-debt × weather
quotas → embedding retrieval + MMR — statelessly and deterministically, with `lock`/`exclude`/
`seed`/`boost_ingredients`/`nudges` iteration (`packages/worker/src/meal-plan-proposal-tool.ts`,
`meal-plan-proposal.ts`, `diversify.ts`, `night-vibe-schedule.ts`). What it cannot yet express is
the interaction loop the design bundle's propose flow needs
(`docs/plans/web-app-design/project/cookbook/app-propose.js` / `app-propose-ui.js` /
`app-propose.css`, read in full): per-night facet pins, a swap menu fed by each slot's
already-computed ranked pool, a freeform "in your own words" nudge and per-night vibe override,
and an in-place recipe swap that keeps the slot's vibe identity.

Grounding against the code corrected and sharpened four premises:

- **The living `meal-plan-proposal` spec is ahead of the code**: its "Stateless iteration"
  requirement already names an optional `freeform` string and its "Off-hot-path" requirement
  already allows "at most one embedding call, only when `freeform` is supplied" — but the shipped
  tool has no `freeform` param and makes **no** AI call. W1-3 closes a spec↔code gap rather than
  minting a new promise; this change makes the contract concrete (batched, hash-cached).
- **Swap-in-place needs a per-slot recipe pin on the endpoint, not just client state.** The plan
  files overrides under client-side session state, but the only way the current tool can express
  "keep this exact recipe" is `lock` — which detaches the recipe from its vibe slot
  (`vibe_id: null`), losing the `from_vibe` provenance the commit threads and removing the slot
  from the week's diversify state coherently. The mock's swap keeps the vibe identity
  (`overrides[vibeId] = slug`); the endpoint must be able to say the same.
- **The tighten signal's queue machinery already exists end-to-end**: `adjust_cadence` proposals
  are drafted by `draftProposals` (`reconcile-signals.ts`), deduped by `proposalId`'s
  cadence-bucketed stable id, enqueued `INSERT OR IGNORE`, listed and confirmed by the P1 queue
  UI, and applied by `applyProposal` — tighten is a new deterministic **draft rule** in the same
  `signal-cron` producer, reusing the `adjust_cadence` kind, with zero consumer-path change.
- **The mock's week-level "proteins you want" nudge has no W1 line item** but is part of the
  nudge bar the design bundle specifies (a soft `+0.15` relevance boost, never a gate) — and the
  living spec's iteration requirement already names "a protein target" among the nudges. It lands
  as `nudges.proteins`, the exact sibling of the freeform term.

Production grounding (read-only D1 spike, 2026-07-07, see design.md): 200 recipes, **all 200
embedded** (every slot pool fills to its `POOL_K = 24` recall, so alternates always have
material); the night-vibe palette is still **empty** across all tenants and `cooking_log` has
zero `satisfied_vibe` rows — the tighten signal has no defect rows to converge (it prevents,
like W3) and the propose page's empty-palette state is the actual first render; a stored
embedding row is ~14.3 KB of JSON (sizes the KV cache entry).

## What Changes

- **W1-1 — per-slot facet pins.** `propose_meal_plan` (and the `/api` propose endpoint — one
  contract, operator decision §11.4) gains a `slots` param: per-vibe constraint objects
  (`protein`, `cuisine`, `max_time_total` — the latter explicitly nullable to lift a vibe's own
  time facet for one night) merged into that slot's `buildPool` facet gate with precedence
  slot pin > global `nudges.max_time_total` > the vibe's own facets. Constraints for a vibe not
  sampled this week are inert (stateless replay stays tolerant of palette edits).
- **W1-2 — alternates per slot**, from the already-computed ranked pool (no extra retrieval):
  each vibe slot returns `alternates` (top-N compact lites), `alt_similar` (nearest by cosine to
  the chosen main), and `alt_different` (highest-ranked different-cuisine candidate) — all gate
  survivors by construction, excluding recipes already used by the week. Powers the swap menu;
  empty slots keep their pool's alternates as the escape hatch.
- **W1-2b — in-place recipe pin** (`slots[].recipe`): fills that slot with the named recipe while
  keeping the slot's vibe identity and provenance, admitted into the week's diversify state
  up-front (like a lock) so the rest of the week diversifies away from it. Required by the swap
  flow (see Why).
- **W1-3 — freeform nudge + per-slot vibe override.** `nudges.freeform` embeds the typed phrase
  at request time and enters every slot's ranking as a bounded additive term; `slots[].vibe`
  replaces one slot's query vector with the embedded phrase (gate and vibe identity unchanged —
  and it makes an unembedded fresh vibe fillable tonight instead of an explicit empty slot).
  `nudges.proteins` is the week-level soft protein boost. All request-time embeds go through a
  new **hash-keyed KV cache** (`embedTextsCached`, one batched `embedTexts` call for the misses);
  `search_recipes` ranked mode routes its vibe embeds through the same helper, so the MCP path
  benefits in the same pass. This is the app's one sanctioned request-time embedding (plan §1).
- **W1-4 — reconcile tighten signal**: the deterministic sibling of the existing stretch in
  `draftProposals` — a cadence vibe whose recent satisfaction intervals repeatedly come in well
  under its stated cadence gets an `adjust_cadence` proposal suggesting the observed interval.
  Same `signal-cron` job, same queue, same stable-id dedupe/reject-suppression, zero
  confirm/apply changes.
- **Weather for the UI**: the `get_weather_forecast` tool closure's preference-resolved fetch is
  extracted into a shared op (P1's extraction discipline) and exposed as
  `GET /api/propose/weather` for the mock's forecast strip. `sampleWeek` additionally annotates
  which weather category a quota-sampled slot filled, and the proposal's `why[]` gains the
  weather-fit line the living spec already names as an example.
- **`POST /api/propose`**: the propose pipeline is extracted from the MCP tool closure into a
  shared operation both the tool and the route call (tool behavior unchanged); the endpoint takes
  the full request (nights, seed, lock, exclude, boost_ingredients, nudges, slots) and returns
  the tool's result shape.
- **The propose flow UI** (`packages/app`, per the design bundle): a client-side propose session
  (seed, locks, pins, overrides, excludes, freeform — persisted client-side, replayed against the
  stateless endpoint; **no server-side session state**, plan §5 explicit non-work), live re-query
  with `keepPreviousData`, the nights stepper + adventurousness slider + protein wants + freeform
  nudge bar, per-slot lock/swap/exclude/facet-pin/vibe-override controls, the weather strip, the
  variety bar, and commit — mapping filled slots onto P1's plan ops with `from_vibe` provenance.
  Entry points: the meal-plan page's "Plan my week" and the palette footer (both deferred by P1
  to this change).
- **Playwright coverage** for the propose flow on the P0 harness, engineered to run with **zero
  model calls**: the seed gains a palette + deterministic synthetic vectors, and the freeform
  spec pre-warms the KV embed cache with its phrase's vector so typing it is a cache hit.

## Capabilities

### New Capabilities

- **`member-app-propose`** — the member app's propose surface: the session-gated propose + weather
  endpoints over the shared planner operation, the client-side-only propose session (a negative
  guarantee), the propose-flow UI and its commit-through-plan-ops, and the no-model Playwright
  gate.

### Modified Capabilities

- **`meal-plan-proposal`** — the iteration requirement gains per-slot constraints (facet pins,
  nullable per-night time cap, vibe override, recipe pin) and the week-level `proteins`/`freeform`
  nudges; a new requirement returns per-slot alternates from the ranked pool; the off-hot-path
  requirement's embed allowance becomes concrete (one batched call covering freeform + overrides,
  cache-gated); a new requirement pins the request-time query-embedding cache (keyed by model +
  normalized text, KV, shared with `search_recipes` ranked mode).
- **`profile-reconciliation`** — the deterministic signal pass gains the cadence-**tighten**
  draft rule (sibling of stretch): repeated early satisfaction proposes tightening the cadence to
  the observed interval, as an `adjust_cadence` proposal with the existing dedupe and
  reject-suppression semantics.

## Impact

- **No D1 migrations.** The embed cache is KV (`KROGER_KV`, self-expiring, content-addressed);
  alternates and pins are computed shapes; tighten reads existing `cooking_log` columns.
- **Worker** (`packages/worker/src/`): `embedding.ts` (+`embedTextsCached`), `tools.ts`
  (`search_recipes` embeds via the cache; weather-op extraction), `meal-plan-proposal-tool.ts`
  (schema + extraction of the shared op), `meal-plan-proposal.ts` (slot constraints, alternates,
  recipe pins, whys), `semantic-search.ts` (optional bounded-nudge params, absent = today's
  behavior), `night-vibe-schedule.ts` (`WeekSlot` category annotation), `night-vibe-db.ts`
  (+`readVibeSatisfactionDates`), `reconcile-signals.ts` (tighten rule), new `src/api/propose.ts`
  route group.
- **Frontend**: `packages/app` propose page + session/query hooks; `packages/ui` slot-card
  primitives (facet popover, swap menu, weather strip, variety bar) per the design bundle.
- **Docs (lockstep)**: `docs/TOOLS.md` (`propose_meal_plan` params/returns rewritten — including
  retiring the "no Workers AI call" absolute in favor of the cache-gated batched-embed
  guarantee), `docs/SCHEMAS.md` (new query-embedding-cache KV section), `docs/ARCHITECTURE.md`
  (the propose surface + the one sanctioned request-time embed). `AGENT_INSTRUCTIONS.md` checked
  for stale propose-flow claims in the same pass.
- **Tests**: Worker unit tests for the cache (hit/miss/failure fail-open), the slot-constraint
  gate precedence, alternates determinism, recipe-pin admission, the tighten rule matrix, seed
  determinism with the new params ("same choices in, same week out"); route tests for
  `/api/propose` + weather; Playwright specs for the flow.

## Dependency

**Requires P0 (`member-app-foundations`) and P1 (`member-app-core`) to have landed.** From P0:
the invite-code session middleware yielding the resolved tenant, the `/api` mount with the shared
error→HTTP/ETag/`X-App-Build` middleware, `packages/app`/`packages/ui`, and the app Playwright
harness. From P1: the per-area route-group idiom and `hc` type exports, the D8 write-class
discipline (the propose endpoint is a stateless read-shaped POST — neither class; commit rides
P1's class (b) plan ops), the plan ops with `from_vibe` and the `set` op, and the palette +
reconciliation-queue pages this flow links into. Tasks name P0/P1 pieces by role; the
implementer binds them to the landed actuals.

# Design — member-app-propose

## Context

This is **P2** of the member web app plan (`docs/plans/web-app.md`, §11 operator defaults
confirmed 2026-07-07). P0 (session auth, `/api` mount + shared middleware, `packages/app` +
`packages/ui`, the app Playwright harness) and P1 (the member core: per-area route groups over
named shared ops, the D8 write classes, plan ops with `from_vibe` + `set`, the palette +
reconciliation-queue pages) are assumed landed. P2 = the W1 propose-tool extensions (plan §5),
exposed on **both** the MCP tool and the `/api` propose area in the same pass (operator decision
§11.4), followed by the full propose-flow UI.

Design source of truth: the committed export bundle
`docs/plans/web-app-design/project/cookbook/` — `app-propose.js` (the mock engine: session
options, shape/fill, alternates, reconcile incl. its tighten rule), `app-propose-ui.js`
(`Pages.propose`: nudge bar, slot cards with facet popovers / swap menu / vibe panel, variety
bar, commit; `ProposeUI.palette` shipped in P1), `app-propose.css` (including the `wx-strip`
forecast strip the JS mock never got around to rendering — the CSS is the strip's spec), read in
full.

The real pipeline this designs against (read end-to-end):
`registerProposeMealPlanTool` (`meal-plan-proposal-tool.ts`) loads context → `sampleWeek`
(`night-vibe-schedule.ts`, Level 1: pinned/overdue force-placement + weather-category quotas +
bounded-multiplicity debt sampling) → per-vibe `buildPool` (facet gate via `filterRecipes`, then
`rankCandidates` cosine+favorites+freshness blend, truncated at `POOL_K = 24`) →
`assembleProposal` (`meal-plan-proposal.ts`, pure: one `DiversifyState` threaded across the
week — MMR + protein/cuisine caps + the decrementing at-risk coverage term — then plate
composition, flags, `why[]`). Deterministic given `seed` (`seededJitter` over the candidate
union); locks are admitted into the state first via `admit()`.

## Production spike (read-only, Cloudflare D1 query API, 2026-07-07)

Db `grocery-mcp` (`72599f36-…`):

| query | finding | consequence |
| --- | --- | --- |
| `recipe_derived` | 200 rows, **200 embedded** | every pool fills to `POOL_K = 24`; alternates (top-6 + similar + different) always have material; no unembedded-corpus edge dominates |
| `recipes` | 200 rows | facet-pin option universes (protein/cuisine) derive client-side from the cached index — no new endpoint |
| `night_vibes` | **0 rows** (all tenants) | the empty-palette intro is the propose page's actual first render; the Playwright seed must create a palette |
| `night_vibe_derived` | 0 rows | seeded vibe vectors are required for any propose spec to fill slots |
| `cooking_log` | 2 rows, **0 with `satisfied_vibe`** | the tighten signal has **no production firing data** — it prevents rather than heals; there is no defect-row acceptance fixture, so the acceptance is the unit matrix + the seeded harness |
| `pending_proposals` | 47 pending, all `kind='add_vibe'`, `producer='edge'` | the queue UI (P1) already renders volume; tighten rows will join the same list with the P1 `adjust_cadence` action ("Adjust to Nd") unchanged |
| embedding blob | `LENGTH(embedding)` ≈ 14.3 KB | sizes one KV cache entry (768 floats, JSON) — trivially within KV's 25 MB value cap; friend-group phrase volume is a few entries/week |

## Model identity at request time

Exactly one bounded Workers AI touch, sanctioned by plan §1: embedding the freeform phrase /
per-slot vibe overrides via `embedTexts` (`@cf/baai/bge-base-en-v1.5`, `EMBED_DIM = 768` —
`embedding.ts`), batched into **one call per request** and gated by the hash cache (D5). A
request with no freeform text and no vibe override makes **zero** AI calls, exactly as today.
Everything else is pure CPU over cron-captured vectors + D1 reads.

## Decisions

### D1 — The propose pipeline is extracted into a shared op; routes never re-implement

P1's D2 discipline. The whole tool closure body (context loads → shape → fill → assemble)
becomes `runProposeMealPlan(env, tenant, input, deps)` beside the tool wrapper; the MCP tool
passes its per-session memoized `ProposeDeps` closures, and the route builds fresh ones via an
exported `buildProposeDeps(env, tenant)` over the same underlying reads (overlay, last-cooked
map, owned equipment, ingredient context). Tool behavior is unchanged — existing tests stay
green. The same pass extracts the `get_weather_forecast` closure's preference-resolved fetch
(`readPreferences` → ZIP resolution → `fetchWeatherForecast`) into
`resolveTenantForecast(env, tenant, days?)`, called by the tool and by
`GET /api/propose/weather` (D9).

### D2 — Per-slot constraints are keyed by vibe id, and inert when the vibe isn't sampled

New `slots` param (tool + endpoint): an array of
`{ vibe_id, protein?, cuisine?, max_time_total?, vibe?, recipe? }`.

- **Keying:** by `vibe_id`, matching the mock's session shape (`slotProtein[vibeId]`, …) and the
  palette semantics — a pin conceptually attaches to "this vibe's night". A vibe drawn twice in a
  long planning window (bounded-multiplicity sampling) applies the same constraints to both of
  its slots; documented, consistent, and deterministic. Slot-index keying was rejected: indices
  reshuffle whenever `nights`/`seed`/the palette change, which would make replayed client
  sessions silently mis-target.
- **Inertness:** a constraint whose `vibe_id` is not in this week's sampled shape (or not in the
  palette at all) does nothing and errors nothing — a replayed offline session must survive a
  palette edit. Nothing about the request becomes invalid state.
- **Gate threading (W1-1):** `buildPool` already copies the vibe's `facets` and overwrites
  `max_time_total` from the global nudge. The precedence chain becomes: **slot pin > global
  `nudges.max_time_total` > the vibe's own facet**. `protein`/`cuisine` pins overwrite the vibe
  facet's values for that slot. `max_time_total` is **explicitly nullable**: `null` removes the
  time cap for that night (the mock's "Any time" pin lifts the vibe's own `max_time` facet),
  which absence cannot express.
- `exclude` still wins everywhere: an excluded slug never appears in a pool, an alternate, or a
  `recipe` pin (mirroring how locks already drop excluded slugs).

### D3 — Alternates fall out of the ranked pool; the recipe pin keeps vibe identity

**Alternates (W1-2)** are computed inside `assembleProposal` after all mains are chosen (the
pool and the week's `usedSlugs` are both in hand — no extra retrieval, no re-ranking):

- Per vibe slot, over its pool minus the week's used slugs and the slot's own main:
  - `alternates`: the top **6** by pool rank, as lites `{ slug, title, protein, cuisine,
    time_total }` (the mock's lite + time).
  - `alt_similar`: the candidate with max cosine to the chosen main (the "something similar"
    swap) — `null` when the pool is exhausted or the slot is empty.
  - `alt_different`: the highest-ranked candidate whose cuisine differs from the main's ("a
    different cuisine") — `null` when none.
- Alternates are **gate survivors by construction** (they come from `buildPool`'s facet-gated,
  reject-filtered pool) — the swap menu can never offer a rejected/unmakeable/pin-violating
  recipe. They deliberately ignore the MMR caps: a swap is an explicit member choice, and the
  next re-query re-diversifies around it.
- **Empty slots keep their alternates** (the pool may be non-empty when only the caps blocked a
  pick) — the mock's escape hatch for an over-constrained night.
- Locked slots (`lock`, vibe-less) have no pool → `alternates: []`, both alt fields `null`.

**Recipe pin (W1-2b, `slots[].recipe`)**: resolves case-insensitively against the index with
exactly the lock rules (must exist, be embedded, not rejected, not excluded — else the slot is
returned as an explicit empty slot with the lock-style reason, never silently dropped). A
resolved pin is admitted into the `DiversifyState` **up-front alongside the locks** (fixed picks
should shape the whole week's diversification, not just later slots), but is **returned in its
slot position with its vibe identity intact**: `vibe_id` and `reason` unchanged, `why` leads
with "your pick", and the slot carries `recipe_pinned: true`. This is what preserves `from_vibe`
provenance through the swap→commit path — the alternative (client re-sends the swap as `lock`)
detaches the recipe into a `vibe_id: null` locked slot and loses it.

### D4 — Freeform + vibe override + protein wants: bounded additive nudges, never gates

- **`nudges.freeform`** (week-level phrase): embedded once (D5), then applied inside every
  slot's ranking as a bounded additive term — `rankCandidates` gains an optional trailing
  `nudge?: { vec, weight }` parameter (absent for every existing caller, so `search_recipes` is
  bit-identical): `score += weight · cosine(nudgeVec, candidate)`. Default weight **0.15** — the
  `favoriteWeight` scale, deliberately subordinate to the primary vibe cosine so a phrase steers
  the week without capsizing relevance (mirrors the mock's `0.14`). When the chosen main's
  freeform cosine clears a small floor, `why[]` gains `matches your ask "<phrase>"`.
- **`slots[].vibe`** (per-night typed phrase / palette-preset pick): the embedded phrase
  **replaces that slot's query vector** wholesale; the slot's facet gate (vibe facets + pins)
  and identity (`vibe_id`, cadence provenance) are unchanged, and the response marks
  `vibe_override: true`. Side effect worth stating: a **not-yet-embedded fresh vibe** (whose
  slot is an explicit empty slot today) becomes fillable when the caller supplies its phrase as
  the override — the embed happens at request time instead of waiting for the cron tick.
- **`nudges.proteins`** (week-level, the mock's "proteins you want this week"): a bounded
  additive `+0.15` when the candidate's protein is in the set — soft, plural (multiple proteins
  allowed), never a gate (per-slot `protein` pins are the hard version). Adds a `why` line
  ("the <protein> you asked for") on mains it influenced.
- All three are **rank-only**: they reorder gate survivors and can never admit a gated-out
  recipe (the `holistic-use-it-up` coverage-term precedent, restated in the spec delta).

### D5 — The query-embedding cache: content-addressed KV, model-welded key, fail-open

Where request-time embeds live (plan §5 W1-3 says "hash-cache embeddings by text; design the
cache explicitly"):

- **Store: `KROGER_KV`** — the ephemeral-infra namespace (flyer rollups, feed cursors,
  rate-limit counters already live there). Rejected: D1 (this is a pure content-addressed cache
  with TTL semantics and no relational or per-tenant dimension — KV's exact role per the
  architecture; adding a table would also mean a migration for cache data), and `TENANT_KV`
  (identity-adjacent state only).
- **Key: `embed:<sha256-hex(EMBED_MODEL + "\n" + normalized)>`** where `normalized` =
  lowercase, trim, inner whitespace collapsed. Folding the model id into the hashed material
  welds the cache to `EMBED_MODEL` — a model change (which re-embeds the whole index anyway)
  orphans old entries to TTL expiry with no version constant to bump. SHA-256 via
  `crypto.subtle` (the P0 ETag-helper precedent), **not** `hashText` — the 8-hex FNV-1a is a
  change-detection key; a 32-bit collision here would silently serve the wrong *vector*, which
  unlike a skipped regenerate does not self-heal.
- **Value:** the raw JSON `EMBED_DIM`-float array (~14.3 KB, production-sized). Full precision,
  no rounding — the cache must return exactly what `embedTexts` returned, and it *strengthens*
  determinism: while an entry lives, every reroll of the same phrase uses the byte-identical
  vector (any fp noise across Workers AI invocations is frozen out).
- **TTL: 30 days**, fixed at put (no rolling re-put — an expiry costs one cheap re-embed).
- **Cross-tenant by design**: the vector is a pure function of a public model and the text —
  the flyer-cache precedent for deliberately non-tenant-keyed derived data. No tenant column
  exists to leak.
- **API + plug point:** `embedTextsCached(env, texts): Promise<number[][]>` in `embedding.ts` —
  KV-get each key, batch **all misses into one `embedTexts` call**, best-effort put-back. KV
  read/write failures **fail open** to the plain embed (the ingest limiter's posture — a KV
  hiccup must not break propose). Callers: the propose op (freeform + overrides in one batch)
  **and `search_recipes` ranked mode's vibe embeds** (`tools.ts`) — the MCP tool path benefits
  in the same pass, and a member's saved vibe phrase re-searched by the agent is a warm hit. The
  cron reconciles (`recipe-embeddings.ts`, `night-vibe-vector.ts`) stay on plain `embedTexts` —
  they are already hash-gated in D1 and never re-embed unchanged text.

### D6 — Tighten: a new draft rule in `draftProposals`, reusing the `adjust_cadence` kind

The deterministic sibling of the stretch heuristic (`reconcile-signals.ts`: `DEFER_FACTOR = 3`),
designed against the actual queue mechanics:

- **New read:** `readVibeSatisfactionDates(env, tenant): Map<vibeId, string[]>` (dates DESC) in
  `night-vibe-db.ts`, beside `readVibeLastSatisfied` (which is its MAX — the job now derives
  last-satisfied from the full map, one query instead of two). `draftProposals` takes the dates
  map; pure, unit-testable.
- **Rule:** for a vibe with `cadence_days` and **≥ 3 satisfactions** (⇒ ≥ 2 completed
  consecutive intervals): take the **2 most recent intervals**; when **every** one is
  `≤ cadence_days × TIGHTEN_FACTOR` (**0.5** — "well before cadence", the mirror of stretch's
  3×) **and** the vibe is currently on-track (`days_since(last_satisfied) < cadence_days` — a
  vibe that later went overdue must not get a tighten), draft
  `{ kind: "adjust_cadence", target: id, payload: { id, cadence_days: suggested } }` with
  `suggested = max(3, round(mean(recent intervals)))`, and only when `suggested <
  cadence_days` (else nothing — that would be a stretch). Stretch and tighten are disjoint by
  construction (stretch requires the *current* interval ≥ 3× cadence; tighten requires on-track).
- **Kind reuse, not a new kind** — decided and justified: `applyProposal` already applies
  `adjust_cadence` payloads, `proposalId` already buckets the suggested value
  (`round(cadence_days / 7)`) so a rejected tighten at ~the same value is **not re-surfaced**
  while a materially different later suggestion is a genuinely new proposal, and P1's queue UI
  already renders `adjust_cadence` as "Adjust to Nd / Dismiss". A `tighten_cadence` kind would
  buy nothing and cost a consumer-path fork on every surface. Direction lives in the rationale
  ("you keep cooking this well before its cadence — tighten to ~Nd?") and the evidence
  (`{ intervals_days, cadence_days, last_satisfied }`).
- **Producer stays `signal-cron`** — the plan's "a new producer into the same proposals queue"
  is satisfied by a new *signal source*; a distinct producer string would fragment queue
  provenance (the admin queue view groups by producer) for zero consumer benefit, since the
  deterministic tier is one job. Recorded as a premise interpretation.
- **Idempotence against re-drafting:** unchanged machinery — stable id + `INSERT OR IGNORE`
  (`enqueueProposal`); the same behavior window re-drafts the same id every tick, no-op.
- **Acceptance:** production has zero `satisfied_vibe` rows (spike) — no defect rows exist to
  converge, so the guard is validated by the unit matrix (boundary factors, the on-track guard,
  the disjointness with stretch, bucket-level dedupe) and the seeded harness, and verified in
  production organically as palettes fill in.

### D7 — `POST /api/propose` is a stateless read-shaped POST; the session is client-side only

- **Endpoint:** `POST /api/propose`, body = the full tool input (`nights`, `seed`, `lock`,
  `exclude`, `boost_ingredients`, `nudges{ max_time_total, variety, freeform, proteins }`,
  `slots[]`), response = the op's result shape. POST for body ergonomics, but semantically a
  pure read: no writes, safe to repeat, **neither** D8 write class (recorded against P1's
  normative table: the propose endpoint is exempt because it mutates nothing — commit rides
  P1's class (b) plan ops). Not ETag'd (POST bodies vary; the client caches by request key).
- **Client session** (the mock's `proposeSession`, kept faithfully): `{ seed, nights, lambda↔
  variety, proteinWants, freeform, locked{}, overrides{}, excluded[], slotProtein{},
  slotCuisine{}, slotMaxTime{}, slotVibe{} }` — persisted client-side (localStorage, per the
  mock), serialized into the request on every change, cleared on commit/reset. **No server-side
  propose-session state, ever** (plan §5 explicit non-work; §9 out-of-scope) — spec'd as a
  negative guarantee: same choices in, same week out *is* the session-resume mechanism.
- **Live re-query:** TanStack Query keyed by the canonical serialized request,
  `keepPreviousData` so the current week stays rendered (dimmed) while the re-roll computes —
  the plan's named UX requirement. Reroll = `seed + 1` (the mock), a new query key.
- **Request mapping:** UI lock (keep this pick on this night) → `slots[].recipe` for that vibe
  (identity-preserving, D3) — *not* the tool's `lock` array, which is reserved for the
  agent-style "keep this recipe somewhere" and detaches vibe identity; swap/pick-a-recipe →
  `slots[].recipe`; "not this one" → append to `exclude` (and clear that slot's pin); facet
  chips → `slots[].{protein,cuisine,max_time_total}`; "change the vibe" → `slots[].vibe`;
  slider → `nudges.variety`; phrase box → `nudges.freeform` (debounced, the mock's 400 ms).

### D8 — Commit maps filled slots onto P1's plan ops, client-assigning open dates

The mock's `commitWeek`, over the real contract: for each filled slot, a P1
`POST /api/plan/ops` `add` op — `recipe = main.slug`, `from_vibe = vibe_id` (the whole point of
the provenance thread: cooking it later stamps `satisfied_vibe`, which feeds cadence debt and
now the tighten signal), `sides` = the slot's corpus side **titles** (plan rows carry
open-world side strings — the same shape the agent persists), `planned_for` = the next open
dates within the planning window computed **client-side** over the already-cached plan (the
mock's behavior; pure date math, no new endpoint). Adds are P1 class (b) upserts keyed by slug —
replay-safe; committing a recipe already planned merges (the mock's "already in your plan"
toast). Commit then clears the client session and navigates to the plan page.

### D9 — Weather: one extracted op, one GET, and slot-level weather legibility

- `GET /api/propose/weather?days=` → `resolveTenantForecast` (D1 extraction): the tool's exact
  location resolution (`stores.location_zip`, else a ZIP parsed from `preferred_location`;
  `no_location` structured error otherwise) and `fetchWeatherForecast` shape
  (`{ location, forecast: [{ date, high_f, low_f, precipitation_chance, condition,
  meal_vibes }] }`). Session-gated GET, ETag'd by the shared middleware. The UI strip
  (`app-propose.css` `.wx-strip`/`.wx-day`) renders one card per day — dow, high/low,
  condition, derived category accent — with `no_location` rendering a quiet "set your ZIP in
  profile" chip, not an error page.
- **Slot weather-fit why:** `sampleWeek` today discards *which* category quota a sampled slot
  filled, so the proposal can't explain "fits this window's grill weather" — yet "weather fit"
  is a `why` example the living spec already names. `WeekSlot` gains an optional
  `category?: WeatherCategory` stamped when a slot is drawn from a non-`mild` category quota
  (flex/pinned/overdue slots carry none); the tool folds it into that slot's `why` and returns
  it as `weather_category` for the UI's chip. Pure annotation — allocation math untouched.

### D10 — Determinism holds across every new param ("same choices in, same week out")

Restated as the invariant the tests pin: identical request bodies (with the freeform/override
vectors served from cache, D5) produce identical responses — pins change pool membership and
therefore jitter assignment, but they are *inputs*; the seed still fully determines the week
given the inputs. Concretely: recipe pins admit in deterministic order (locks, then pins in
slot order); alternates derive from pool rank + used-set (no RNG); the freeform/protein terms
are pure additions inside the ranked blend; the tighten rule is pure arithmetic. New unit test:
the full request (all new params exercised, `env.AI` stubbed) run twice deep-equals.

### D11 — UI structure and deviations (recorded)

- Page `#/propose` (TanStack route `/propose`), entry points: meal-plan page header "Plan my
  week" + palette footer "Plan a week from these" (both deferred by P1 to P2).
- Faithful to the mock: intro/empty-palette states, controls row (nights stepper 2–6,
  adventurousness slider mapping `variety = 1 − λ` over the tool's clamped range, protein-want
  chips, freeform input), variety bar with commit, slot cards (lock, swap menu with
  similar/different/pick-list, exclude, facet chips + popovers, vibe panel with palette presets
  and typed phrase, why chips, side chips, flags incl. waste/meal-prep/no-corpus-side), empty
  slots showing their pins clearable in place.
- **Deviations:** (1) the weather strip is rendered from the real forecast endpoint (the mock
  ships only its CSS — the strip's markup is built to that CSS's spec); (2) slot "time" chips
  render `time_total`/pinned cap from the real field names; (3) the mock's `weatherWeight`
  soft-multiplier engine is **not** ported — the Worker's quota-based allocation is the real
  engine and the UI renders its output (`weather_category`, `why`); (4) alternates arrive from
  the endpoint instead of being recomputed client-side. No new design language; any restyle
  goes back through the Claude Design project per the repo rule.

### D12 — Playwright: the propose flow runs with zero model calls

- **Seed additions** (shared harness seed, P0/P1 machinery): a deterministic palette
  (`night_vibes` — production starts empty, so the seed is the only palette source),
  `night_vibe_derived` vectors and `recipe_derived` embeddings as **deterministic synthetic
  vectors** (equal dimension, distinct directions so cosine ordering is stable and asserted),
  plus a pantry with an at-risk perishable so `uses_perishables`/waste flags render.
- **The freeform spec pre-warms the KV embed cache**: the seed writes
  `embed:<sha256(model + "\n" + normalized phrase)>` for the exact phrase the spec types, so
  the freeform path is exercised deterministically as a cache **hit** — no `env.AI` in CI, and
  the cache read path itself gets browser-level coverage.
- **Specs:** empty-palette intro; first propose renders slots + variety bar + weather strip
  (weather stubbed/seeded via the harness's fetch fixtures, or the `no_location` chip state);
  same-session re-render stability (same request → same week); reroll changes the week;
  lock survives a reroll; a facet pin narrows a slot (and an over-constrained slot shows the
  empty state with clearable pins); swap-similar applies `alt_similar`; exclude refills;
  freeform (cache-warmed) reshapes and shows the "matches your ask" why; commit lands rows on
  the plan page with sides, dates, and (asserted via the plan read) `from_vibe`.
- Screenshots surfaced per area; the CI job stays blocking.

## Contract summary (tool + `/api/propose`, one contract)

New/changed **params** on `propose_meal_plan` and the endpoint body:

| param | shape | semantics |
| --- | --- | --- |
| `slots` | `Array<{ vibe_id: string, protein?: string, cuisine?: string, max_time_total?: number \| null, vibe?: string, recipe?: string }>` | per-vibe-slot constraints: facet pins into the slot's gate (pin > global nudge > vibe facet; `max_time_total: null` lifts the cap for that night); `vibe` = typed phrase replacing the slot's query vector (embedded, cached); `recipe` = identity-preserving pin filling the slot (lock resolution rules). Constraints for unsampled vibe ids are inert. |
| `nudges.freeform` | `string` | week-level phrase; embedded (cached), bounded additive rank term on every slot; never a gate |
| `nudges.proteins` | `string[]` | week-level soft protein boost; never a gate |
| `nudges.max_time_total`, `nudges.variety` | unchanged | now explicitly overridden per-slot by `slots[].max_time_total` |

New/changed **returns** per plan slot:

| field | shape | semantics |
| --- | --- | --- |
| `alternates` | `Array<{ slug, title, protein, cuisine, time_total }>` | top-6 remaining pool candidates (gate survivors, week-deduped); `[]` on locked slots |
| `alt_similar` | lite `\| null` | nearest by cosine to the chosen main |
| `alt_different` | lite `\| null` | highest-ranked different-cuisine candidate |
| `vibe_override` | `boolean` (present when true) | the slot's query vector came from `slots[].vibe` |
| `recipe_pinned` | `boolean` (present when true) | the main was pinned via `slots[].recipe` |
| `weather_category` | `WeatherCategory` (optional) | the non-`mild` quota this sampled slot filled; also folded into `why[]` |
| `why[]` | unchanged shape | new lines: "your pick", `matches your ask "<phrase>"`, protein-want, weather fit |

The tool description and `docs/TOOLS.md` drop the absolute "no Workers AI call" for: *at most
one batched embedding call per request, only for freeform/override text not served by the
hash cache; no text ⇒ no AI call.*

## Page → endpoint → op map (normative)

| page / interaction | endpoint | backing op (file) |
| --- | --- | --- |
| Propose (initial, reroll, any dial/pin/override change) | `POST /api/propose` | **extracted** `runProposeMealPlan` (`meal-plan-proposal-tool.ts` → shared op) |
| Weather strip | `GET /api/propose/weather` | **extracted** `resolveTenantForecast` (from the `get_weather_forecast` closure, `tools.ts`) |
| Commit | `POST /api/plan/ops` (P1) | `applyMealPlanRowOps` composition with `from_vibe` + client-assigned dates (D8) |
| Swap / pick-list / lock / pins / vibe change / exclude | — (client session → next `POST /api/propose`) | D7 request mapping |
| Empty-palette CTA | — (link to P1 palette page) | — |

## P0/P1 baseline assumptions (bound by role)

1. P0: session middleware yielding the resolved tenant on `/api`; shared error/ETag/build
   middleware; the app harness (seeded `wrangler dev`, page objects, blocking CI job).
2. P1: the per-area route-group + `hc` type-export idiom (`src/api/*`); the D8 write-class
   table (this change adds the propose endpoint as the recorded stateless exemption); plan ops
   (`add` with `from_vibe`, `set`) and the palette/queue pages; the per-route `TOOL_AE`
   analytics point (the propose routes inherit it — no new observability surface).

## Out of scope (explicit)

Server-side propose sessions (negative guarantee, spec'd); the derived to-buy view and
`place_order` UI (P3/W2); substitutions (W4) and aisle grouping (W5); trending/picked-for-you
(P4); offline persistence/replay hardening (P5) beyond keeping the session client-side and the
commit class (b); the admin SPA (P6); any change to `sampleWeek`'s allocation math (D9 is
annotation only); ranked member *search* in the app (the freeform embed is propose-scoped;
cookbook search stays keyword per P1 D6); re-tuning MMR/coverage defaults.

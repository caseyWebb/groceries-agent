# Design — member-app-offline

## Context

This is **P5** of the member web app plan (`docs/plans/web-app.md`, ratified; §11 defaults
confirmed 2026-07-07 — §11.3: prompt-to-reload). P0–P4 are the baseline: the SW scaffold and
version-skew contract (P0), the query layer + D8 write classes (P1), the localStorage propose
session (P2), the to-buy view + online-only order commit (P3), the online-only substitutions
fetch (P4). The landed actuals this design binds to:

- `packages/app/src/main.tsx`: a bare `new QueryClient()` under `QueryClientProvider`;
  `registerSW({})` with the P0 comment "the callback seam is already here".
- `packages/app/src/lib/api.ts`: `csrfFetch` (the one shared fetch wrapper) + `APP_BUILD`
  (`import.meta.env.VITE_APP_BUILD ?? "dev"`), unread beyond its export.
- `packages/app/src/lib/data.ts` + route files: every query is `useQuery` with 15 s
  `staleTime`; every class (b) write is a plain `async` helper over `hc` (awaited, toasting),
  **not** a TanStack mutation — nothing pauses, nothing persists, nothing replays.
- `packages/app/src/routes/_app.tsx`: the loader `await`s whoami and throws on rejection —
  offline boot dies at the router today.
- `packages/app/vite.config.ts`: `VitePWA` with `registerType: "prompt"`, shell
  `navigateFallback`, a denylist mirroring `run_worker_first`, `globIgnores: ["admin/**"]`.
- `packages/worker/src/api/etag.ts`: `jsonWithEtag` emits `ETag` but no `Cache-Control`;
  `middleware.ts` stamps `X-App-Build` on every `/api` response; `GET /api/version` is live.
- `packages/worker/app/visual/`: the harness serves the **built** SPA (SW included — every
  spec already runs SW-registered in Chromium) from an unstamped build ("both sides read
  dev", `setup.mjs`).

All questions an implementer would otherwise resolve unilaterally are settled below (no spike
tasks remain). Versions were verified against the npm registry 2026-07-08 (D12); no
production-data spike applies — this change reads/writes no D1 shape.

## Goals / Non-Goals

**Goals:**
- Airplane-mode opens the app with the grocery list; check-offs made offline replay on
  reconnect (the plan's P5 acceptance) — including across an offline reload.
- The persistence boundary, the logout/identity purge, and the unreplayable-by-construction
  negative space are explicit, spec'd contracts — not config accidents.
- Prompt-to-reload update flow + version-skew surfacing (`X-App-Build` vs the embedded build
  id); real installability.
- Deterministic Playwright coverage with an honest split where browser tooling can't drive a
  path for real.

**Non-Goals:**
- No Worker op/tool/schema changes (one `Cache-Control` header line is the entire server
  diff). No conflict resolution beyond the landed §6 model — no CRDTs, no merge UI (plan §9).
- No offline *creation* surfaces beyond what replay gives class (b) writes (no offline
  propose, no offline ordering — those are online-only by design).
- No background sync / periodic sync APIs, no push notifications, no precaching of API data
  in the SW (explicitly rejected, D8).
- No admin-SPA work (P6); no new design language (D10 uses existing tokens).

## Decisions

### D1 — Persistence: a custom `idb-keyval` persister under `PersistQueryClientProvider`

localStorage is out per plan §6 (recipe bodies), and P0 D12 pre-named
`@tanstack/react-query-persist-client` + `idb-keyval`. Within that: the persister is the
TanStack-documented **`idb-keyval` structured-clone persister** (`get`/`set`/`del` of the
`PersistedClient` object under one key), *not* a JSON-string `asyncStoragePersister` — one
fewer dep (`@tanstack/query-async-storage-persister`), no double serialization, and IndexedDB
stores the dehydrated state natively. Concretes:

- **Key:** `cookbook-query-cache` in `idb-keyval`'s default store. One key, whole-client
  dehydration — the allowlist (D2) keeps it small (the index is ~200 lites; bodies are
  visited-only and gc-bounded).
- **Provider:** `PersistQueryClientProvider` replaces `QueryClientProvider` in `main.tsx`.
  It gates queries until restore completes, so a rehydrated page never renders an empty
  cache-miss flash, and its `onSuccess` runs `queryClient.resumePausedMutations()` (D4).
- **`buster`:** `APP_BUILD` (the embedded bundle id) — a new deploy's bundle discards the
  prior build's persisted state wholesale. Local dev/harness stamps make this inert or
  controlled (D11). The prompt-to-reload posture closes the queued-write loss window: replay
  fires on reconnect/restore *before* any member-initiated reload can swap the bundle, so a
  buster flush cannot strand paused mutations that had a chance to run (recorded risk).
- **`maxAge` 14 days**, and the allowlisted queries set `gcTime` 14 days (a persisted entry
  must outlive memory gc or it silently drops from the next dehydration; the plan's "a cached
  week-old bundle must keep working" sets the order of magnitude). Non-persisted queries keep
  the v5 default `gcTime`.
- **Failure posture:** persister errors (private mode, quota, IDB unavailable) are swallowed
  — the app degrades to online-only, exactly the P2 localStorage posture ("the session just
  won't survive a reload").

### D2 — The persistence boundary is an explicit allowlist (normative table)

`dehydrateOptions.shouldDehydrateQuery` accepts only key prefixes in one exported
`PERSIST_PREFIXES` list (module: `lib/persist.ts`); everything else is excluded **by
construction** — a future query is non-persisted until someone deliberately adds its prefix
(the discipline is spec'd, and the module comment carries it).

| query key | persist? | why |
| --- | --- | --- |
| `["grocery"]` + `["grocery","to-buy"]` | **yes** | the acceptance surface; the prefix covers both reads |
| `["pantry"]` | **yes** | plan §6 names it; in-store verify nudges |
| `["plan"]` | **yes** | plan §6 names it; sidebar count |
| `["cookbook","index"]` | **yes** | plan §6 names it; browse + favorites join |
| `["cookbook","recipe",slug]` | **yes** | plan §6 "visited recipe bodies" — visited-only by construction (only fetched bodies are in cache), bounded by 14 d gcTime |
| `["overlay"]` | **yes** | plan-§6 omission corrected: cookbook/favorites render and sidebar counts join favorites client-side |
| whoami / session | **never** | not even in the query cache (the loader fetches directly); identity persistence is D3's stamp, purged on logout |
| `["cookbook","search",q]` | never | unbounded key cardinality; offline search is out of scope |
| `["cookbook","similar",…]`, `["cookbook","notes",…]`, `["cookbook","new-for-me"]` | never | detail-page garnish; pages degrade gracefully offline |
| `["propose",…]`, `["propose-weather"]` | never | request-keyed/unbounded; live context; the propose *inputs* already persist as P2's localStorage session |
| `["profile"]`, `["retrospective",…]`, `["vibes"]`, `["proposals"]` | never | online flows (profile editing is class (a); suggest/confirm need the server); keeps member prose out of the at-rest cache. A missing profile query offline correctly hides the Kroger order affordance (it's online-only anyway) |

### D3 — Offline boot: a local identity stamp, and 401 vs network-failure disambiguated

The `_app` loader must distinguish "the server said no" from "there is no server right now":

- **Stamp:** login success and every successful whoami write `cookbook:tenant` (localStorage,
  the P2 idiom). It is a display/boot hint, never an authority — every online request still
  rides the cookie + server-side session.
- **Loader:** whoami `401` → **purge (D9) + redirect to `/login`** (a definitive rejection —
  revocation or expiry — must not leave member data at rest). Whoami *rejection* (network
  error / offline) → fall back to the stamped tenant and render the shell over the persisted
  cache; no stamp → redirect to `/login` (the SW serves it offline; its POST will fail with
  the existing "Couldn't reach the server" copy). Any other non-OK keeps today's throw.
- Login as a **different** tenant than the stamp purges before establishing the new session;
  same-tenant re-entry (the 90 d expiry case) keeps the cache — offline continuity is the
  point (D9).

### D4 — The class (b) mutation registry: `mutationKey` + defaults, serializable variables

`resumePausedMutations()` after a reload can only re-bind persisted **variables** to a
function registered under the same `mutationKey` — so every class (b) write moves from plain
`async` helpers into one registry (`lib/mutations.ts`) of `queryClient.setMutationDefaults`
entries, registered at module setup (before restore, necessarily). Call sites use thin
`useMutation({ mutationKey })`-wrapping hooks and **stop awaiting network settle for UI
progression** — offline, the mutation pauses and the optimistic update (or the pending row)
is the feedback. The registry, one row per D8 class (b) line (P1/P3 actuals):

| mutationKey | endpoint | variables (plain JSON) | call sites today |
| --- | --- | --- | --- |
| `["grocery","add"]` | `POST /api/grocery/items` | `{ name, quantity?, note?, source?, for_recipes? }` | add-row, materialize, buy-fresh (`_app.grocery.tsx`) |
| `["grocery","set"]` | `PATCH /api/grocery/items/:name` | `{ name, status \| quantity \| note … }` | `setInCart` (the acceptance write), mark-order-placed |
| `["grocery","remove"]` | `DELETE /api/grocery/items/:name` | `{ name }` | `removeItem`, clear-purchased loop |
| `["pantry","ops"]` | `POST /api/pantry/ops` | `{ operations }` | `_app.pantry.tsx` |
| `["pantry","verify"]` | `POST /api/pantry/verify` | `{ items }` | pantry + grocery pantry-covered nudge |
| `["overlay","favorite"]` | `PUT /api/overlay/favorite` | `{ slug, favorite }` | `setFavorite` (`lib/data.ts`) |
| `["plan","ops"]` | `POST /api/plan/ops` | `{ ops }` | plan page, recipe detail, propose commit |
| `["log","add"]` | `POST /api/log` | `{ type, recipe?/name?, date }` | log + recipe pages (server dedupes — D8's `(date,type,recipe\|name)`) |
| `["log","remove"]` | `DELETE /api/log/:id` | `{ id }` | log page |
| `["notes","add"/"edit"/"remove"]` | `POST`/`PATCH`/`DELETE …/notes[/:created_at]` | `{ slug, created_at, … }` (client-minted `created_at` — already D8) | recipe detail |
| `["vibes","add"]` / `["vibes","remove"]` | `POST /api/vibes` / `DELETE /api/vibes/:id` | vibe payload / `{ id }` | profile palette |
| `["proposals","confirm"]` | `POST /api/vibes/proposals/:id/confirm` | `{ id, accept }` | reconciliation queue |

Mechanics:

- **Defaults own the lifecycle:** `mutationFn` (the `hc` call, throwing the structured
  `ApiError`), `onMutate` optimistic cache edits where the offline UI needs immediate truth
  (grocery set/add/remove — the checked-off row must *look* checked in airplane mode — plus
  the existing favorite optimism), `onError` toast + rollback-by-invalidation, `onSettled`
  the area invalidations the helpers do today. Callbacks living in defaults is what makes
  them survive a reload (persisted mutations re-bind to them on resume).
- **Replay semantics:** `onlineManager` (v5's built-in online/offline listener) pauses
  in-flight class (b) mutations offline; reconnect auto-resumes them; restore-then-
  `resumePausedMutations()` (D1) replays queued writes from a previous launch — serially, in
  order. Replay convergence is already proven server-side (P1 task 7.13's route-level replay
  tests); a replay that the server rejects (e.g. a proposal already resolved) surfaces
  through the same `onError` toast + invalidation, matching D8's "converged" semantics.
- **Loops stay per-item:** clear-purchased / mark-order-placed already iterate row-wise; each
  item queues as an independent idempotent mutation (no batch envelope to invent).
- **Dehydration allowlist:** `shouldDehydrateMutation` = paused **and** `mutationKey` is in
  the registry — the suspenders on D5's belt.

### D5 — Unreplayable by construction: the online-only surfaces never enter the mutation cache

Three reinforcing layers, so no config drift can make a non-idempotent write replay:

1. **Not mutations at all:** the order preview/commit (P3 D7: a Kroger cart write
   accumulates), substitutions (P4 D12), vibe suggest (gated trigger), and session
   login/logout stay **direct `hc` calls** outside the mutation cache; propose is a *query*
   (P2 D7) and weather a query — and D2 excludes both from persistence. Class (a) `If-Match`
   writes (preferences, taste/diet markdown, vibe edits) also stay imperative: their
   read-fresh→precondition→rebase-on-412 loop *requires* a live server, and a queued stale
   `If-Match` would only ever 412 — offline, their editors are disabled with an offline hint
   (D10) and a plain attempt fails fast with the existing copy.
2. **The dehydrate predicate** (D4) refuses any mutation whose key isn't registered.
3. **The spec'd negative guarantee** (this change's spec) pins 1–2 against regression.

### D6 — ETag interplay: the browser HTTP cache owns revalidation; one `Cache-Control` line makes it deterministic

The SPA never sends `If-None-Match` itself — the browser attaches the stored validator and
**synthesizes a full 200 from a 304**, so `queryFn`s always see complete bodies. Therefore:
the persisted query cache carries **data only, never ETags**; a 304 against a rehydrated
cache cannot render empty (the body comes from the browser HTTP cache; if that was evicted
the request is simply unconditional). What is *not* guaranteed today is storage itself:
`jsonWithEtag` emits no `Cache-Control`, so keeping the validator is heuristic. This change
stamps **`Cache-Control: private, no-cache`** in `jsonWithEtag` — store, but always
revalidate: 304s stay cheap and deterministic, per-tenant bodies never land in a shared
cache, and class (a)'s `readWithEtag` reads are always validated-fresh at the server before
their `If-Match` write. (The 304 path already carries a fresh `X-App-Build` via the
`buildHeader` tail, and HTTP requires the cache to fold 304 headers into the stored response
— skew detection keeps working across 304s.) `docs/ARCHITECTURE.md`'s `jsonWithEtag` sentence
updates in the same pass.

### D7 — Update flow: one prompt component, two triggers, member-initiated always

- **The prompt:** a `ReloadPrompt` rendered from `__root.tsx` (visible over both the login
  and app shells) on `useRegisterSW` (`virtual:pwa-register/react`) — replacing `main.tsx`'s
  bare `registerSW({})` (P0's designated seam). `needRefresh` → a quiet banner: "A new
  version is ready — **Reload**"; the action calls `updateServiceWorker(true)` (activate +
  reload). `offlineReady` → a one-shot "Works offline now" toast. **Nothing auto-reloads**:
  `registerType: "prompt"` means the new SW *waits* until the member acts (plan §2's
  never-mid-aisle rule) — there is no auto-activation path to suppress, only a prompt to add.
- **Skew trigger (the P0 contract's UX):** the shared fetch wrapper in `lib/api.ts` (the
  `csrfFetch` seam — every `hc` call already flows through it) reads each response's
  `X-App-Build`; when it and `APP_BUILD` are **both non-`"dev"` and differ**, it sets a
  module-level skew flag (subscribable, `useSyncExternalStore`) and fires a throttled
  `registration.update()` so the new SW downloads and `needRefresh` materializes. The banner
  renders on `needRefresh` **or** the skew flag (skew-only action: attempt the SW update,
  then reload — covers the header-arrives-before-SW-check window). The login page adds a
  one-shot `GET /api/version` on mount (P0 D11's stated pre-login purpose; a login screen
  makes no other request until submit).
- **Update checks, bounded:** `registration.update()` on `visibilitychange` → visible,
  throttled to once per hour, plus the skew trigger. **No polling loop** — plan §1's
  zero-marginal-cost posture; the passive header tap costs nothing.

### D8 — SW hardening: explicit precache, no API runtime caching, a denylist drift gate

- **Precache:** `globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"]` (explicit — the
  Workbox default omits images, which would leave the icons out of the offline shell);
  `globIgnores: ["admin/**"]` unchanged (the admin bundle is never the member app's to
  cache).
- **No `/api` runtime caching — a spec'd negative guarantee.** The query persister is the
  *only* client cache of API data. A Workbox `runtimeCaching` route over `/api` would
  double-cache with invisible staleness, mask 401s, and break the two-writer
  freshness posture (§6's short-staleTime + refetch-on-focus). `/api` requests keep passing
  through the SW untouched (no `respondWith`) — which is also what makes them offline-fail in
  the page context, the exact behavior layers 2–3 are built on.
- **`navigateFallbackDenylist`:** verified complete against `wrangler.jsonc`'s
  `run_worker_first` at authoring (P3/P4 added only `/api/*` subpaths — already covered; the
  `(\/|$|\.)` tail covers `/health.svg`). The correspondence becomes a **tooling drift test**
  (`packages/worker/tests/`, `node --test`): parse `run_worker_first` from `wrangler.jsonc`
  and the denylist regex from `packages/app/vite.config.ts`, assert every Worker-owned
  top-level prefix matches the regex — so P0's "same change" discipline rule gets a gate, not
  just prose. The browser-level half: the passthrough spec now asserts `/cookbook` + `/health`
  are Worker-rendered **while SW-controlled** (D11).

### D9 — The purge: one function, three call sites

`purgeLocalMemberData()` (`lib/persist.ts`): `del(cookbook-query-cache)` (IndexedDB),
`queryClient.clear()` (queries **and** mutations — queued writes from a prior member must
never replay into a new session), remove `cookbook:tenant` + `cookbook:propose-session`
(P2's session is member data too). The theme key survives (device preference, not member
data). Call sites: **logout** (before navigating to `/login`), **login as a different
tenant** (stamp mismatch, before the session POST resolves into a redirect), **definitive
401 at boot** (D3). Not called on transient errors, never on network failure — an offline
device keeps its member's own data, which *is* the feature; the shared-device guarantee is
tied to the deliberate identity events.

### D10 — Offline UX affordances (recorded deviations, existing design language)

- An **offline pill** in the app shell (subscribing to `onlineManager` via a `useOnline()`
  hook): "Offline — changes sync when you're back", `data-testid` for the harness.
- Online-only affordances **disable with an offline hint** while offline: the order
  preview/commit button, substitutions button, vibe suggest, the class (a) editors
  (preferences/taste/diet/vibe-edit forms), propose's re-roll. Class (b) surfaces stay fully
  interactive (that's the point).
- The **"Install app"** account-menu item renders only when a captured
  `beforeinstallprompt` exists and `display-mode: standalone` doesn't match; tapping it
  fires the stored prompt. iOS gets no affordance (no event exists — honest; the manifest +
  `apple-touch-icon` make Add-to-Home-Screen work).
- These are small chrome pieces composed from existing Basecoat/shadcn tokens (toast, banner,
  badge, menu item) — the P1 D7 posture: smallest deviation, **flagged for a future Claude
  Design pass** rather than winging new design language.

### D11 — Playwright posture: the acceptance runs for real; the one undrivable path gets an honest split

Grounded: the harness **already** runs SW-controlled (the built `sw.js` ships in `assets/`
and registers in Chromium — P0 landed that, silently). Two properties make the airplane-mode
acceptance deterministic: navigations are answered by the SW **from precache** (no network
touched), while `/api` fetches pass through un-`respondWith`'d into the **page's** network
stack — where `context.setOffline(true)` applies. The known Playwright/SW quirks are about
*interception* (`page.route` can't see SW-mediated traffic), so: the offline spec never
routes `/api`; the skew spec blocks SWs.

- **`setup.mjs` stamps both sides with one id** (`VITE_APP_BUILD=pw-harness` on the vite
  build, `--var APP_BUILD:pw-harness` on `wrangler dev`) — replacing the unstamped posture.
  Baseline specs see no skew (ids equal); the skew spec can now fabricate a difference; the
  persister's buster is exercised with a real value.
- **`offline.spec.ts`** (the acceptance, SW allowed, no routing):
  1. Log in, open grocery (seeded rows render), `await navigator.serviceWorker.ready`,
     reload once (the page becomes SW-controlled; `clientsClaim` is off under the prompt
     posture).
  2. Wait for the persisted client in IndexedDB to contain the grocery query (poll via
     `page.evaluate` over raw `indexedDB` — deterministic, no timeout guessing; the persister
     throttles at ~1 s).
  3. `context.setOffline(true)` → `page.reload()` → **assert the shell + grocery list render
     from the restored cache** and the offline pill shows (airplane-mode acceptance, leg 1).
  4. Check off an item → optimistic state asserts; the mutation is paused (assert via the
     pill/pending state, not internals).
  5. `context.setOffline(false)` → the paused mutation resumes → poll until the server-backed
     read shows `in_cart` (asserted through the browser's own `fetch` — the P1 harness
     finding: the `__Host-` cookie doesn't ride Playwright's request context over http)
     (acceptance, leg 2).
  6. The across-reload variant: check off while offline, reload (still offline — the
     persisted *mutation* restores), reconnect, assert replay lands.
- **`update.spec.ts`** (skew banner, `test.use({ serviceWorkers: "block" })` so `page.route`
  is classical): fulfill an `/api` response with `X-App-Build: something-else` → the banner
  renders; click Reload → navigation happens; ids equal → no banner. **Honest split,
  recorded:** a genuinely *waiting* second SW build is not fabricated in the harness (it
  would need two full builds swapped mid-test); the `needRefresh` trigger is
  library-provided (`vite-plugin-pwa`'s `registerSW` contract) and drives the **same** banner
  component + action the skew flag drives, which the spec does exercise. The SW-side offline
  reality (precache serving the shell) is asserted for real by `offline.spec.ts` step 3.
- **`passthrough.spec.ts` extended:** visit `/` first (SW registers + controls), then assert
  `/cookbook` and `/health` are Worker-rendered — the browser-level denylist gate (D8's
  static drift test is the config-level one).
- **Purge spec** (in the login/session spec family): logout → the IndexedDB key is gone and
  localStorage carries no `cookbook:tenant`/propose session.
- No new registry area (offline is behavior over existing areas); the offline grocery render
  captures a review screenshot inside its spec (`grocery-offline`).

### D12 — Versions (registry-verified 2026-07-08; plan §8 posture unchanged)

| package | landed | latest | action |
| --- | --- | --- | --- |
| `vite-plugin-pwa` | ^1.3.0 (lockfile 1.3.0) | 1.3.0 | none — current; Workbox pinned family resolves 7.4.1 |
| `workbox-*` | 7.4.1 | 7.4.1 | none |
| `@tanstack/react-query` | ^5.101.2 | 5.101.2 | none |
| `@tanstack/react-query-persist-client` | — | 5.101.2 | **add** `^5.101.2` (versioned in lockstep with query — same monorepo) |
| `idb-keyval` | — | 6.2.6 | **add** `^6.2.6` |

Both additions are pure-JS, dependency-light (idb-keyval has zero deps), and ship no build
scripts — no `aube.allowBuilds` entry is expected (confirm at `aube install`, per the
`package-manager` clean-install rule; record if the install surfaces otherwise).

## Risks / Trade-offs

- **Replay is last-write-wins against the agent** (a check-off queued for hours lands late)
  → accepted by design: plan §6 chose class (b) exactly so replay never 412s; writes are
  explicit target states keyed on canonical ids, so the blast radius is one row converging to
  what the member actually did.
- **A build-id change discards queued mutations (buster)** → bounded by prompt-to-reload:
  replay fires on reconnect/restore before any member-initiated reload can swap bundles; the
  loss window requires closing the app offline with queued writes *and* accepting an update
  before the queue drains — and the prompt never auto-fires. Accepted, recorded.
- **Restored optimistic state without its mutation** (persister throttling means the last
  ~1 s can lag) → worst case the restored UI briefly shows pre-write state; the queued
  mutation (persisted in the same snapshot) or the reconnect refetch converges it. No
  correctness loss — the server is the truth, the cache is a display buffer (P1's posture).
- **IndexedDB unavailability (private mode, storage pressure)** → persister no-ops
  (swallowed), app degrades to online-only; the boot stamp lives in localStorage with its own
  try/catch, same degradation.
- **SW-in-harness flake surface** → the offline spec's waits are all condition-polls
  (`serviceWorker.ready`, the IDB key's content, the server read) — no fixed sleeps; the
  quirk-prone combinations (routing + SW) are structurally avoided (D11). If Chromium's
  `setOffline` semantics ever change for pass-through SW fetches, the spec fails loudly, not
  silently green.
- **Two more render-path providers in `main.tsx`** (persist provider, prompt component) →
  trivial; restore gating adds one frame of splash on cold start, invisible next to network.

## Migration Plan

1. One PR: persistence layer + mutation registry + boot/purge (app), the `Cache-Control`
   line (worker), SW/manifest/vite config + prompt + install chrome, harness + tooling test,
   docs — ordered app-core-first in tasks so the acceptance spec lands against the finished
   client.
2. No D1 migration, no KV/R2 shape change, no deploy-workflow change. Client-device state
   (IndexedDB, localStorage stamps) needs no migration: absent keys mean the pre-P5 behavior
   (online-only) until first use populates them.
3. Rollback: revert the PR — persisted caches from the P5 build are simply never read again
   (the old bundle has no persister); stale IndexedDB data ages out by `maxAge` or the next
   login purge. No server-side state to unwind.

## Open Questions

None — persistence boundary, purge semantics, mutation serializability, online-only negative
space, ETag interplay, SW/update/skew mechanics, install posture, harness determinism, and
versions are all settled above against the landed code.

## Implementation notes (recorded during implementation)

- **Serial replay needed a mutation scope.** v5's `resumePausedMutations()` continues paused
  mutations with `Promise.all` (concurrent), and the reconnect resume is likewise unordered —
  D4's "replays serially, in order" is therefore enforced with ONE shared mutation `scope`
  (`{ id: "class-b-writes" }`) applied to every registry row's defaults. Scope is dehydrated
  with the mutation (verified in query-core's hydration), so the ordering survives a reload;
  it also lets dependent fire-and-forget pairs (materialize → set in-cart on a virtual line)
  queue back-to-back without racing online.
- **Restore is followed by an invalidate-all (replay first).** The provider's
  `onSuccess` runs `resumePausedMutations().then(() => queryClient.invalidateQueries())` —
  the documented persist pattern — because a restored snapshot can be YOUNGER than
  `staleTime` yet stale against the server (observed in the harness: a raw-API write plus
  an immediate reload rendered the pre-write snapshot with no refetch). Restored data
  still renders instantly and an offline boot still makes zero requests (the
  invalidation's fetches pause); on/at reconnect the refetch always lands AFTER the
  queued replay, preserving convergence order.
- **`onlineManager` is seeded from `navigator.onLine` at boot** (`lib/online.ts`, imported
  for its side effect by `main.tsx`). v5's manager boots `online = true` and flips only on
  window events — after an offline LAUNCH no event ever fires, so without the seed the queue
  would not pause and the pill would not show on exactly the airplane-mode boot path this
  change exists for. Seeding false-only (`!navigator.onLine`) sticks to the reliable
  direction of that API.
- **The purge and the persister's empty snapshot.** `purgeLocalMemberData()` deletes the IDB
  key and clears the client per D9, but the still-running persister lawfully re-writes an
  EMPTY snapshot when `clear()`'s cache events flush through its ~1 s throttle. The at-rest
  guarantee is therefore "no member data" (key absent OR zero queries/mutations), which is
  what the purge spec asserts — both states are stable on the login screen.
- **The aisles-enriched to-buy read did NOT ride the shared wrapper** (it was a bare
  `fetch`), contrary to the change brief's recollection — it now uses the exported `appFetch`
  so the skew tap sees it.
- **`ensureFavorite` (named in the implementation brief as a P4 actual) does not exist at
  HEAD** — the landed favorite write is the plain optimistic explicit-set helper; its
  semantics (explicit target state + optimistic overlay flip + settle-time invalidation of
  overlay and picked-for-you) are preserved verbatim in the `["overlay","favorite"]` registry
  row. Rapid double-clicks converge because both queued mutations carry explicit states.
- **D4-scoped optimism only.** Optimistic `onMutate` edits cover grocery add/set/remove and
  the favorite flip exactly as D4 lists; other class (b) surfaces (plan, pantry, log, notes,
  vibes, proposals) stay interactive offline and queue, with the pill + queued replay as
  feedback — the spec's "optimistic state where the page renders the written row" is read
  through D4's narrower, binding list.

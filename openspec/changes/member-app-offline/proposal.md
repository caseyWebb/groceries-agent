# Proposal — member-app-offline

## Why

The member web app plan (`docs/plans/web-app.md`, §10 phase P5 / §6 offline layers / §2
serving & version skew / §11.3 prompt-to-reload) calls offline "the killer feature" and
defines it as three library-provided layers: the SW-precached shell (P0 scaffolded it), an
IndexedDB-persisted query cache, and paused-mutation replay on reconnect. P0–P4 deliberately
deferred the last two plus the update-prompt UX, install UX, and the client side of the
version-skew contract. Acceptance for this phase, verbatim from the plan: **airplane-mode
opens the app with the grocery list; check-offs made offline replay on reconnect.**

The groundwork is unusually ready-made — P1's D8 write-class table exists *for* this change
(every class (b) write is an explicit-set idempotent upsert keyed on a canonical id, so
replay converges by construction; the Worker's route tests already replay every shape), and
P3 D7 / P4 D12 already classified the order commit and the substitutions fetch **online-only**
so this change can make them unreplayable by construction rather than by convention.

Grounding against the landed code corrected and sharpened the premises:

- **The boot check is online-only today.** `packages/app/src/routes/_app.tsx`'s loader
  `await`s the whoami GET and throws on rejection — in airplane mode the app would die at the
  router before any persisted cache could matter. P5 must design the offline boot path (a
  last-known-identity fallback), not just bolt a persister on; the plan's layer list doesn't
  mention it.
- **No class (b) write is a TanStack mutation yet.** Every call site is a plain `async`
  helper over the `hc` client (`lib/data.ts` `setFavorite`/`applyPlanOps`, per-page helpers in
  the route files) that `await`s the response and toasts. Paused-mutation replay after a
  reload requires serializable mutations — `mutationKey` + `setMutationDefaults` so
  `resumePausedMutations()` can re-bind persisted variables to a function — so the write layer
  is restructured into a small mutation registry; the D8 table maps one-to-one onto it.
- **The plan's §6 persist list is incomplete for its own pages.** It names the grocery list,
  pantry, meal plan, cookbook index, and visited recipe bodies — but the cookbook and
  favorites pages join the **overlay** (favorites/rejects) client-side, and the shell's
  sidebar counts read overlay + plan + grocery. Overlay joins the allowlist; conversely
  whoami/session state, search results, propose results, and weather must **never** persist
  (design D2's boundary table).
- **The ETag machinery needs one server-side line, not client plumbing.** The SPA never sends
  `If-None-Match` itself — the browser HTTP cache owns conditional revalidation and
  synthesizes a full 200 from a 304, so the persisted query cache never needs to carry ETags
  and a 304 against a rehydrated cache cannot render empty. But `jsonWithEtag` today emits no
  `Cache-Control`, leaving browser storage of the validator *heuristic*; stamping
  `Cache-Control: private, no-cache` makes store-then-revalidate deterministic (design D6).
- **The harness already runs SW-controlled** (the built `sw.js` ships in `assets/` and
  registers in Playwright's Chromium), and `/api` requests pass *through* the SW without
  `respondWith` — so `context.setOffline(true)` applies to them while navigations serve from
  precache. The airplane-mode acceptance is drivable for real; the one thing that is not
  (a genuinely *waiting* second SW build) gets an honest split (design D11).
- **Versions verified against the registry (2026-07-08):** the landed `vite-plugin-pwa` 1.3.0
  and `@tanstack/react-query` 5.101.2 are both current; Workbox resolves at 7.4.1. The two
  new deps P0 D12 pre-named — `@tanstack/react-query-persist-client` (5.101.2, versioned in
  lockstep with query) and `idb-keyval` (^6.2.6) — are pure JS, no build scripts. No bumps
  needed (design D12).

## What Changes

- **Layer 2 — persisted reads:** the query cache persists to IndexedDB via a small
  `idb-keyval` persister (structured clone — no JSON-string double-serialization) under
  `PersistQueryClientProvider`, restore-gated so pages never flash empty before rehydration.
  Persistence is an explicit **allowlist** (grocery + to-buy, pantry, plan, overlay, cookbook
  index, visited recipe bodies) with everything else excluded by construction — session
  state, search results, propose results, weather, profile, vibes/proposals, log,
  retrospective. `maxAge`/allowlisted `gcTime` 14 days; `buster` = the embedded build id.
- **Local-data lifecycle:** one `purgeLocalMemberData()` clears the persisted cache, the
  in-memory query/mutation caches, the propose session, and the identity stamp — invoked on
  logout, on login as a *different* tenant, and on a definitive 401 at boot. A shared device
  never leaks a prior member's persisted cache.
- **Offline boot:** login (and each online whoami) stamps the tenant locally; the shell
  loader distinguishes a *definitive* 401 (redirect + purge) from a *network* failure
  (offline: fall back to the stamped identity and render the shell over the persisted cache).
  No stamp + no network → login page (which the SW serves offline).
- **Layer 3 — write replay:** every class (b) write becomes a registered TanStack mutation
  (`mutationKey` + `setMutationDefaults`, plain-JSON variables): grocery add/set/remove,
  pantry ops/verify, favorite set, plan ops, log add/delete, notes add/edit/delete, vibe
  create/delete, proposal confirm. Offline they pause (`onlineManager`), persist across
  reloads, and replay serially on reconnect/restore; optimistic cache updates keep the
  offline UI truthful. The online-only surfaces — order commit/preview (P3 D7), substitutions
  (P4 D12), propose, vibe suggest, session login/logout, and every class (a) `If-Match`
  write — never enter the mutation cache at all (they stay direct `hc` calls), and a
  dehydrate allowlist predicate refuses anything unregistered: unreplayable by construction,
  spec'd as a negative guarantee.
- **Update flow (prompt-to-reload):** a reload prompt over `useRegisterSW` — a waiting SW or
  a detected build skew renders a banner whose *member-initiated* action applies the update;
  nothing ever auto-reloads mid-aisle. Skew detection is passive: the shared fetch wrapper
  compares each response's `X-App-Build` against the embedded bundle id (both non-`"dev"`),
  plus a one-shot `GET /api/version` on the login screen; a skew triggers an SW update check.
  No polling loop (cost posture §1).
- **SW hardening:** explicit precache globs (icons included, `admin/**` still excluded), the
  standing **no runtime caching for `/api`** negative guarantee (the query persister is the
  only API-data cache), and a tooling drift test pinning that every `run_worker_first` prefix
  in `wrangler.jsonc` stays covered by the SPA's `navigateFallbackDenylist`.
- **Install UX:** real installability — PNG icons (192/512 + maskable) and an
  `apple-touch-icon` beside the existing SVG, and an "Install app" account-menu item shown
  only when the browser offers `beforeinstallprompt` and the app isn't already standalone.
- **Worker (one line + docs):** `jsonWithEtag` adds `Cache-Control: private, no-cache`;
  `docs/ARCHITECTURE.md`'s member-app section gains the offline posture (layers, boundary,
  purge, negative guarantees) in the same pass.
- **Playwright:** the harness stamps **both** sides with one non-`"dev"` build id (skew stays
  inert at baseline but becomes testable); a new offline spec drives the real acceptance
  (airplane-mode open → grocery renders from IndexedDB → offline check-off → reconnect →
  replay lands server-side, plus the across-reload paused-mutation variant); a skew spec (SW
  blocked so interception is classical) drives the update banner; the passthrough spec is
  extended to assert Worker routes under SW control.

## Capabilities

### New Capabilities

- **`member-app-offline`** — the member app's offline/PWA contract: the persisted-read
  allowlist and its lifecycle (buster, maxAge, logout/identity purge), the offline boot path,
  class (b) mutation queue/replay with the unreplayable-by-construction negative space, the
  prompt-to-reload update flow and version-skew surfacing, SW precache/no-API-cache
  guarantees, install UX, and the deterministic Playwright offline posture.

### Modified Capabilities

None. The P0–P4 member-app capability specs are still pending changes (not yet living), so
their interlocking behaviors are recorded here and in design.md rather than as deltas; the
living specs (`grocery-list`, `meal-planning`, …) are untouched — this change adds no Worker
op, no tool, no schema, and no status semantics.

## Impact

- **`packages/app`:** `src/main.tsx` (`PersistQueryClientProvider`, mutation-defaults
  registration, restore→resume wiring), new `src/lib/persist.ts` (persister, allowlists,
  purge, identity stamp) + `src/lib/mutations.ts` (the class (b) registry), `src/lib/api.ts`
  (fetch-wrapper `X-App-Build` tap), `src/lib/data.ts` and the route files (call sites
  restructured onto the registry hooks; offline pill; install menu item; reload prompt in
  `__root.tsx`), `vite.config.ts` (precache globs, manifest icons), `index.html`
  (apple-touch-icon), `public/` (PNG icons), `package.json` (+2 deps).
- **`packages/worker`:** `src/api/etag.ts` (`Cache-Control` stamp — one line);
  `app/visual/` (setup stamping, `offline.spec.ts`, `update.spec.ts`, passthrough extension,
  shell page-object affordances); `tests/` (denylist↔`run_worker_first` drift test).
- **Docs:** `docs/ARCHITECTURE.md` (member-app offline posture + version-skew UX). No
  `docs/TOOLS.md`/`docs/SCHEMAS.md` change (no tool, no stored-shape change — IndexedDB and
  the localStorage stamps are client-device state, not operator data).
- **No migration, no new binding, no deploy-workflow change** (the deploy already stamps
  `VITE_APP_BUILD`/`APP_BUILD`; CI path filters already cover `packages/app/**`).

## Dependency

**Requires P0 (`member-app-foundations`) through P4 (`member-app-differentiators`) to have
landed.** From P0: the SW scaffold (`registerType: "prompt"`), the version-skew contract
(`X-App-Build`, `GET /api/version`, `VITE_APP_BUILD`), `jsonWithEtag`, the harness. From P1:
the D8 write classes (this change's replay table is D8's, verbatim) and the route-level replay
convergence tests. From P2: the localStorage propose session (purged with member data) and the
propose POST's read-shaped exemption. From P3: the to-buy view (the offline grocery page
renders it) and the order commit's online-only classification. From P4: the substitutions
surface's online-only classification (P4 is ratified with implementation in flight — this
change binds to its landed actuals; its D12 row is already fixed). Tasks name these pieces by
role; the implementer binds to the landed code.

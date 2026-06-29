# Tasks

## 0. Resolve the island-runtime gate
- [ ] Confirm the Claude design system's distribution form (CSS/tokens · web components · React component library) — see design.md Open Questions
- [ ] Lock the island runtime: `hono/jsx/dom` (CSS/web-components) **or** Preact+`preact/compat` / real React (React components)
- [ ] If a React design system: spike the actual design-system components under the chosen runtime (render + hydrate) before Phase 1

## 1. Scaffold + Members thin vertical (pipeline proof)
- [ ] Add `hono` dependency; add `jsx: "react-jsx"` + `jsxImportSource: "hono/jsx"` to `tsconfig.json`
- [ ] Create the Hono admin app (`src/admin/app.ts`), `basePath('/admin')`, exporting its type for `hc`
- [ ] Port `requireAccess` to Hono middleware (reuse the function verbatim); preserve the opt-in / dev-bypass / email-allowlist posture
- [ ] Mount the app where `handleAdmin` is called (`src/index.ts:69`) **behind a flag/branch** so Elm still serves `/admin` until cutover
- [ ] Rewrite `scripts/build-admin.mjs`: esbuild island bundler → `admin/dist/admin/islands/*.js`; keep the `--check` drift gate; remove the Elm path (staged — full removal in Phase 5)
- [ ] SSR the Members list by calling the existing `src/` lifecycle/list functions directly
- [ ] Hydrate onboard / rotate / revoke as one island; wire mutations through `hc` typed routes that call the same `src/` functions
- [ ] Preserve the once-shown invite-code + connector-URL minting (never logged)
- [ ] Establish the TS discipline primitives: `Loadable`/RemoteData union, `assertNever`, `ts-pattern` `.exhaustive()`
- [ ] vitest coverage for the Members routes (`app.request(...)`) and the island

## 2. Tool Console — runtime-ceiling gate
- [ ] SSR the console shell + tool catalog via the same `buildServer` enumeration path the Elm console uses
- [ ] Port the schema-derived example generator and the JSONC arg tolerance (comment/trailing-comma stripping) to TS
- [ ] Hydrate the console as an island under the chosen runtime; invoke tools via a typed route returning the structured result/error verbatim
- [ ] Preserve the acting-persona guardrails (visible persona, no-invoke-without-persona, confirm-before-real-member)
- [ ] **Gate:** if the runtime strains on the dynamic forms, swap this island to Preact (data layer untouched) and record the decision

## 3. Read-heavy areas (SSR-only)
- [ ] Status home — SSR the `/health` payload rendering (headline, per-job rows, D1 row, admin-gate posture, never-run state, 503-is-data handling)
- [ ] Logs — SSR the source submenu + selected-source entries (master/detail)
- [ ] Data explorer — SSR the 5 entity views (recipes list/detail, members, corpus, discovery, system) by calling `admin-data.ts` directly
- [ ] Usage — SSR the usage / trends / tool-usage dashboards (`{ configured: false }` handling preserved)

## 4. Remaining interactive areas (islands)
- [ ] Config · Calibration — SSR the loaded config; island for the `Clean | Dirty | NeedsConfirm` form machine, Analyze, Dry-run, and confirm-gated Save (read the structured floor-breach error body to name the field — an improvement over the Elm `Http.BadStatus` wart)
- [ ] Config · corpus editors — SSR the 5 lookup tables; island for add/remove with one-at-a-time mutation state; feed-test action (read-only, no refetch)
- [ ] Logs actions — per-row Retry/Delete islands (one-at-a-time, reload on success) + the entry detail dialog
- [ ] Kroger-consent link action where it lives in the panel

## 5. Cutover + cleanup
- [ ] Flip `handleAdmin` → `admin.fetch` so the Hono app serves all of `/admin`; remove the transition flag/branch
- [ ] Remove `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm`, `scripts/test-admin.mjs` (Elm), and the pinned Elm compiler / `package.elm-lang.org` build dependency
- [ ] Finish `scripts/build-admin.mjs` (esbuild-only); confirm `aubr build:admin --check` passes; drop the Elm reachability concern from CI
- [ ] Repoint admin tests into the vitest run
- [ ] Rewrite `admin/CLAUDE.md` for the TypeScript discipline (discriminated unions, `Loadable`, exhaustiveness)
- [ ] Update `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` admin-build references in lockstep; confirm `repo-structure` (`admin/src` → committed `admin/dist`) still holds
- [ ] Rebuild and commit `admin/dist/`; `aubr typecheck` + `aubr test` green

## 1. Roster data plumbing

- [ ] 1.1 Resolve the `owner` source open question (design.md) and implement it (recommend an `OWNER_TENANT_ID` env var, surfaced as `Env`)
- [ ] 1.2 Add an `activatedAt` (or combined `lastSeenAt`) write at tenant-resolution time (`src/tenant.ts`), best-effort and write-once-if-absent so it adds no latency/failure risk to the MCP hot path
- [ ] 1.3 Add a Kroger-linked-status read (`kroger:refresh:<id>` existence in `KROGER_KV`) usable per tenant without a full token read
- [ ] 1.4 Add batched per-tenant aggregate reads for `cooked` (count of `cooking_log` rows) and `favorites` (count of `overlay WHERE favorite = 1`), grouped across all tenants in one query each (not N per-tenant queries)
- [ ] 1.5 Extend `listTenants` (`src/admin.ts`) to return a structured roster row per member (id, owner, status, kroger, joined/invited, lastActive, cooked, favorites) instead of `string[]`; update its return type and the `GET /api/tenants` route's response shape
- [ ] 1.6 Update `MembersIslandProps` (`src/admin/shared.ts`) to carry the structured roster rows

## 2. Roster presentation (SSR + island)

- [ ] 2.1 Rewrite `src/admin/pages/members.tsx`: stat-tile row (kit `StatCardGrid`/`StatCard`) computed from the roster rows, and an `Item`/`ItemGroup` roster (Avatar, badges, activity meta line) as the SSR first paint
- [ ] 2.2 Make each roster row a clickable link to `/admin/members/<id>` (kit `Item` as a link), with the per-row `DropdownMenu` actions stopping propagation so they don't navigate
- [ ] 2.3 Rework `src/admin/client/members.tsx`: replace the bare onboard `<form>` with a `Dialog`+`Field` invite flow; keep the existing `Banner`/`ActionState`/`Op` unions, wiring them to the kit dialog/dropdown instead of bare HTML
- [ ] 2.4 Wire the per-row `DropdownMenu` items (Rotate invite, Link Kroger/Re-link Kroger, Revoke with status-dependent label) to the existing `doRotate`/`doKrogerLink`/`doRevoke` handlers
- [ ] 2.5 After a successful mutation, refetch via the extended `GET /api/tenants` (now returning structured rows) and re-render the roster + stat tiles from the refreshed data

## 3. Member detail routes

- [ ] 3.1 Add `GET /admin/members/:id` and `GET /admin/members/:id/:section` SSR routes in `src/admin/app.tsx`, calling `memberDetail(env, tenantId)` directly (no island fetch)
- [ ] 3.2 Build the detail page component: header (username, owner/status/Kroger badges, activity stats) + pills sub-nav (plain links to each section's sub-route) + the selected section's content
- [ ] 3.3 Render Profile via `PrettyKV` (or the kit's nearest equivalent) over `memberDetail().profile`
- [ ] 3.4 Render Pantry and Cooking log via the kit `DataTable` over `memberDetail().pantry` / `.cooking_log`
- [ ] 3.5 Render Meal plan as its own row layout (planned-for date formatting, recipe link, sides) over `memberDetail().meal_plan`
- [ ] 3.6 Render Grocery as its own row layout (status dot, name/qty, source, for-recipes, note) over `memberDetail().grocery_list`
- [ ] 3.7 Render Notes as note cards over `memberDetail().recipe_notes` (and `store_notes` if in scope — confirm against the mock's single notes list)
- [ ] 3.8 Render the not-yet-connected empty state for a pending member (skip the sub-nav and the `memberDetail` read, or render it gracefully empty — confirm against 1.2's `status` derivation)
- [ ] 3.9 Confirm recipe-link targets (the mock's `openRecipe`) resolve to the Data area's recipe detail route (`/admin/data/recipes/<slug>`) for meal-plan/grocery/cooking-log/notes cross-links

## 4. Docs & contract lockstep

- [ ] 4.1 Update `docs/TOOLS.md`/`docs/SCHEMAS.md` if any tool-facing or D1-shape semantics changed (expect: none — this is admin-only plumbing over existing tables plus one new KV field)
- [ ] 4.2 Document the new `activatedAt`/`lastSeenAt` KV field and the `OWNER_TENANT_ID` env var in `docs/SELF_HOSTING.md` and/or `docs/ARCHITECTURE.md` as appropriate
- [ ] 4.3 Update `src/admin/CLAUDE.md` only if a new presentational pattern is introduced beyond what's already documented (expect: none — SSR sub-routes and kit composition are already-documented patterns)

## 5. Verification

- [ ] 5.1 `aubr typecheck` (both SSR and `client/tsconfig.json` passes)
- [ ] 5.2 `aubr test` covering the extended `listTenants`/roster aggregate reads and the new SSR routes
- [ ] 5.3 Manual check via `aubr dev`: roster stat tiles, row actions menu, invite dialog + banner, and member-detail deep links (including a pending member's empty state) render as designed

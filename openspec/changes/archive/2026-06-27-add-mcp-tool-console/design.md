## Context

The operator admin panel (`operator-admin`) just landed: a flat `Browser.element` SPA (`admin/src/Main.elm`) with two stacked cards (onboard, members), talking to `/admin/api/tenants*`. `src/admin.ts` handles all `/admin*` requests **worker-first** (`run_worker_first: ["/admin", "/admin/*"]`), gated by Cloudflare Access and opt-in (404 when `ACCESS_*` unset; `ADMIN_DEV_BYPASS=1` for local dev).

Separately, the MCP surface registers ~50 tools in `buildServer(env, tenant)` (`src/tools.ts`); `/mcp` validates an OAuth token, calls `resolveTenant` to re-check the id against the allowlist, and serves `createMcpHandler(buildServer(env, tenant))` (`src/index.ts`). A `Tenant` is cheap to build from just an id — `tenantFromRecord(env, { id })` derives the data repo + installation from `env` (`src/tenant.ts`).

To exercise a tool today the operator runs the stock MCP Inspector against `/mcp` and completes the OAuth dance (invite code → PKCE → access token) for a tenant — friction that exists even though they are *already* an authenticated operator at `/admin`. Constraints: the Elm modeling discipline in `admin/CLAUDE.md` ("make impossible states impossible"); `admin/dist/` is generated and needs `package.elm-lang.org` to rebuild; tools are throw-free and return structured errors (`src/errors.ts`); identity is a tenant id resolved before any tool runs.

## Goals / Non-Goals

**Goals:**
- In-panel inspection **and** invocation of the full tool surface, faithful to what `/mcp` does for the same tenant and arguments.
- No new credential — reuse the Access gate the operator already passed; choose which tenant to act as.
- A navigation shell that grows neatly: an Admin area (act on production) and a Dev area (a workbench), each surface a self-contained module, modeled so illegal navigation states don't typecheck.
- A **schema-driven** console: a newly registered MCP tool appears with zero console code.
- Dev ergonomics: act as different members / set up test personas to reproduce data-dependent behavior.

**Non-Goals:**
- Generating input **forms** from each tool's JSON Schema — v1 takes raw JSON args (the schema is shown read-only). Form generation is a later polish.
- A `readOnlyHint`/`destructiveHint` **effect annotation** pass across the tool surface — out of scope; the persona axis carries safety (see Decision 5).
- A new persona data model — a persona **is** a tenant; `test-*` naming distinguishes throwaway from real (Decision 5).
- Any change to a tool's contract or `docs/TOOLS.md` — the console reads the live `tools/list`.
- Seeding Kroger linkage for a synthetic persona (no per-tenant OAuth token → Kroger tools return their existing structured auth error; that is a faithful observation, not a bug).
- Exposing the console outside the Access gate / opt-in 404.

## Decisions

### Decision: Identity — the operator picks a tenant; Access is the credential

The admin surface is already cross-tenant and privileged (it onboards/rotates/revokes anyone) under Cloudflare Access. Invoking a tool "as casey" is within that existing trust, so the console resolves the chosen id through the **same** `resolveTenant(env, id, directoryFromEnv(env))` allowlist re-check the MCP path uses, yielding the same `Tenant`. The OAuth credential the operator skips (invite → PKCE → token) is replaced by the Access JWT they already presented.

- **Alternative — a real OAuth flow inside the panel** (mint a token per tenant): rejected. It reintroduces exactly the credential friction the operator wanted gone, and adds no safety — Access already authenticates them.
- **Alternative — a single synthetic "operator sandbox" tenant**: rejected. The operator wants to act as *different* members/personas to reproduce member-specific, data-dependent behavior; one sandbox can't.

### Decision: Invoke via the in-memory MCP transport, not a handler registry

Build `buildServer(env, tenant)` and link a `Client` to it through the SDK's `InMemoryTransport.createLinkedPair()`; `client.listTools()` produces the catalog, `client.callTool({ name, arguments })` invokes. This reuses the **exact** Zod validation, structured-error mapping (`errors.ts` → MCP content), and result serialization a real `/mcp` client gets — the console cannot drift from production behavior.

- **Alternative — extract every handler into a callable `Map<name, {schema, handler}>`**: rejected. It touches all 10 tool-registration modules, forks the execution path away from `/mcp`, and re-implements validation/serialization the SDK already does. `buildServer` is the single wiring point; keep it the only one.
- Note: `createMcpHandler` (the `agents` SDK's HTTP/SSE transport) is the network edge; `InMemoryTransport` is its in-process analog — no HTTP round-trip, no OAuth provider, same `McpServer`.

### Decision: Two-area shell; the page union owns its sub-model; persona is ambient Dev state

Migrate to `Browser.application`. A top-level `Route = AdminArea AdminRoute | DevArea DevRoute` parsed by `Url.Parser`; the model holds the current `Page` whose **variant carries that page's sub-model**, so "on the Tools page holding Members' state" is unrepresentable — the `admin/CLAUDE.md` prime directive applied to navigation. Members moves into `Admin/Members.elm` essentially unchanged; the console is `Dev/ToolConsole.elm`.

The Dev area's persona is **ambient**, not a per-call field: `type Workbench = NoPersona | Acting Tenant DevPage`, so a dev tool can't run against nobody, and the persona persists as you move between Dev pages.

Routes: `/admin` (or `/admin/members`) → Admin · `/admin/dev/tools` → the console · `/admin/dev/tools/<tool>` → a focused tool. The persona is model state set by the selector, with an optional `?as=<id>` initializer for shareable repros.

- **Alternative — state-only tabs (`Browser.element` + a `Section` field)**: rejected for this feature. A tool console wants deep links (share a tool / a repro) and refresh-stable URLs, and doing the `element → application` migration now (two surfaces) is far cheaper than later (six).

### Decision: Raw-JSON arguments in v1; the schema rendered read-only

~50 tools and growing ⇒ the input must be **open-set**. A JSON textarea validated server-side by the tool's own Zod schema needs zero per-tool code; the JSON Schema from `tools/list` is shown beside it for reference. This is the same "schema-driven, never hand-author per-tool UI" principle that keeps the *tool* axis from becoming button-soup, mirroring the shell that keeps the *feature* axis tidy.

- **Alternative — generate a form from each JSON Schema**: deferred to v2. JSON-Schema→form in Elm is real work; only the subset the tools actually use matters, and raw JSON unblocks the whole surface immediately.

### Decision: Safety rides the persona axis, not per-tool effect class

Always show an "acting as `<member>`" banner whenever a tool can be invoked, and require an explicit **confirm-before-run** when acting as a real member; a `test-*`/`sandbox-*` persona may bypass the confirm (the operator set it up as a throwaway). The operator picked the persona and reads the tool name — the dev-vs-real distinction is the boundary they already reason in.

- **Alternative — annotate all ~50 tools read/write/destructive and gate by effect**: deferred. It is a large surface change touching the tool contract, and the operator asked for MCP-Inspector-style parity (which gates nothing), not a safety console. v1 distinguishes real vs test by **naming convention**; a `kind` flag on `TenantRecord` is a possible later refinement (see Open Questions).

### Decision: Worker serves the SPA shell for client routes

`run_worker_first` already routes every `/admin*` request through `handleAdmin` first, so SPA fallback is entirely ours: for a GET that is neither an `/admin/api/*` route nor a real static asset, fetch `index.html` from `ASSETS` and return it `200` so a deep link / refresh to `/admin/dev/tools/place_order` loads the app. Crucially, **fetch** `index.html` rather than rewriting the URL to `/admin/index.html` — the existing comment in `src/admin.ts` documents that a rewrite re-enters `run_worker_first` and loops.

- **Alternative — `not_found_handling: single-page-application` in the assets config**: secondary. Keeping the fallback in the Worker leaves the Access gate unambiguously in front of every served shell and avoids depending on asset-handler precedence under `run_worker_first`.

## Risks / Trade-offs

- **Operator can read/mutate any member's data via the console** → It is behind Access + the opt-in 404 and validated by the same Zod schemas; the persona banner + confirm-on-real-member make the blast radius explicit. Write tools (`place_order`, `create_recipe`) fire real side effects — the confirm gate and the `test-*` convention are the mitigations. Documented in `SELF_HOSTING.md` as an intended host-trust capability.
- **A synthetic `test-*` persona has no Kroger token** → Kroger-dependent tools return their existing structured auth/`not_found` errors; the console surfaces them faithfully rather than special-casing. Data-layer tools (profile, pantry, recipes, meal plan, guidance, notes) work fully against a persona seeded *through the console itself*.
- **In-memory `Client`/`Server` lifecycle per request** → Construct, connect, call, and close within the request — no shared state, matching the stateless per-request server `/mcp` already builds. A connect/close failure maps to a 500 `upstream_unavailable`, consistent with the existing admin error path.
- **`Browser.element` → `Browser.application` migration** → Mechanical but touches the app root and the served shell. Do it as its own step with Members extracted unchanged first, so any regression is isolated to routing, not the console.
- **Bundle can't rebuild offline** → `admin/dist/` needs `package.elm-lang.org`. If unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md`; never commit a stale bundle.
- **Raw-JSON args UX** → Worse than a form; mitigated by showing the schema read-only and returning the tool's structured validation error verbatim. Acceptable for an operator/dev surface; forms are the v2 path.

## Migration Plan

Additive — no data migration, no new binding, no new secret, no dependency added (`@modelcontextprotocol/sdk` 1.29.0 already ships `InMemoryTransport` + `Client`).

Sequence:
1. **Worker** — the `/admin/api/tools` (GET list) and `/admin/api/tools/<name>` (POST invoke) routes, the in-memory invocation helper, and the SPA-shell fallback. Independently testable with `vitest`/`curl`; dark until the SPA ships, so it can land first behind the existing gate.
2. **SPA shell** — migrate to `Browser.application`, introduce the Admin/Dev nav + routing, extract `Admin/Members.elm` unchanged.
3. **Console** — the `Dev/ToolConsole.elm` surface (persona selector, catalog, args, result), then rebuild `admin/dist/`.

Rollback: revert the change — no persisted state to unwind. Unsetting the Access config returns the whole surface, console included, to 404.

## Open Questions

- **Real-vs-test persona signal:** naming convention (`test-*`) in v1 vs a `kind` field on `TenantRecord` (cleaner, but a directory-schema change and a write-path touch). Lean: naming convention now; revisit if personas proliferate.
- **`?as=<id>` in the URL:** best-effort initializer in v1 vs full persona-in-URL modeling (URL as the single source of truth for the persona). Lean: best-effort initializer now, full modeling later.
- **Result rendering:** pretty-printed JSON only (v1) vs typed rendering of the common `{ ambiguous, candidates }` and structured-error shapes. Lean: JSON v1.

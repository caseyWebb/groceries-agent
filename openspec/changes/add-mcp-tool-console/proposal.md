## Why

The operator admin panel (`operator-admin`) just landed as a flat `Browser.element` SPA — two stacked cards (onboard, members). It gives the operator no way to **inspect or exercise the ~50-tool MCP surface**: testing a tool today means standing up the stock MCP Inspector and grinding through the OAuth dance (mint an invite code → PKCE → access token) for some tenant — even though the operator is *already* authenticated at `/admin` behind Cloudflare Access. And the panel will keep accumulating surfaces; a flat card-stack has nowhere to put them without becoming button-soup.

This change adds an in-panel **MCP tool console** — browse the live catalog, invoke any tool as a chosen member, read the structured result — authenticated by the Access gate the operator already passed, with an "acting as" tenant picker standing in for the OAuth credential. It also introduces the **navigation shell** that lets the panel grow neatly: a top-level split between **Admin** (act on production, carefully) and **Dev** (a workbench — test freely, set up personas), the console being the first Dev surface.

## What Changes

- **Admin SPA → `Browser.application` with URL routing.** Replace the single `Browser.element` view with a two-area shell (Admin / Dev) and real routes (`/admin/members`, `/admin/dev/tools`, `/admin/dev/tools/<tool>`); extract the onboard+members UI into its own `Members` module under Admin. The current page **and its state** become one `Route`/`Page` union (each page owns its sub-model), per `admin/CLAUDE.md`.
- **NEW dev workbench — the MCP tool console (under Dev):**
  - A persona selector ("acting as: `<member>` ▾") populated from the existing tenant directory. The selected persona is **ambient Dev-area state**, not a per-tool field — modeled so "a tool runs against no persona" is unrepresentable.
  - A tool list rendered from the **live `tools/list`** (names, descriptions, input JSON Schemas) — schema-driven, so a newly registered MCP tool appears with zero console code.
  - An arguments input (raw JSON in v1, the schema shown read-only beside it), a Run action, and a structured result/error panel.
- **NEW admin API:**
  - `GET /admin/api/tools?tenant=<id>` → the tool catalog (`tools/list`) for the chosen tenant.
  - `POST /admin/api/tools/<name>` (body `{ tenant, arguments }`) → invoke the tool, return its structured result or error.
  - Both build an **in-memory MCP server** for the chosen tenant and drive it over the SDK's in-memory transport — the same validation + serialization path `/mcp` uses, so the console can't drift from real behavior.
- **Identity = the operator, via Access.** No new credential, no OAuth: the admin surface is already cross-tenant and Access-gated, so invoking a tool "as casey" is within the trust it already holds. The console resolves the chosen id through the same `resolveTenant` allowlist re-check the MCP path uses.
- **Persona-axis safety (not per-tool annotations).** A persistent "acting as `<member>`" banner, plus a confirm-before-run when acting as a real member (a `test-*` persona may bypass). No `readOnlyHint`/`destructiveHint` pass over the tool surface — the dev-vs-real-member distinction carries the safety.
- **Worker SPA fallback.** `handleAdmin` serves the SPA shell for unmatched, non-API `/admin/*` GETs so client routes deep-link and survive refresh. `run_worker_first: ["/admin", "/admin/*"]` already routes these worker-first, so this is fully in our control (fetch `index.html` directly, honoring the existing anti-redirect-loop note in `src/admin.ts`).
- **Inherits the existing gate.** The console is reachable only when the Access surface is configured (404 when unset) and under `ADMIN_DEV_BYPASS=1` for local `wrangler dev` — which is exactly the dev-panel use case.

## Capabilities

### New Capabilities
<!-- none — this extends the existing operator-admin surface rather than introducing a new capability -->

### Modified Capabilities

- `operator-admin`: **ADDS** the MCP tool console (live catalog + invoke-as-tenant over the in-memory transport), the operator-as-tenant ("acting as") identity model for tool invocation, and the two-area navigation shell; **MODIFIES** the static-assets requirement so the SPA is client-routed (`Browser.application`) with a Worker shell-fallback for deep links.

## Impact

- **Admin SPA (`admin/src/`):** `Main.elm` becomes a shell (`Browser.application`, routing, the Admin/Dev nav) plus new modules — `Admin/Members.elm` (extracted from today's `Main`), `Dev/ToolConsole.elm`, and shared `Api`/`Route` modules. Rebuilds the committed `admin/dist/` via `aubr build:admin` (needs `package.elm-lang.org`; if unreachable, leave the rebuild to CI per `admin/CLAUDE.md` rather than committing a stale bundle).
- **Worker (`src/admin.ts`):** new `/admin/api/tools` (GET list) and `/admin/api/tools/<name>` (POST invoke) routes; an in-memory MCP invocation helper (build a server for a resolved tenant, drive it via `InMemoryTransport` + `Client`); the SPA-shell fallback for non-API `/admin/*` GETs.
- **Reused, unchanged:** `buildServer` (`src/tools.ts`), `resolveTenant`/`tenantFromRecord` (`src/tenant.ts`), `requireAccess` (the Access gate). **No tool contract changes** — the console reads the live `tools/list`. No `migrations/`, no new binding, no new secret.
- **Dependencies:** none new — `@modelcontextprotocol/sdk` (1.29.0) already ships `InMemoryTransport.createLinkedPair()` and `Client`.
- **Docs:** `docs/SELF_HOSTING.md` (the operator dev console + the operator-can-act-as-member trust note); the `operator-admin` spec via this change's delta. (`docs/TOOLS.md` unaffected.)
- **Tests:** Worker — the `tools/list` shape and the invoke route against an in-memory server for a fake tenant (success, structured error, unknown tool, unknown/unauthorized tenant), and the SPA-fallback routing. Elm — the `Route` parser and the `Workbench` persona model (no-persona vs acting).
- **Security:** widens operator reach — read tools expose any member's domain data and write tools fire real side effects as that member. Appropriate for the self-hosted-host trust model; gated behind Access + the existing opt-in 404, validated by the same Zod schemas, and documented in `SELF_HOSTING.md`.

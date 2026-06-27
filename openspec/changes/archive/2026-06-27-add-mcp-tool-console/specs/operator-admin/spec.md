## ADDED Requirements

### Requirement: Operator tool console lists the live MCP tool surface

The admin surface SHALL expose `GET /admin/api/tools` returning the live MCP tool catalog — each tool's name, description, and input JSON Schema — derived from the **same** `tools/list` a real MCP client receives, by building the per-tenant tool server and enumerating it (not from a hand-maintained list). The catalog SHALL therefore reflect any tool the MCP surface registers, with no console-specific per-tool code. The endpoint SHALL require an `acting-as` tenant (query parameter), resolved against the allowlist by the same check tool invocation uses; the catalog *content* is tenant-independent, but resolving the tenant keeps listing and invoking uniformly gated.

#### Scenario: Catalog mirrors the MCP tool surface

- **WHEN** the operator opens the tool console acting as an allowlisted member
- **THEN** `GET /admin/api/tools` returns every tool the MCP server registers for that tenant, each with its description and input schema, matching what `/mcp`'s `tools/list` would return

#### Scenario: A newly registered tool appears without console changes

- **WHEN** a new tool is added to `buildServer` and the Worker is redeployed
- **THEN** the tool appears in the console catalog with no change to the admin API or the SPA

#### Scenario: Listing requires a resolvable tenant

- **WHEN** `GET /admin/api/tools` is called with a missing or non-allowlisted `acting-as` tenant
- **THEN** the surface returns a structured error and no catalog, the same resolution outcome as tool invocation

### Requirement: Operator tool console invokes a tool as a chosen tenant

The admin surface SHALL expose `POST /admin/api/tools/<name>` accepting `{ tenant, arguments }`, which invokes the named tool **as that tenant** by building `buildServer(env, tenant)` and driving it over an in-memory MCP transport, and SHALL return the tool's structured result or structured error **verbatim** — the same value a real MCP client would receive for the same tenant and arguments. A tool that returns a structured error (e.g. `not_found`, `validation_failed`, `unavailable`) SHALL be surfaced as that structured result, NOT as an HTTP 500. The console SHALL NOT bypass the tool's input validation, expose any tool the MCP surface does not, or alter the tool's behavior.

#### Scenario: Successful invocation returns the tool's structured result

- **WHEN** the operator runs a tool with valid arguments as a chosen tenant
- **THEN** the surface builds the tenant's MCP server, invokes the tool over the in-memory transport, and returns the tool's structured result unchanged

#### Scenario: A tool's structured error is returned as data, not a crash

- **WHEN** an invoked tool returns a structured error (e.g. the tenant has no preferred store, or a slug is unknown)
- **THEN** the surface returns that structured error to the console for display, not an unhandled 500

#### Scenario: Invalid arguments are rejected by the tool's own schema

- **WHEN** the operator runs a tool with arguments that violate its input schema
- **THEN** invocation is rejected by the same validation the MCP surface applies, and the validation error is returned to the console — the console does not pre-filter or bypass it

#### Scenario: Unknown tool name

- **WHEN** the operator POSTs to `/admin/api/tools/<name>` for a name the server does not register
- **THEN** the surface returns a structured `not_found`-class error and invokes nothing

### Requirement: Tool invocation identity is operator-driven under Access

The tool console SHALL determine the acting tenant from the operator's request (the chosen id), resolved against the allowlist by the same `resolveTenant` check the MCP surface uses — NOT from an MCP OAuth token. The operator MAY act as any allowlisted member. These endpoints SHALL remain gated by Cloudflare Access exactly like the rest of `/admin*`, including the opt-in rule: when the Access configuration is unset the tool-console endpoints SHALL respond `404` along with the rest of the admin surface. A request whose `acting-as` tenant is absent from the allowlist SHALL be rejected and SHALL invoke no tool.

#### Scenario: Operator acts as a chosen member

- **WHEN** an Access-authenticated operator selects member `casey` and runs a tool
- **THEN** the tool runs with `casey`'s tenant context (the same `Tenant` `/mcp` would build for `casey`), without any MCP OAuth token

#### Scenario: Tool console is disabled when the admin surface is

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** `GET /admin/api/tools` and `POST /admin/api/tools/<name>` respond `404`, exposing no catalog and running no tool

#### Scenario: Acting as a non-member is rejected

- **WHEN** a tool invocation names an `acting-as` tenant that is not on the allowlist
- **THEN** the surface returns an `unauthorized`/`not_found`-class error and invokes no tool

### Requirement: The dev workbench shows and guards the acting persona

The tool console SHALL make the acting persona visible whenever a tool can be invoked (a persistent "acting as `<member>`" indicator), and SHALL NOT allow a tool to be invoked while no persona is selected. Before invoking a tool as a **real member**, the console SHALL require an explicit confirmation; a persona designated for testing (by the `test-`/`sandbox-` naming convention) MAY bypass that confirmation. The selected persona is workbench-wide context that persists across dev surfaces, not a per-invocation field.

#### Scenario: No persona means no invocation

- **WHEN** the operator is on the tool console with no persona selected
- **THEN** tool invocation is unavailable until a persona is chosen

#### Scenario: The acting persona is always visible

- **WHEN** a persona is selected and a tool is runnable
- **THEN** the console continuously displays which member it is acting as

#### Scenario: Confirm before acting as a real member

- **WHEN** the operator runs a tool while acting as a real member (not a `test-`/`sandbox-` persona)
- **THEN** the console requires an explicit confirmation before the invocation is sent

### Requirement: Admin panel is organized into Admin and Dev areas with client-side routing

The admin SPA SHALL organize its surfaces into a top-level **Admin** area (member management) and a top-level **Dev** area (the tool console and future developer surfaces), navigable by client-side routing so each surface has its own URL and a new surface is added as its own routed module rather than another card on a single page. Navigating between surfaces SHALL update the browser URL, and a deep link or refresh to a surface's URL SHALL load that surface directly.

#### Scenario: Navigation updates the URL

- **WHEN** the operator switches from member management to the tool console
- **THEN** the browser URL changes to the console's route and the console renders, without a full-page server reload

#### Scenario: Deep link to a tool

- **WHEN** the operator opens `/admin/dev/tools/<tool>` directly (or refreshes there)
- **THEN** the Worker serves the SPA shell and the app routes to that tool's view

## MODIFIED Requirements

### Requirement: Admin UI served as same-origin static assets

The admin UI SHALL be a static single-page application served by the Worker from the **same origin** as `/admin/api/*`, so the browser calls the admin API without any cross-origin request and the deployment needs no CORS configuration. The UI SHALL be built from source by a deterministic build script (supporting a `--check` validate-only mode) into a committed output directory, and served via the Worker's static-assets binding; the generated bundle SHALL NOT be hand-edited. The static-assets binding SHALL be carried through the operator config merge so it reaches every operator's deployment.

The SPA SHALL be **client-routed** (a `Browser.application`): it owns multiple in-app routes under `/admin/*`. Because `/admin*` is routed worker-first, the Worker SHALL serve the SPA shell (the app's `index.html`) for any `/admin/*` GET that is neither an `/admin/api/*` route nor a real static asset, so in-app routes deep-link and survive a refresh. The Worker SHALL serve that shell by fetching it from the assets binding (not by redirecting to `/admin/index.html`), so it does not re-enter the worker-first route and loop.

#### Scenario: UI and API share an origin (no CORS)

- **WHEN** the admin SPA calls `/admin/api/*`
- **THEN** the call is same-origin and succeeds with no CORS preflight or `Access-Control-*` configuration

#### Scenario: Bundle is built from source, not hand-edited

- **WHEN** the admin UI changes
- **THEN** the change is made in the UI source and the bundle is rebuilt by the build script (verifiable with `--check`), and the committed bundle is not edited by hand

#### Scenario: The assets binding survives the operator config merge

- **WHEN** the deploy merges the code-level config into an operator's config
- **THEN** the static-assets binding is present in the deployed config (it is on the merge allowlist) and the admin UI is served

#### Scenario: Client routes are served the SPA shell

- **WHEN** a GET arrives for an `/admin/*` path that is not an `/admin/api/*` route and not a built static asset (e.g. `/admin/dev/tools/place_order`)
- **THEN** the Worker serves the SPA shell from the assets binding (without redirect-looping), and the app resolves the route client-side

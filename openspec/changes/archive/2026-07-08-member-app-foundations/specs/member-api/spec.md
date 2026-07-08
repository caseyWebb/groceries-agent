## ADDED Requirements

### Requirement: The member API is per-area typed Hono sub-apps calling the same operations tools call

The Worker SHALL mount a member-facing JSON API at `/api`, organized as per-area Hono sub-apps chained so their request/response types accumulate (the `/admin/api/*` + typed `hc` pattern), with the composed app type exported for client inference. Routes SHALL call the same throw-free `src/` operation functions the MCP tools call — one source of truth per operation — and SHALL NOT touch `env.DB` directly (all D1 access through `src/db.ts`). The SPA SHALL consume the app type via type-only imports (a raw-TS `exports` subpath on the Worker package), so no workerd code can enter the browser bundle. All areas except the login and version endpoints SHALL be session-gated.

#### Scenario: A typed client with zero codegen

- **WHEN** the SPA constructs an `hc` client from the exported app type
- **THEN** request and response shapes for every area typecheck end-to-end with no generated code, and the import is type-only (erased from the bundle)

#### Scenario: One operation, two transports

- **WHEN** an `/api` route and an MCP tool expose the same operation
- **THEN** both call the same `src/` function, and a behavior change in that function reaches both surfaces

### Requirement: Structured errors map to HTTP status once, in shared middleware

The `/api` surface SHALL map structured `ToolError` codes to HTTP status in a single shared error middleware — at minimum `validation_failed`→400, `not_found`→404, `unsupported`→405, and `storage_error`/`index_unavailable`/`upstream_unavailable`→503, with unrecognized codes and unexpected throws surfacing as 500 — and response bodies SHALL keep the structured `{ error, message }` shape so the SPA can branch on the code. API-layer conditions that no tool produces (`unauthorized`→401, `csrf_rejected`→403, `rate_limited`→429) SHALL use the same body shape. No `/api` route may implement its own error-to-status mapping.

#### Scenario: A ToolError surfaces as its mapped status with the structured body

- **WHEN** a route's underlying operation throws `ToolError("not_found", …)`
- **THEN** the response is a 404 whose JSON body carries `error: "not_found"` and the message — never an unhandled 500

#### Scenario: An unexpected throw degrades to a structured 500

- **WHEN** a route throws something other than a `ToolError`
- **THEN** the response is a 500 with a structured `{ error, message }` body, not a raw stack or an empty reply

### Requirement: Every API response carries the build id, and a version endpoint exposes it

Every `/api` response SHALL carry an `X-App-Build` header with the Worker's build id (the deploy-stamped code SHA; `"dev"` when unstamped), and `GET /api/version` SHALL return it as `{ build }` without requiring a session — the SPA compares it against its own embedded build id to detect version skew (API evolution stays additive-only, so a stale bundle keeps working against a newer Worker).

#### Scenario: Build id on every response

- **WHEN** any `/api` request completes — success or structured error
- **THEN** the response carries `X-App-Build`, and `GET /api/version` returns the same value with no session required

### Requirement: Conditional requests via a shared weak-ETag helper

The `/api` surface SHALL provide a single shared helper that emits a weak `ETag` on JSON GET responses and honors `If-None-Match` with an empty-body 304, so no route implements conditional-request handling ad hoc. The helper ships in this foundation (applied to the whoami read) and every later read area adopts it.

#### Scenario: An unchanged read costs a 304

- **WHEN** a GET is repeated with the `If-None-Match` value from its prior response and the underlying data is unchanged
- **THEN** the response is a 304 with no body, and the client keeps its cached data

### Requirement: Per-route API usage is observable beside tool usage

The shared `/api` middleware SHALL emit one best-effort, non-blocking usage point per request to the existing `TOOL_AE` Analytics Engine dataset, in its existing point shape, named by the matched route pattern with an `api:` prefix (e.g. `api:POST /api/session`) — the route pattern, never the raw URL, so points stay low-cardinality and tenant-clean (no tenant id, token, or payload). An unbound dataset or a write failure SHALL never affect the response.

#### Scenario: App usage appears next to tool usage

- **WHEN** an `/api` request completes
- **THEN** a point with the `api:`-prefixed route pattern, outcome, and duration is written to `TOOL_AE` (best-effort), carrying no tenant identifier or request payload

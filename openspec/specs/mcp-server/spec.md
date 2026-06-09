# mcp-server Specification

## Purpose

Defines the Cloudflare Worker MCP runtime: the Streamable-HTTP transport via `createMcpHandler` (stateless, no Durable Objects), the authenticated GitHub data-access client, the workerd-safe parsing approach, the structured-error convention shared by all tools, the authless-now / secure-by-write-time deployment posture, and the Worker's continuous deployment.
## Requirements
### Requirement: MCP server over Streamable HTTP

The system SHALL host an MCP server in a Cloudflare Worker under `worker/`, exposed over the **Streamable HTTP** transport via `createMcpHandler()`, operating statelessly with **no Durable Objects** and no per-session state. The server SHALL be reachable at a `workers.dev` URL and connectable from a standard MCP client (e.g. MCP Inspector).

#### Scenario: Tools listed over the MCP endpoint

- **WHEN** an MCP client connects to the deployed Worker URL and requests the tool list
- **THEN** the server responds over Streamable HTTP with the registered read tools and their input schemas

#### Scenario: No session state retained

- **WHEN** two independent MCP clients invoke tools against the Worker
- **THEN** each request is served purely from repo state with no shared or carried-over session state between requests

### Requirement: Authenticated GitHub data-access client

The system SHALL provide a single GitHub client wrapper used for all repo reads, authenticating with a fine-grained personal access token supplied as a Worker secret. The client SHALL read data at `main` HEAD, apply basic retry with backoff on transient failures and rate-limit responses, and surface failures as structured errors rather than throwing. The client SHALL be the shared data-access path reused by later changes.

#### Scenario: Reads use the authenticated token

- **WHEN** any read tool fetches repo data
- **THEN** the GitHub client issues an authenticated request (benefiting from the 5,000 req/hr limit) rather than an anonymous one

#### Scenario: Upstream failure surfaces structured

- **WHEN** GitHub is unreachable or returns a rate-limit response after retries are exhausted
- **THEN** the client returns a structured `upstream_unavailable` error and does not throw an unhandled exception

### Requirement: Workers-runtime-safe parsing

The system SHALL parse recipe frontmatter by splitting on the leading `---` fence and parsing the YAML block with a pure-JavaScript parser (`js-yaml`), and SHALL parse TOML with `smol-toml`. The system SHALL NOT use `gray-matter` in the Worker. All parsing SHALL run on the `workerd` runtime without Node-only APIs.

#### Scenario: Recipe frontmatter parsed on workerd

- **WHEN** the Worker reads a recipe markdown file
- **THEN** it separates frontmatter from body via the `---` fence and parses the frontmatter with `js-yaml`, producing a structured object without relying on Node `Buffer`/`fs`

#### Scenario: Malformed data is reported, not crashed

- **WHEN** a TOML or frontmatter document fails to parse
- **THEN** the tool returns a structured `malformed_data` error and the Worker stays responsive

### Requirement: Structured error convention

Every tool SHALL return a structured result on failure of the form `{ error: <code>, message: <human-readable>, ... }` and SHALL NOT surface raw exceptions or unstructured 5xx bodies to the client. The convention SHALL define at least these codes: `not_found`, `index_unavailable`, `upstream_unavailable`, `malformed_data`, and `unsupported`.

#### Scenario: Failure returns a reasoned error object

- **WHEN** a tool cannot complete (missing resource, bad upstream, unparseable data, or unsupported request)
- **THEN** it returns an object carrying an enumerated `error` code and a human-readable `message` the agent can act on

### Requirement: Continuous deployment of the Worker

The system SHALL provide `.github/workflows/deploy-worker.yml` that deploys the Worker on push to `worker/**`, authenticating to Cloudflare with an API token stored in GitHub Actions secrets. The Worker's own secrets (the GitHub token, and later external-service tokens) SHALL be set via `wrangler secret put` directly to Cloudflare and SHALL NOT be stored in the repository or in GitHub Actions.

#### Scenario: Push to worker source redeploys

- **WHEN** a commit changes a file under `worker/`
- **THEN** the deploy workflow runs and publishes the updated Worker using the Cloudflare API token from Actions secrets

#### Scenario: Worker secrets never live in the repo

- **WHEN** the repository and the deploy workflow are inspected
- **THEN** no GitHub PAT or external-service token appears in tracked files or workflow definitions; such secrets exist only in Cloudflare via `wrangler secret put`

### Requirement: MCP endpoint protected by Cloudflare Access

The MCP endpoint SHALL be protected by Cloudflare Access with a policy that authorizes only the owner's identity; unauthenticated requests SHALL be rejected or redirected into the OAuth flow rather than served. Because the Claude.ai web client is OAuth-only (no custom headers / service tokens), the gate SHALL use Cloudflare Access **Managed OAuth** — Access acts as the OAuth authorization server (emitting `WWW-Authenticate` and running registration + PKCE + token issuance) so the Worker requires no MCP-facing OAuth code. The Worker MAY additionally validate the `Cf-Access-Jwt-Assertion` header as defense-in-depth. This secures leg 2 (client → Worker) and is distinct from any Worker→external-service auth.

#### Scenario: Unauthenticated request is gated

- **WHEN** a request reaches the MCP endpoint without a valid Access session
- **THEN** Cloudflare Access rejects it or initiates the OAuth flow, and the request is not served by the Worker

#### Scenario: Only the owner's identity is authorized

- **WHEN** an identity other than the configured owner attempts to authenticate through Access
- **THEN** the Access policy denies it

#### Scenario: Authorized client reaches the tools

- **WHEN** the owner completes the Managed-OAuth flow
- **THEN** requests pass Access and the MCP server serves the registered tools normally

### Requirement: Write tools permitted behind the gate

With the identity gate in place, the Worker's tool surface MAY include repo-data write tools (per the `data-write-tools` and `grocery-list` capabilities). Cart writes and external-service calls SHALL remain out of scope for this change and are introduced in Change 06b behind the same gate (with an `/oauth/*` carve-out reserved for the Kroger callback).

#### Scenario: Write tools exposed, cart tools absent

- **WHEN** the Worker's tool surface is inspected after this change
- **THEN** it includes repo-data write tools and `commit_changes`, and contains no tool that writes a Kroger cart or calls an external service


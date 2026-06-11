# multi-tenancy Specification

## Purpose
TBD - created by archiving change multi-tenant-friend-group. Update Purpose after archive.
## Requirements
### Requirement: Worker is a multi-tenant OAuth 2.1 provider

The Worker SHALL act as an OAuth 2.1 authorization server for the MCP surface so that each member of the friend group connects their own Claude.ai account to the one shared Worker. The Worker SHALL support the dynamic client registration + authorization-code + PKCE flow that the Claude.ai custom-connector requires, and SHALL issue an access token whose presentation on a later MCP request resolves to exactly one tenant. OAuth provider state (registered clients, authorization codes, grants/tokens) SHALL be stored in KV — no SQL database. The access token SHALL be the sole tenant identifier carried on MCP calls; the Worker SHALL NOT rely on Cloudflare Access for MCP-surface identity.

#### Scenario: A friend connects their own Claude.ai

- **WHEN** a friend adds the connector in their Claude.ai account and completes the OAuth flow
- **THEN** the Worker issues an access token bound to that friend's tenant, and subsequent MCP calls carrying it are served in that tenant's context

#### Scenario: Provider state lives in KV

- **WHEN** the OAuth provider persists a registered client, an authorization code, or an issued grant
- **THEN** it is stored in a KV namespace and no relational/SQL store is introduced

### Requirement: Identity is gated by a curated allowlist

Completing the OAuth authorization SHALL require the authenticating identity to be on an operator-curated allowlist; this is self-hosting for a known group, not open registration. An identity not on the allowlist SHALL be denied authorization and SHALL NOT be issued a tenant token. The allowlist SHALL be operator-maintained configuration, not a self-service signup.

#### Scenario: Allowlisted identity is admitted

- **WHEN** an identity on the allowlist completes the authorization flow
- **THEN** it is granted a tenant token mapped to that identity

#### Scenario: Unknown identity is denied

- **WHEN** an identity not on the allowlist attempts to authorize
- **THEN** the Worker denies the authorization and issues no token

### Requirement: Per-request tenant resolution

Every MCP request SHALL be resolved to a tenant from its bearer access token before any tool runs. A request with a missing, invalid, or unresolvable token SHALL be rejected with a structured `unauthorized` response and SHALL NOT reach any tool. The MCP server instance handling a request SHALL be constructed for the resolved tenant so that no tool can read or write another tenant's data.

#### Scenario: Token resolves to a tenant

- **WHEN** an MCP request arrives with a valid issued access token
- **THEN** the Worker resolves it to the owning tenant and serves the request in that tenant's context

#### Scenario: Unresolvable token is rejected

- **WHEN** an MCP request arrives with no token or a token that does not resolve to an allowlisted tenant
- **THEN** the Worker returns a structured `unauthorized` response and runs no tool

### Requirement: Per-tenant subtree and GitHub App installation tokens

The Worker SHALL resolve each tenant to its `users/<username>/` path prefix within the single shared data repository and SHALL authenticate all repo reads and writes with a short-lived **GitHub App installation token** minted on demand from the App's credentials, scoped to the installation covering the data repository. The Worker SHALL address a tenant's personal files by prefixing repo-relative paths with that tenant's `users/<username>/`, so a tool for one tenant cannot read or write another tenant's subtree. The Worker SHALL NOT use a personal access token for repo access, and no per-tenant long-lived user PAT SHALL be stored. Installation tokens SHALL be treated as ephemeral (re-minted on expiry).

#### Scenario: Writes use a scoped installation token under the tenant's subtree

- **WHEN** a tool for tenant A persists a change to A's personal state
- **THEN** the Worker mints a GitHub App installation token covering the data repo, and writes the file under `users/A/`, never another tenant's subtree, and never with a PAT

#### Scenario: No PAT

- **WHEN** the Worker configuration and secrets are inspected
- **THEN** repo access is via the GitHub App (id + private key), with no repo-wide PAT and no stored per-user PAT

### Requirement: Per-tenant Kroger refresh-token storage

The Worker SHALL store each tenant's Kroger refresh token under a per-tenant KV key (e.g. `kroger:refresh:<tenant>`), and SHALL resolve the Kroger user context for a cart write from the requesting tenant's key. One tenant's Kroger authorization SHALL be independent of every other tenant's. The Kroger read-side (`client_credentials`) credentials remain a single app-level secret shared by all tenants.

#### Scenario: Cart write uses the requesting tenant's Kroger token

- **WHEN** tenant B places an order
- **THEN** the Worker uses tenant B's Kroger refresh token to obtain user context, never another tenant's

#### Scenario: Read credentials are shared

- **WHEN** any tenant performs a product search, price, or flyer lookup
- **THEN** the Worker uses the single app-level `client_credentials` app, with no per-tenant read credentials

### Requirement: Tenant directory (username allowlist)

The Worker SHALL maintain a tenant directory: the operator-curated **allowlist of usernames** permitted to resolve to a tenant. The data-repository coordinates, the GitHub App installation, and the `users/<username>/` prefix are global/derived, so the directory record need carry no per-tenant repo coordinates. The directory SHALL be the operational source of truth for tenant resolution and SHALL live in KV alongside the OAuth provider and Kroger state — domain data (recipes, pantry, etc.) is NOT stored here; it remains in the data repo.

#### Scenario: Directory admits an allowlisted username

- **WHEN** a tenant is resolved from its token
- **THEN** the Worker confirms the username is in the directory allowlist and derives its `users/<username>/` prefix; a username absent from the allowlist resolves to `unauthorized`

#### Scenario: Directory holds no domain data

- **WHEN** the tenant directory is inspected
- **THEN** it contains only operational mapping (the username allowlist), not pantry/recipe/preference content


## MODIFIED Requirements

### Requirement: One-time authorization_code OAuth with PKCE

The Worker SHALL obtain a Kroger **user-context** access token via the `authorization_code` grant with PKCE, through an `/oauth/*` route group: an init step that redirects to Kroger's authorize endpoint with a PKCE `code_challenge` and a `state` value, and a callback step that exchanges the returned `code` + verifier for an access token and a refresh token. The `state` SHALL be bound to the **initiating tenant** so the callback stores the resulting refresh token under that tenant. The callback SHALL verify `state` to reject forged or replayed redirects. Each member of the group SHALL authorize their own Kroger shopping account against the operator's single shared Kroger app; members SHALL NOT register their own Kroger Developer app.

#### Scenario: One-time authorization completes for a tenant

- **WHEN** a tenant runs the one-time authorization and approves access at Kroger
- **THEN** the callback exchanges the code (with the PKCE verifier) for an access + refresh token and stores the refresh token under that tenant's key

#### Scenario: Forged callback rejected

- **WHEN** a callback arrives whose `state` does not match an initiated flow
- **THEN** the Worker rejects it and performs no token exchange

#### Scenario: One shared Kroger app serves many users

- **WHEN** two different tenants each complete the Kroger authorization
- **THEN** both authorize against the same operator-owned Kroger app and each gets their own stored refresh token, with no per-user Kroger Developer registration

### Requirement: KV-backed single-use refresh-token rotation

Each tenant's rotating Kroger refresh token SHALL be stored in a **KV namespace** under a per-tenant key (e.g. `kroger:refresh:<tenant>`). Because Kroger refresh tokens are **single-use/rotating**, on each refresh the Worker SHALL write the new refresh token to the tenant's key **before** using the freshly minted access token, so a crash after refresh cannot strand that tenant on a consumed token. A refresh that Kroger rejects SHALL surface as a structured `{ error: "reauth_required" }` directing that tenant to re-run the one-time authorization — never a silent failure or generic 5xx.

#### Scenario: Rotation persists the new token before use

- **WHEN** a tenant's access token is refreshed
- **THEN** the new refresh token is written to that tenant's KV key before the new access token is used for any Kroger request

#### Scenario: Rejected refresh asks for re-auth

- **WHEN** Kroger rejects a tenant's stored refresh token
- **THEN** the tool returns `{ error: "reauth_required" }` with guidance to re-run the one-time authorization, and does not throw an unstructured error

#### Scenario: One tenant's tokens are isolated from another's

- **WHEN** tenant A and tenant B have each authorized Kroger
- **THEN** a cart write for A uses only A's refresh token and a cart write for B uses only B's, with no shared key

### Requirement: Access tokens are minted on demand, not persisted

User-context access tokens SHALL be held only in isolate memory, keyed by tenant, and re-minted from the tenant's refresh token on expiry; only the refresh token is persisted (in KV). The in-isolate access-token cache SHALL be per-tenant — there SHALL be no module-level single-token cache that could leak one tenant's token to another. This keeps the Worker stateless apart from the per-tenant rotating-token slots.

#### Scenario: Expired access token is transparently refreshed

- **WHEN** a cart write for a tenant needs a user-context token and that tenant's cached access token has expired
- **THEN** the Worker refreshes from that tenant's KV key and proceeds, without requiring user interaction (unless the refresh itself is rejected)

#### Scenario: Cache cannot serve another tenant's token

- **WHEN** tenant A's access token is cached in-isolate and tenant B makes a cart write
- **THEN** B's request mints/uses B's own token and never receives A's cached token

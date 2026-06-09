# kroger-user-auth Specification

## Purpose
TBD - created by archiving change order-placement. Update Purpose after archive.
## Requirements
### Requirement: One-time authorization_code OAuth with PKCE

The Worker SHALL obtain a Kroger **user-context** access token via the `authorization_code` grant with PKCE, through an `/oauth/*` route group: an init step that redirects to Kroger's authorize endpoint with a PKCE `code_challenge` and a `state` value, and a callback step that exchanges the returned `code` + verifier for an access token and a refresh token. The callback SHALL verify `state` to reject forged or replayed redirects. This grant is required because a cart write needs user context, unlike the read-side `client_credentials` flow.

#### Scenario: One-time authorization completes

- **WHEN** the user runs the one-time authorization and approves access at Kroger
- **THEN** the callback exchanges the code (with the PKCE verifier) for an access + refresh token and stores the refresh token

#### Scenario: Forged callback rejected

- **WHEN** a callback arrives whose `state` does not match the initiated flow
- **THEN** the Worker rejects it and performs no token exchange

### Requirement: KV-backed single-use refresh-token rotation

The rotating Kroger refresh token SHALL be stored in a **KV namespace** (a single key) — the Worker's only persistent state. Because Kroger refresh tokens are **single-use/rotating**, on each refresh the Worker SHALL write the new refresh token to KV **before** using the freshly minted access token, so a crash after refresh cannot strand the account on a consumed token. A refresh that Kroger rejects SHALL surface as a structured `{ error: "reauth_required" }` directing the user to re-run the one-time authorization — never a silent failure or generic 5xx.

#### Scenario: Rotation persists the new token before use

- **WHEN** the access token is refreshed
- **THEN** the new refresh token is written to KV before the new access token is used for any Kroger request

#### Scenario: Rejected refresh asks for re-auth

- **WHEN** Kroger rejects the stored refresh token
- **THEN** the tool returns `{ error: "reauth_required" }` with guidance to re-run the one-time authorization, and does not throw an unstructured error

### Requirement: Access tokens are minted on demand, not persisted

User-context access tokens SHALL be held only in isolate memory and re-minted from the refresh token on expiry; only the refresh token is persisted (in KV). This keeps the Worker stateless apart from the single rotating-token slot.

#### Scenario: Expired access token is transparently refreshed

- **WHEN** a cart write needs a user-context token and the cached access token has expired
- **THEN** the Worker refreshes from KV and proceeds, without requiring user interaction (unless the refresh itself is rejected)

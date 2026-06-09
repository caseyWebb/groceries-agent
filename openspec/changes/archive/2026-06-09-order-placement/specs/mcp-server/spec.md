## MODIFIED Requirements

### Requirement: Write tools permitted behind the gate

With the identity gate in place, the Worker's tool surface MAY include repo-data write tools (per the `data-write-tools` and `grocery-list` capabilities) **and the cart-write / external-service tools of the `order-placement` and `kroger-user-auth` capabilities** (`place_order` and the Kroger OAuth flow). The Kroger cart write reaches an external service from behind the gate, and `place_order` SHALL remain the **only** tool that writes a Kroger cart.

#### Scenario: Cart and write tools exposed behind the gate

- **WHEN** the Worker's tool surface is inspected after this change
- **THEN** it includes the repo-data write tools, `commit_changes`, and `place_order`, all reachable only through the Access-gated endpoint

## ADDED Requirements

### Requirement: OAuth callback path bypasses Access

The Kroger OAuth callback route group (`/oauth/*`) SHALL be exempt from the Cloudflare Access policy, because Kroger's redirect carries no Access session/JWT and would otherwise be blocked. The carve-out SHALL be secured by OAuth `state` + PKCE rather than Access. The carve-out SHALL be scoped to `/oauth/*` only; all other paths (including `/mcp`) remain gated.

#### Scenario: Kroger redirect reaches the callback

- **WHEN** Kroger redirects the user to `/oauth/callback` with no Access session
- **THEN** the request reaches the Worker's callback handler (not blocked by Access) and is validated by `state`/PKCE

#### Scenario: Only the OAuth paths are carved out

- **WHEN** a request targets any path other than `/oauth/*`
- **THEN** it is still subject to the Cloudflare Access gate

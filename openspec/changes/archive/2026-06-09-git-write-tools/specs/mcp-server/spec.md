## REMOVED Requirements

### Requirement: Authless deployment with a hard pre-write security gate

**Reason**: This change introduces the repo-data write tools, which is exactly the trigger the original requirement named ("required before any write or cart tool is exposed"). The authless, read-only-only posture is therefore retired and replaced by an identity gate.

**Migration**: See the new requirement "MCP endpoint protected by Cloudflare Access". The Worker now sits behind Cloudflare Access (Managed OAuth, only-Casey policy); write tools are permitted; cart/external-service tools remain out of scope until Change 06b.

## ADDED Requirements

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

## ADDED Requirements

### Requirement: Whoami reports the deployment profile and operator identity

The whoami read (`GET /api/session`) SHALL additionally return `profile` — the
deployment profile (`"self-hosted" | "saas"`) — and `operator: { name, repo }` — the
operator's display name and plugin-marketplace repo slug — alongside the tenant
identity, preserving the shared ETag contract. `profile` SHALL be resolved through a
single Worker-side accessor that is the only site naming the profile source; until the
deployment-profile flag channel ships, the accessor returns `"self-hosted"` and claims
no configuration channel. `operator.name` SHALL come from the optional non-secret
`OPERATOR_NAME` var, falling back to `OWNER_TENANT_ID`, else `null`; `operator.repo`
from the optional non-secret `MARKETPLACE_REPO` var (stamped onto the deploy by the
operator deploy workflow from the calling data repo — the data repo IS the
marketplace), else `null`. Unset config SHALL yield explicit `null`s — never a
fabricated slug or name.

#### Scenario: Whoami carries the templated operator config

- **WHEN** an authenticated member requests `GET /api/session` on a deployment with
  `MARKETPLACE_REPO` and `OPERATOR_NAME` set
- **THEN** the response body carries `profile: "self-hosted"`, `operator.repo` and
  `operator.name` with those values, and the response keeps its weak ETag /
  `If-None-Match` 304 behavior

#### Scenario: Unset operator config degrades to nulls

- **WHEN** `OPERATOR_NAME` and `MARKETPLACE_REPO` are unset (e.g. local dev) and
  `OWNER_TENANT_ID` is unset
- **THEN** whoami returns `operator: { name: null, repo: null }`, and with only
  `OWNER_TENANT_ID` set, `operator.name` is that tenant id

### Requirement: The sidebar offers a guided Connect-to-Claude modal

The app shell's sidebar SHALL render a "Connect to Claude.ai" CTA opening a guided
modal over the EXISTING distribution/connect flow — pure UI, no new backend write
path. The modal SHALL present two tabs of numbered steps templated from whoami's
`operator` config (never hardcoded slugs or names), each command copyable with
per-step "Copied" feedback:

- **Claude.ai (default)**: add the marketplace (copyable `operator.repo` slug), turn
  on auto-sync (naming `operator.name`'s updates), install the yamp plugin, open
  Connectors, connect yamp (entering the operator-sent invite code if prompted). The
  tab SHALL NOT carry a Kroger step — on the conversational surface Kroger consent is
  agent-initiated via `kroger_login_url` (deliberate omission).
- **Claude Code**: `/plugin marketplace add <operator.repo>`,
  `/plugin install yamp@yamp`, authorize the connector (`/mcp`, with copy covering the
  cross-device approval from the signed-in web app and the invite-code prompt where it
  applies), and an optional Kroger-cart step whose action mints the member's personal
  one-time consent link through the EXISTING session-gated
  `GET /api/profile/kroger-login-url` and opens it — never a static
  `/oauth/init?tenant=` URL, which the nonce-bound consent flow does not accept.

The modal footer SHALL carry the invite-code note (codes are minted per member, shown
once in the admin panel) and an "Open Claude.ai" action targeting `claude.ai/new` in a
new tab. When `operator.repo` is `null`, the affected steps SHALL degrade to
ask-your-operator copy with no copyable command; when `operator.name` is `null`, copy
SHALL fall back to "your operator".

#### Scenario: The modal renders templated, copyable steps

- **WHEN** a signed-in member opens the sidebar CTA on a deployment with operator
  config set
- **THEN** the Claude.ai tab shows the five steps with the deployment's marketplace
  repo slug as the copyable command, copying a step flips its button to "Copied", and
  the footer offers the invite-code note and the Open Claude.ai link

#### Scenario: The Claude Code tab covers install, auth, and optional Kroger

- **WHEN** the member switches to the Claude Code tab
- **THEN** the marketplace-add and plugin-install commands render templated and
  copyable, the auth step names `/mcp` with the web-app approval path, and the
  optional Kroger step's action requests the existing consent-link endpoint and opens
  the minted URL

#### Scenario: Missing operator config degrades honestly

- **WHEN** the modal opens on a deployment where whoami returned
  `operator: { name: null, repo: null }`
- **THEN** the marketplace steps show ask-your-operator copy with no copyable command,
  no fabricated slug appears anywhere, and the remaining steps render unchanged

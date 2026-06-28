# usage-observability Specification

## Purpose
TBD - created by archiving change usage-observability. Update Purpose after archive.
## Requirements
### Requirement: Operator resource-usage observability view

The Worker SHALL serve an operator usage view at `/admin/usage` (a page of the Access-gated admin SPA) backed by `GET /admin/api/usage`, reporting account-wide **KV operation** usage (reads, writes, deletes, lists) and **Workers AI neuron** consumption against their daily free-tier limits. The endpoint SHALL source this data from the Cloudflare GraphQL Analytics API via an outbound `fetch` from the Worker's egress, and SHALL perform **no KV operations** in the course of serving the view (no KV reads, writes, lists, or caches) — so observing usage never consumes the budget it observes. The endpoint SHALL inherit the `/admin*` Cloudflare Access gate (no auth of its own) and SHALL be **aggregate-only and tenant-data-free** — account- and namespace-level totals, never per-tenant rows or identifiers. KV usage MAY be reported per namespace id (the dimension the Analytics API exposes) alongside a grand total against the limit.

#### Scenario: Configured usage view reports KV and AI usage against limits

- **WHEN** the operator opens `/admin/usage` with `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` configured
- **THEN** the page shows the day's KV reads/writes/deletes/lists and Workers AI neurons, each against its daily free-tier limit, with over-limit values visibly flagged

#### Scenario: Serving the usage view performs no KV operations

- **WHEN** `GET /admin/api/usage` handles a request
- **THEN** it reaches the Cloudflare Analytics API by `fetch` only and performs zero KV reads, writes, lists, or caches

#### Scenario: The usage endpoint is gated and tenant-clean

- **WHEN** a request reaches `/admin/api/usage`
- **THEN** it is subject to the same Access gate as the rest of `/admin*`, and its response carries only account/namespace aggregates — no usernames, tenant ids, or other per-tenant identifiers

### Requirement: Usage observability degrades gracefully when unconfigured

The usage view SHALL be **opt-in**: `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` are optional operator config (a non-secret account identifier and a read-only Analytics API token). When either is unset, `GET /admin/api/usage` SHALL report an explicit not-configured result rather than failing, and the page SHALL render an explicit "not configured" state naming the two variables — mirroring the opt-in, fail-gracefully behavior of the Access gate and the ntfy push. The token SHALL be treated as a secret and never exposed by any surface.

#### Scenario: Unconfigured analytics renders a not-configured state

- **WHEN** the operator opens `/admin/usage` with `CF_ANALYTICS_TOKEN` (or `CF_ACCOUNT_ID`) unset
- **THEN** `GET /admin/api/usage` reports a not-configured result and the page renders an explicit "usage analytics not configured" state naming the required variables, rather than an error

#### Scenario: The analytics token is never exposed

- **WHEN** any open or admin surface renders usage data
- **THEN** the `CF_ANALYTICS_TOKEN` value never appears in any response


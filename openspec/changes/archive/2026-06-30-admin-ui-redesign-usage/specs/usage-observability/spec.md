## ADDED Requirements

### Requirement: KV operations report a per-namespace 30-day history

`GET /admin/api/usage` SHALL report, in addition to the existing current-UTC-day KV-operation snapshot (`kv.totals`/`kv.namespaces`, unchanged), a **per-namespace, per-day history** of KV operations over a recent window of days (matching the `usage-trends`/`tool-usage-trends` window), sourced from the Cloudflare GraphQL Analytics API by widening the existing `kvOperationsAdaptiveGroups` query to a date range grouped by `(namespaceId, actionType, date)`, performing **no KV operation** of its own (the same zero-KV-cost guarantee the snapshot already holds). The history SHALL be ordered ascending by day (oldest → newest) and SHALL omit no day in the window, even a day with zero recorded operations for a namespace (reported as zero, not absent). Each history day's per-namespace counts SHALL sum to that day's per-action total, consistent with the snapshot's own totals-equal-sum-of-namespaces invariant.

#### Scenario: Configured usage view reports a 30-day per-namespace KV history

- **WHEN** the operator opens `/admin/usage` with `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` configured
- **THEN** `GET /admin/api/usage` returns, alongside today's snapshot, a per-namespace KV-operation series covering the trailing window of days, ordered oldest to newest

#### Scenario: A day with no recorded operations reports zero, not a gap

- **WHEN** a namespace recorded no operations of a given action on some day within the window
- **THEN** that day's entry for that namespace and action reports `0`, and the day is still present in the series (not omitted)

#### Scenario: Per-namespace history performs no KV operation

- **WHEN** `GET /admin/api/usage` computes the per-namespace history
- **THEN** it reaches the Cloudflare GraphQL Analytics API by `fetch` only and performs zero KV reads, writes, lists, or caches, mirroring the snapshot's zero-KV-cost guarantee

### Requirement: KV namespace ids resolve to a friendly label and display color

Because the Cloudflare GraphQL Analytics API reports KV operations by an opaque `namespaceId` that the Worker cannot resolve to its `wrangler.jsonc` binding name at request time, the Usage payload SHALL resolve each known namespace id to a **friendly label** (the binding name, e.g. `KROGER_KV`) and a **stable display color** from a small fixed categorical palette, using a static mapping available to the Worker (an operator-configured mapping, or one derived from the deploy's own pinned `kv_namespaces[].id` values) rather than a runtime Cloudflare API lookup. A namespace id with no resolvable mapping SHALL still appear in the payload (its raw id, an "unlabeled" marker, and a muted/generic color) rather than being dropped, so aggregate totals remain accurate even when labeling is incomplete.

#### Scenario: A known namespace id resolves to its binding name

- **WHEN** the Usage payload includes a namespace id that matches the configured/deploy-pinned mapping
- **THEN** that namespace's entries (snapshot and history) carry the mapped friendly label and a stable display color

#### Scenario: An unmapped namespace id still reports accurate totals

- **WHEN** the Analytics API reports a namespace id with no entry in the label mapping
- **THEN** that namespace's operation counts still appear in the payload (raw id, unlabeled marker, generic color), and the per-action grand totals still include its counts

#### Scenario: Label resolution makes no additional Cloudflare API call

- **WHEN** the Usage payload resolves namespace labels
- **THEN** it uses only the static mapping already available to the Worker (config or deploy-pinned ids) and issues no additional outbound request beyond the existing Analytics queries

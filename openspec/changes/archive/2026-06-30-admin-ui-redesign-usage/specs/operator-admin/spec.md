## ADDED Requirements

### Requirement: Usage area presents headline tiles, per-namespace KV meters, AI neurons, job trends, and tool usage

The Usage area (`/admin/usage`) SHALL present its four observability surfaces composed from the shared admin component kit (`src/admin/ui/kit.tsx`), in place of the prior bare status-row lists:

1. A headline **stat-tile row** (kit `StatCardGrid`/`StatCard`) showing KV operations today (the sum of the day's read/write/delete/list totals), Workers AI neurons used today (against the daily limit), MCP tool calls over the trends window, and the tool error rate over the same window.
2. An **Account resources** card with one KV-operation meter per action (read/write/delete/list), each rendered as a `Progress` bar **stacked by namespace** (a categorical color per labeled namespace, per the usage-observability namespace-label requirement) against that action's daily free-tier limit, recolored (ok/warn/fail) as the total approaches or exceeds the cap; each meter SHALL be paired with a **30-day sparkline** also stacked by namespace, sourced from the per-namespace history (usage-observability). The same card SHALL show a Workers AI neurons meter (used vs. daily limit) and a per-model breakdown row (model name + neurons consumed).
3. A **per-job trends** list: one sparkline row per background job showing its runs/day over the trends window, its total run count, and its average duration, sourced from `fetchUsageTrends`.
4. A **tool usage** table (kit `DataTable`) listing each tool's call count, error count and rate, and p50/p95 latency over the trends window, sourced from `fetchToolUsage`, busiest tool first.

Each surface SHALL preserve its existing not-configured and upstream-failure-detail behavior (per the usage-observability/usage-trends/tool-usage-trends capabilities) — an unconfigured or failing surface renders its existing explicit state, not a broken or blank composition. The area SHALL remain pure SSR with no client island (consistent with the panel's read-only-page rule): a per-segment or per-bar hover detail SHALL be carried by a native, no-JavaScript affordance (e.g. a `title` attribute), not a client-side tooltip component.

#### Scenario: Headline tiles summarize the four top-line numbers

- **WHEN** the operator opens `/admin/usage` with usage analytics configured
- **THEN** the stat-tile row shows today's KV-operation total, today's AI-neuron usage against its limit, the trends-window tool-call count, and the trends-window error rate

#### Scenario: KV meters are stacked per namespace with a matching sparkline

- **WHEN** the operator opens `/admin/usage` with usage analytics configured
- **THEN** each KV-operation meter (read/write/delete/list) renders as a namespace-stacked bar against its daily limit, paired with a namespace-stacked 30-day sparkline, with namespaces shown in their resolved labels and colors where available

#### Scenario: A meter recolors as it approaches its cap

- **WHEN** a KV-operation total reaches or exceeds its warn threshold or its daily limit
- **THEN** that meter renders in its warn or fail state rather than its default ok state

#### Scenario: Per-job and tool-usage surfaces are unchanged in data, redesigned in presentation

- **WHEN** the operator views the per-job trends list or the tool-usage table
- **THEN** the data shown (runs/day, average duration, calls, errors, p50/p95) is the same `fetchUsageTrends`/`fetchToolUsage` data the prior implementation read, now composed from the kit's sparkline/table primitives

#### Scenario: An unconfigured or failing surface keeps its explicit state

- **WHEN** usage analytics is unconfigured, or an upstream request fails
- **THEN** the affected surface (snapshot, trends, or tool usage) renders its existing explicit not-configured or upstream-failure-detail state, and the rest of the page's configured surfaces still render

#### Scenario: The Usage area ships no client island

- **WHEN** the Usage area is rendered
- **THEN** it is pure server-rendered HTML with no client-side island, and any per-segment hover detail uses a native, no-JavaScript affordance

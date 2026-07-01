## Why

The Usage area (`src/admin/pages/usage.tsx`) is the original thin SSR dashboard — three bare `status-row` lists predating the Basecoat kit and the redesign's stat-tile/meter/sparkline patterns already shipped elsewhere in the panel. The redesign mock (`UsageScreen.jsx`) establishes a richer target: headline stat tiles, KV-operation meters broken out **per namespace** (so the operator can see which namespace — Kroger tokens/flyer cache, OAuth grants, or the tenant directory — is actually eating the budget) with a 30-day per-namespace trend, a Workers AI neuron meter, per-job run sparklines, and a tool-usage table. The per-namespace KV breakdown the mock wants does not exist as a queryable history today — only a same-day snapshot — so this change also decides how (and how cheaply) to back it.

## What Changes

- Replace the three `status-row` panels in `src/admin/pages/usage.tsx` with the kit-composed Usage area: a headline `StatCardGrid` (KV ops today, AI neurons today, MCP calls 30d, error rate 30d), an Account-resources card with per-namespace-stacked KV-operation `Progress` meters (recolored as they approach the daily free-tier cap) plus a 30-day per-namespace stacked sparkline, a Workers AI neurons meter with a per-model breakdown row, a per-job runs/day sparkline list (`fetchUsageTrends`), and a tool-usage `DataTable` (`fetchToolUsage`).
- Add a **namespace label mapping**: a small operator-supplied (or sensibly-defaulted) mapping from the opaque Cloudflare KV `namespace_id` the Analytics API reports to the binding name (`KROGER_KV` / `TENANT_KV` / `OAUTH_KV`) and a display color, since the Worker cannot resolve a namespace id to its binding name at runtime — without this, "per namespace" renders as anonymous hex ids, defeating the mock's whole point.
- Extend the KV-operations reader to also report a **per-namespace, per-day history** (not just today's snapshot) over the same 30-day window the job/tool trends already use, sourced from the Cloudflare GraphQL Analytics API by widening the existing same-day query to a date range (see `design.md` for the recommended approach and its honest cost/approximation trade-offs — this is the area's main backend lift).
- Keep the existing not-configured / upstream-failure-detail behavior (already specified by `usage-observability`/`usage-trends`/`tool-usage-trends`) for every panel, including the new per-namespace history.

## Capabilities

### New Capabilities

(none — this extends two existing capabilities)

### Modified Capabilities

- `usage-observability`: adds a per-namespace **30-day history** to the KV-operations snapshot (currently same-day-only) and a namespace-id→label/color mapping requirement, as **ADDED** requirements; the existing same-day snapshot, not-configured, and upstream-failure-detail requirements are unchanged.
- `operator-admin`: adds Usage-area presentation requirements (headline stat tiles, per-namespace-stacked KV meters + sparkline, AI neuron meter + per-model chips, per-job sparklines, tool-usage table) composed from the kit primitives, as an **ADDED** requirement alongside the unchanged Access-gate/SSR/typed-RPC requirements.

## Impact

- `src/usage.ts` — `fetchUsage`/`mapAccountUsage` gain a per-namespace history query (or a sibling reader) and namespace label resolution; `UsageResult`'s `kv` shape grows.
- `src/admin/pages/usage.tsx` — redesigned SSR composition from the kit (`StatCardGrid`/`StatCard`, `Progress`, `Sparkline`, `DataTable`).
- `src/admin/shared.ts` (or equivalent) — any new island props if the per-namespace meter's hover/tooltip detail needs islanding (read-only data; expect pure SSR per `src/admin/CLAUDE.md` rule 8, with hover detail as a CSS/title-attribute affordance rather than a client island, unless design.md concludes otherwise).
- `src/admin/app.tsx` — `/admin/usage` route unchanged in shape, richer payload.
- `wrangler.jsonc` / operator config — a new non-secret namespace-label mapping var (or a sensible code-level default with operator override), documented in `docs/SELF_HOSTING.md`.
- `docs/SCHEMAS.md` — the `UsageResult.kv` shape documented in lockstep.

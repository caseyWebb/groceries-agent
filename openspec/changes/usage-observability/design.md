# Design — usage-observability

## Context

The operator hits Cloudflare's **daily KV operation limits** (free tier: 1,000 writes/day, 1,000 deletes/day, 1,000 lists/day, 100,000 reads/day, 1 GB storage). They want observability into *what consumes which budget* — explicitly **without** the tracking itself adding KV load.

The investigation surfaced that the system's own background-job health records are the leading baseline consumer (~1,440 KV writes/day > the 1,000/day budget; see proposal). So this change is two coupled things: **add observability** (read-only, zero KV) and **remove the self-inflicted writes** (health → D1).

## Decision 1 — Source of usage data: the Cloudflare GraphQL Analytics API

The only options for "how many KV ops have I done, by namespace":

| Source | Account-accurate? | KV cost | Verdict |
|---|---|---|---|
| `KVNamespace` binding | — (no usage API) | — | Can't: bindings expose only get/put/delete/list |
| `KV.list()` key counts | partial (keys, not ops) | **burns list budget** | Rejected — amplifies the exact problem |
| Self-tracked counters in KV | only our own ops | **burns write budget** | Rejected — amplifies + self-referential |
| **CF GraphQL Analytics API** | **yes (billing-grade)** | **zero KV** | **Chosen** |

Endpoint: `POST https://api.cloudflare.com/client/v4/graphql`. Datasets (under `viewer.accounts(filter: {accountTag})`):

- `workersKvOperationsAdaptiveGroups` — `sum.requests` by `dimensions.actionType` (read/write/delete/list) and `dimensions.namespaceId`, filtered to today.
- `workersKvStorageAdaptiveGroups` — stored bytes / key count by `namespaceId` (latest datapoint).
- `workersAiInferenceRequestsAdaptiveGroups` — neurons by `dimensions.modelName`, filtered to today.

**Open task for implementation:** the exact dataset/field names above must be verified against the live GraphQL schema before coding — Cloudflare evolves these, and the Workers-AI neuron field in particular needs confirming. Treat the names here as the shape, not the contract.

The Worker calls this from its egress with a bearer token — an ordinary outbound `fetch`, no KV, no binding. It is **not** an MCP tool (it's an `/admin/api/*` operation behind Access), so `docs/TOOLS.md` is untouched.

### Namespace labeling limitation

The Analytics API identifies namespaces by **namespace ID** (hex), not binding name (`TENANT_KV`/`KROGER_KV`/`OAUTH_KV`). A Worker cannot introspect its own binding→id mapping at runtime, and the IDs are operator-owned (each operator provisions their own namespaces). Decision: **show per-namespace-id rows plus a clear grand total against the limit** (the total is the headline the operator needs — "am I near 1,000 writes?"). An optional operator-supplied `id→label` map can come later; not in this change. The page will note that rows are keyed by namespace id.

## Decision 2 — Fix the leak: health records KV → D1

Health is **persistent operational data**, which `docs/ARCHITECTURE.md` already assigns to D1 ("KV is ephemeral infra only; D1 is the system of record for operational data + derived projections"). The records are in the wrong tier today purely for historical reasons.

- New table `job_health(name TEXT PRIMARY KEY, ok INTEGER NOT NULL, last_run_at INTEGER NOT NULL, summary TEXT NOT NULL)` — one upserted row per job. Tenant-clean (the existing invariant is unchanged; `summary` stays counts/timestamps/error-classes only).
- `writeJobHealth` → `db(env).run(UPSERT ...)`; `readJobHealth`/aggregation → `db(env).all(...)`, all through `src/db.ts` (structured `storage_error`, throw-free).
- Write budget: `5/tick × 288 = 1,440` D1 row-writes/day — trivial against D1's free-tier 100,000 writes/day. **No coalescing needed** (we considered batching the five writes into one; D1's generous limits make it unnecessary, and independent upserts keep the per-job code simple).
- **Graceful read degradation:** `/health` already runs a live D1 probe. When D1 is down, the health-row read fails the same way — the aggregation must treat an unreadable `job_health` as "rows unavailable, see `d1.ok: false`" rather than throwing out of the health path. `d1.ok: false` already degrades overall `ok`, so the signal is preserved.
- **No data migration:** historical `health:job:*` KV values are disposable (next tick repopulates D1). The old keys are simply abandoned; they expire/idle and are never read again.

This is what takes the standing KV-write baseline to ~0 — the actual fix for the alert emails. The Usage page without this fix would just watch the budget burn.

## Decision 3 — Config & graceful degradation (mirror the existing patterns)

Two new **optional** env entries on `Env`:

- `CF_ACCOUNT_ID?` — non-secret identifier (the account tag for the GraphQL filter).
- `CF_ANALYTICS_TOKEN?` — secret; a **read-only** Cloudflare API token scoped to Account Analytics read (the minimum that reads the adaptive-groups datasets). Set via `wrangler secret`, never committed (public repo).

When either is unset, `/admin/api/usage` returns `{ configured: false }` and the Elm page renders an explicit "Usage analytics not configured" state naming the two vars — exactly the opt-in/fail-closed shape of the Access gate (unset → 404) and ntfy (unset → no-op). So this adds **zero required** config. Both are operator-owned (var + secret), so they're stripped from the maintainer's merged config automatically — no `merge-wrangler-config.mjs` allowlist change.

## Decision 4 — No KV cache for usage data

Caching the Analytics response in KV would re-introduce the amplification we're removing. The Usage page is operator-only and rarely loaded; each load makes the external GraphQL calls fresh, with at most **in-isolate** memoization (ephemeral, free). The Analytics data already lags a few minutes — fine for an operator dashboard.

## Decision 5 — Free-tier limits as reference lines

The page shows usage as absolute counts **plus** the free-tier daily limit as a reference (e.g. `writes: 1,440 / 1,000`). Limits are hardcoded constants (the code already hardcodes the 10,000-neuron free allocation in `health.ts`), easy to change if the operator moves to a paid plan. Not configurable in this change.

## Elm modeling (admin/CLAUDE.md discipline)

- A new `Usage` page module added to `Main.Page`, a `Usage` route in `Route.elm`, and a nav entry. New routed page, not a card.
- The fetch is `WebData UsagePayload`, never a loading/error/data triple.
- "Not configured" is a **real state**, not a `Maybe` — model the payload as a union: `type UsageView = NotConfigured | Configured UsageData` decoded from the `configured` discriminator, so "configured but no data" is unrepresentable.
- Render KV ops and AI neurons against limits; over-limit rows styled like the Status page's `fail`.

## Risks / open items

- **GraphQL field names** must be verified live (Decision 1) — the single most likely place to need iteration.
- **Token scoping**: confirm the minimal permission that reads all three datasets (likely "Account Analytics: Read"); document the exact scope in `docs/SELF_HOSTING.md`.
- **Health-read-on-D1-down**: ensure the aggregation path is genuinely throw-free when `job_health` can't be read (covered by a test).

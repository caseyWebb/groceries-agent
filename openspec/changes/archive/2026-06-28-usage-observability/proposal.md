## Why

The operator is receiving Cloudflare emails warning that the deployment is approaching its **daily KV operation limits**. There is no in-panel way to see what is consuming which budget, so the operator can't tell self-inflicted baseline load from their own active-development spikes.

Worse, the instinct to "add tracking" would make it strictly worse: the constrained resource is KV *operations*, so writing counters to KV to measure KV is self-defeating.

A grounded look at the existing system shows the baseline is the real problem:

- The `*/5` cron runs **five** jobs each tick (`flyer-warm`, `recipe-classify`, `recipe-index`, `recipe-embed`, `discovery-sweep`), and **each writes its own `health:job:<name>` KV record on every run** — by design, since staleness detection needs a fresh `last_run_at` every tick.
- `5 writes/tick × 288 ticks/day = 1,440 KV writes/day`, versus the free-tier budget of **1,000 writes/day**.

So the **existing observability alone is ~144% of the daily write budget**, running 24/7 independent of any development activity — on top of the flyer-warm cursor writes, OAuth token writes, and PKCE verifiers. The health system, which is meant to watch the system, is the leading cause of the alerts.

Neither the `KVNamespace` nor the `Ai` binding exposes usage counters, and counting keys via `KV.list()` would itself burn the list budget — so accurate, account-wide usage data has exactly one source that costs **zero KV**: Cloudflare's GraphQL Analytics API.

## What Changes

Two coupled moves — **observe**, and **stop the self-inflicted writes**.

- **New operator Usage page (`/admin/usage`) + `GET /admin/api/usage`.** The Worker fetches Cloudflare's GraphQL Analytics API (`workersKvOperationsAdaptiveGroups`, `workersKvStorageAdaptiveGroups`, `workersAiInferenceRequestsAdaptiveGroups`) from its own egress — an external call that touches **no KV** — and renders KV operations (reads / writes / deletes / lists, per namespace) and Workers AI neuron consumption against their daily free-tier limits.
- **New optional operator config: `CF_ACCOUNT_ID` (var) + `CF_ANALYTICS_TOKEN` (scoped read-only secret).** When unset, the Usage page renders an explicit **"not configured"** state and the endpoint reports it — the same opt-in, fail-gracefully pattern as the Access gate and ntfy. No required new config.
- **Background-job health records move from KV to D1.** Health is persistent operational data, which the architecture already places in D1 ("KV is ephemeral infra only"); it is sitting in the wrong tier. A new `job_health` D1 table (one upserted row per job, written through `src/db.ts`) takes `~1,440 KV writes/day → ~0`. `/health` reads the rows from D1 and degrades gracefully when D1 is unreachable (the existing D1 probe already reports that).
- **No KV cache for the usage data.** Caching the Analytics response in KV would re-introduce the amplification; the page is operator-only and rarely loaded, so each load makes the external calls fresh (in-isolate memoization only).

## Capabilities

### Added Capabilities
- `usage-observability`: an Access-gated operator view + `/admin/api/usage` endpoint that surfaces account-wide KV-operation and Workers-AI-neuron usage against daily limits, sourced from the Cloudflare GraphQL Analytics API at zero KV cost, with graceful "not configured" degradation.

### Modified Capabilities
- `background-job-health`: per-job health records persist in **D1** (a `job_health` table, written through `src/db.ts`) instead of a `health:job:*` KV key, eliminating the cron's standing KV-write load; `/health` reads the rows from D1 and degrades gracefully when D1 is unreachable.

## Impact

- **Code:** new `src/usage.ts` (CF GraphQL client + tenant-clean payload mapping); `src/admin.ts` (`GET /admin/api/usage` route); `src/health.ts` (`writeJobHealth`/`readJobHealth`/aggregation → D1); `src/env.ts` (`CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`); new `admin/src/Usage.elm` + wiring in `admin/src/Main.elm` + `admin/src/Route.elm` (+ regenerated `admin/dist/`).
- **Schema:** new `migrations/d1/NNNN_job_health.sql` (`job_health` table); applied `--remote` by the deploy. KV `health:job:*` keys are abandoned (left to expire / ignored — no migration of historical health needed).
- **Tests:** `test/health.test.ts` (re-pointed at D1), new `test/usage.test.ts` (GraphQL mapping + the unconfigured path), `admin/tests/UsageTest.elm` (decode + the not-configured state).
- **Docs:** `docs/ARCHITECTURE.md` (health storage tier + the usage-observability surface), `docs/SCHEMAS.md` (the `job_health` table), `docs/SELF_HOSTING.md` (the optional `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` config + the read-only token scoping).
- **No new binding type** (the Analytics API is an outbound `fetch`; the new vars/secret are operator-owned, so no `merge-wrangler-config.mjs` allowlist change). Tenant-clean by construction — account-level aggregates only, no per-tenant identifiers.

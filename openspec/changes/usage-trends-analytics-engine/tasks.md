## 0. Spikes (gate the design before coding)

- [ ] 0.1 Verify the AE **SQL API** shape against a live account: the `analytics_engine/sql` endpoint, the dataset table name, and that the analytics token's scope can read it (else document the extra scope) — **NOT verified in this environment** (no Cloudflare account creds, the same constraint as usage-observability's GraphQL field-name spike). `src/usage.ts`'s AE SQL client is coded against the documented endpoint/dialect with a flagged "verify against live" comment, and `docs/SELF_HOSTING.md` calls out widening the token's analytics scope if the trends panel errors while the snapshot works. Confirm on a connected box before relying on the figures.
- [x] 0.2 Determine whether `env.AI.run` exposes a **per-call neuron/token cost** in its response — **no**: the Workers AI `run` signature in `@cloudflare/workers-types` returns model-specific output (e.g. `{ data, shape }` for embeddings), with no per-call neuron/token field. So per-job neuron attribution is **out of scope** for the MVP (the design's committed decision): the emission records **durations + counts** only, and neuron totals stay on the account-level snapshot view.

## 1. Analytics Engine binding + merge allowlist

- [x] 1.1 `wrangler.jsonc`: add the `analytics_engine_datasets` binding (`USAGE_AE`, dataset `grocery_usage`)
- [x] 1.2 `src/env.ts`: add the `USAGE_AE: AnalyticsEngineDataset` binding (optional — unbound is a no-op)
- [x] 1.3 `scripts/merge-wrangler-config.mjs`: add `analytics_engine_datasets` to the allowlist (verbatim-from-code, like `ai`/`assets`/`r2_buckets`)
- [x] 1.4 `tests/*` (merge-config): assert the AE binding type survives the merge (the silent-drop regression guard)

## 2. Per-run emission

- [x] 2.1 A shared `recordUsagePoint(env, job, { ok, durationMs, counts })` helper: `env.USAGE_AE?.writeDataPoint({ indexes:[job], blobs:[job, ok?"ok":"fail"], doubles:[durationMs, ...counts] })`, best-effort (swallow throws), tenant-clean
- [x] 2.2 Call it from each job runner (`flyer-warm`, `recipe-classify`, `recipe-index`, `recipe-embed`, `discovery-sweep`, `email`) alongside the existing `job_health` write — same numbers, no per-tenant data
- [x] 2.3 Document the dataset's **positional** slot layout (per-job `double` order) in `docs/SCHEMAS.md`
- [x] 2.4 Test: emission shape (slots) + best-effort (unbound/throwing binding is a no-op that doesn't fail the job)

## 3. Trends data source + endpoint

- [x] 3.1 `src/usage.ts`: an AE **SQL** client (`POST /accounts/<id>/analytics_engine/sql`, reuse `CF_ACCOUNT_ID` + analytics token); map rows → a per-job/per-day series; unconfigured → `{ configured: false }` (no request); failure → `upstream_unavailable`
- [x] 3.2 `src/admin.ts`: `GET /admin/api/usage/trends` → the trends client; Access-gated; non-GET `unsupported`
- [x] 3.3 Test: SQL-response → series mapping; the unconfigured short-circuit (no request)

## 4. Trends panel (Elm)

- [x] 4.1 `admin/src/Usage.elm`: a Trends section (`WebData` + not-configured state), per-job last-N-days metrics (runs sparkline + window totals), styled with the existing Usage vocabulary
- [x] 4.2 `admin/tests/UsageTest.elm`: decode a trends payload + the not-available state
- [x] 4.3 Rebuild + commit `admin/dist/` (`aubr build:admin`)

## 5. Docs (lockstep)

- [x] 5.1 `docs/ARCHITECTURE.md`: AE as the history tier alongside the `job_health` liveness tier; the emit→SQL→panel flow
- [x] 5.2 `docs/SCHEMAS.md`: the `grocery_usage` AE dataset's positional slot contract + the `/admin/api/usage/trends` shape
- [x] 5.3 `docs/SELF_HOSTING.md`: the AE binding is code-level (no operator config); note any extra analytics-token scope the AE SQL read needs

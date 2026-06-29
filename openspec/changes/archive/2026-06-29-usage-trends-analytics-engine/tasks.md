## 0. Spikes (gate the design before coding)

- [~] 0.1 Verify the AE **SQL API** shape against a live account — **partially verified** with the available `CLOUDFLARE_API_TOKEN`: (a) the endpoint + method are correct — `POST /accounts/<id>/analytics_engine/sql` returns a *structured* response, not a 404/wrong-path; (b) **token scope matters and is checked independently** — this token (valid/active, can read `/accounts`) gets HTTP **403 "Authorization error"** from AE SQL, and the GraphQL analytics datasets aren't even in its schema (`Account` introspects to null), so it lacks **Account Analytics: Read**. The success-path `{ data: [...] }` envelope the mapper reads is therefore **still unconfirmed** (couldn't get past auth, and `grocery_usage` has no data until the Worker deploys). `src/usage.ts` documents this precisely; `docs/SELF_HOSTING.md` tells the operator to grant/widen the Account Analytics: Read scope. Re-run on a connected box with a properly-scoped token + written data to confirm the row shape.
- [x] 0.2 Determine whether `env.AI.run` exposes a **per-call neuron/token cost** — **no** (a static type/contract finding, *not* a rate-limited call — no network request is involved). Evidence from `@cloudflare/workers-types`: the string `neuron` appears **0 times** in the entire AI surface; the only per-call cost field is `usage?: UsageTags` = `{ prompt_tokens, completion_tokens, total_tokens }` (**tokens, not neurons**) and it exists **only on `AiTextGenerationOutput`** — the embedding models this app's embed job uses (`bge-base-en-v1.5` → `{ shape, data, pooling }`) expose **no usage field at all**. So neurons are never per-call, and even tokens aren't available uniformly across jobs. Per-job neuron attribution stays **out of scope** (the design's committed MVP): the emission records **durations + counts** only; neuron totals stay on the account-level snapshot (which sources them from the GraphQL Analytics API by model, the canonical place neurons are exposed). Residual: a type can lag runtime, so a one-off `console.log(await env.AI.run(...))` on a connected box is the final confirmation — but the type + Cloudflare's documented model agree.

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

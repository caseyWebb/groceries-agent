## 1. Health records → D1 (the write-budget fix)

- [ ] 1.1 New migration `migrations/d1/NNNN_job_health.sql`: `job_health(name TEXT PRIMARY KEY, ok INTEGER NOT NULL, last_run_at INTEGER NOT NULL, summary TEXT NOT NULL)`
- [ ] 1.2 `src/db.ts`: prepared-statement helpers for the `job_health` upsert + read-all (throw-free `storage_error` mapping, per the db.ts discipline)
- [ ] 1.3 `src/health.ts`: `writeJobHealth` upserts a `job_health` row (no `kv.put`); `readJobHealth`/aggregation read the rows from D1; drop the `health:job:*` KV key path and the `KvStore` plumbing for health
- [ ] 1.4 `src/health.ts`: aggregation degrades gracefully when `job_health` can't be read (D1 down) — `/health` still responds, `d1.ok: false` carries the signal, no throw out of the health path
- [ ] 1.5 Re-point every `writeJobHealth` caller (`flyer-warm`, `recipe-classify`, `recipe-index`/projection, `recipe-embed`, `discovery-sweep`, `email`) — they pass `env`/`db`, not the KV namespace
- [ ] 1.6 `test/health.test.ts`: re-pointed at D1 (write/read/aggregate, never-run, D1-down graceful path); update the existing job tests' health assertions

## 2. Usage data source (`src/usage.ts`, zero KV)

- [ ] 2.1 Verify the live Cloudflare GraphQL Analytics schema (dataset + field names for `workersKvOperationsAdaptiveGroups`, `workersKvStorageAdaptiveGroups`, `workersAiInferenceRequestsAdaptiveGroups`) before coding
- [ ] 2.2 `src/usage.ts`: build + POST the GraphQL query to `https://api.cloudflare.com/client/v4/graphql` (bearer `CF_ANALYTICS_TOKEN`, `accountTag = CF_ACCOUNT_ID`, today's window); map to a tenant-clean `UsagePayload` (KV ops by action + namespace id + totals; AI neurons; the free-tier reference limits)
- [ ] 2.3 Unconfigured path: when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is unset, return `{ configured: false }` — no fetch, no KV
- [ ] 2.4 `src/env.ts`: add optional `CF_ACCOUNT_ID` (non-secret) + `CF_ANALYTICS_TOKEN` (secret), documented like the other optional operator config
- [ ] 2.5 `test/usage.test.ts`: GraphQL response → payload mapping; over-limit flagging; the unconfigured short-circuit (asserts no fetch)

## 3. Admin API route

- [ ] 3.1 `src/admin.ts`: `GET /admin/api/usage` → `src/usage.ts`; inherits the Access gate; `unsupported` (405) on non-GET; structured-error serialization like the other routes

## 4. Usage page (Elm)

- [ ] 4.1 `admin/src/Route.elm`: add a `Usage` route variant + its slug parse/print (compiler flags every site)
- [ ] 4.2 `admin/src/Usage.elm`: `WebData UsagePayload`; model the payload as `NotConfigured | Configured UsageData` (decoded from `configured`, so "configured-but-empty" is unrepresentable); render KV ops + AI neurons against limits, over-limit rows styled like Status `fail`; note rows are keyed by namespace id
- [ ] 4.3 `admin/src/Main.elm`: add the `UsagePage` to the `Page` union + nav entry + init/update/view wiring
- [ ] 4.4 `admin/tests/UsageTest.elm`: decode a configured payload + the not-configured state
- [ ] 4.5 Rebuild + commit `admin/dist/` (`aubr build:admin`); if the Elm toolchain can't reach `package.elm-lang.org`, leave the rebuild to CI and say so

## 5. Docs (lockstep)

- [ ] 5.1 `docs/ARCHITECTURE.md`: health records live in D1 (not KV); the new usage-observability surface + its CF Analytics source + zero-KV property
- [ ] 5.2 `docs/SCHEMAS.md`: the `job_health` D1 table
- [ ] 5.3 `docs/SELF_HOSTING.md`: the optional `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN` config, the minimal read-only token scope, and that the Usage page is opt-in (not-configured when unset)

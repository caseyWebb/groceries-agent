## MODIFIED Requirements

### Requirement: Background-job health records

Each background process (a cron-`scheduled` job or the inbound `email` handler) SHALL persist a health record in **D1** on every run, of the shape `{ ok: boolean, last_run_at: number, summary: object }`. `ok` reflects whether the run succeeded; `last_run_at` is epoch ms; `summary` carries small operational detail (counts, durations, error classes). Records SHALL be **tenant-data-free** — no usernames, tenant ids, or other per-tenant identifiers may appear in any field. The record SHALL live in a `job_health` table keyed by job name (one upserted row per job), written **through `src/db.ts`** like all other D1 access (so a storage failure is a structured `storage_error`, never a raw throw). Health records SHALL NOT be stored in KV — persisting per-job liveness on every cron tick is standing operational write load that belongs in D1's far more generous budget, not in the KV operation budget.

#### Scenario: A job writes its health record on each run

- **WHEN** a background job completes a run (successfully or with failure)
- **THEN** it upserts its `job_health` row with `ok`, a fresh `last_run_at`, and a tenant-data-free `summary`, through `src/db.ts`

#### Scenario: Health persistence consumes no KV operations

- **WHEN** the cron tick's jobs record their health
- **THEN** they write only to D1 and perform no KV writes for health records

#### Scenario: Records never carry tenant data

- **WHEN** a job records a failure caused by a specific tenant's input
- **THEN** the `summary` records only the error class and counts, never the tenant id or other per-tenant identifiers

### Requirement: Aggregate health endpoint

The Worker SHALL serve a `/health` endpoint on its public (non-MCP) fetch path that aggregates all `job_health` rows into one response reporting an overall `ok` and, per job, its `ok`, `last_run_at`, and a freshness/last-error summary. Because the `fetch` path is independent of the `scheduled` path, `/health` SHALL remain answerable even when the cron is not firing, so a stopped job is detectable via stale `last_run_at` / freshness. The endpoint SHALL return **only aggregate** state — never per-tenant rows, and store identifiers SHALL be reported as counts rather than enumerated. A job that has never run SHALL be reported as such rather than omitted or treated as healthy. Reading the health rows SHALL go through `src/db.ts`; when D1 is unreachable, `/health` SHALL still respond — its existing live D1 probe reports `d1.ok: false` (which degrades overall `ok`) and the health-row read SHALL degrade to "unavailable" rather than throwing out of the health path.

The response SHALL additionally carry an `admin` posture section reporting the operator admin gate as booleans only: `access_configured` (both Access vars set), `email_allowlist` (an allowlist is configured), `dev_bypass_set` (the dev bypass flag is present), and `exposed`. The `admin` section SHALL NOT include the allowlisted email addresses themselves — only whether an allowlist is configured. `exposed` SHALL be `true` when the dev bypass is enabled on a surface that Access does not protect (`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` unset and `ADMIN_DEV_BYPASS` set) — the surface's only safeguard is then the loopback dev-guard, an alarm-worthy deployment misconfiguration — and SHALL be computed by the **same** gate-disposition helper the `/admin` gate uses, so the report cannot drift from the gate. When `exposed` is `true`, the overall `ok` SHALL be `false` (so `/health` returns `503`), in addition to the existing job-failure and D1-probe conditions.

#### Scenario: Endpoint aggregates job health

- **WHEN** an authorized request hits `/health`
- **THEN** the response reports an overall status plus each registered job's `ok`, `last_run_at`, and freshness, read from `job_health`, with no per-tenant data

#### Scenario: Stopped cron is visible via staleness

- **WHEN** the cron has not fired for longer than its expected interval (so no fresh rows are written)
- **THEN** `/health` still responds (served by the independent fetch path) and reports the job's stale `last_run_at`, letting an external monitor detect the outage

#### Scenario: A job that has never run is reported as such

- **WHEN** `/health` is queried before a job's first run (no row yet)
- **THEN** that job is reported as not-yet-run rather than omitted or reported healthy

#### Scenario: Health responds when D1 is unreachable

- **WHEN** D1 is unreachable at the time of a `/health` request
- **THEN** the endpoint still responds, reports `d1.ok: false` (degrading overall `ok`), and degrades the health-row read to unavailable rather than throwing

#### Scenario: Endpoint reports admin gate posture

- **WHEN** a request hits `/health`
- **THEN** the response includes an `admin` section with the booleans `access_configured`, `email_allowlist`, `dev_bypass_set`, and `exposed`, and no allowlisted email addresses

#### Scenario: An exposed admin gate degrades overall health

- **WHEN** the dev bypass is enabled on a surface Access does not protect, so its only safeguard is the loopback dev-guard (`exposed: true`)
- **THEN** overall `ok` is `false` and `/health` returns `503`

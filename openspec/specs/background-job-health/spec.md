# background-job-health Specification

## Purpose
TBD - created by archiving change background-job-health. Update Purpose after archive.
## Requirements
### Requirement: Background-job health records

Each background process (a cron-`scheduled` job or the inbound `email` handler) SHALL persist a health record in KV at `health:job:<name>` on every run, of the shape `{ ok: boolean, last_run_at: number, summary: object }`. `ok` reflects whether the run succeeded; `last_run_at` is epoch ms; `summary` carries small operational detail (counts, durations, error classes). Records SHALL be **tenant-data-free** — no usernames, tenant ids, or other per-tenant identifiers may appear in any field. The record SHALL live under the existing `KROGER_KV` namespace with a `health:` prefix (no new binding).

#### Scenario: A job writes its health record on each run

- **WHEN** a background job completes a run (successfully or with failure)
- **THEN** it writes `health:job:<name>` with `ok`, a fresh `last_run_at`, and a tenant-data-free `summary`

#### Scenario: Records never carry tenant data

- **WHEN** a job records a failure caused by a specific tenant's input
- **THEN** the `summary` records only the error class and counts, never the tenant id or other per-tenant identifiers

### Requirement: Aggregate health endpoint

The Worker SHALL serve a `/health` endpoint on its public (non-MCP) fetch path that aggregates all `health:job:<name>` records into one response reporting an overall `ok` and, per job, its `ok`, `last_run_at`, and a freshness/last-error summary. Because the `fetch` path is independent of the `scheduled` path, `/health` SHALL remain answerable even when the cron is not firing, so a stopped job is detectable via stale `last_run_at` / freshness. The endpoint SHALL return **only aggregate** state — never per-tenant rows, and store identifiers SHALL be reported as counts rather than enumerated. A job that has never run SHALL be reported as such rather than omitted or treated as healthy.

#### Scenario: Endpoint aggregates job health

- **WHEN** an authorized request hits `/health`
- **THEN** the response reports an overall status plus each registered job's `ok`, `last_run_at`, and freshness, with no per-tenant data

#### Scenario: Stopped cron is visible via staleness

- **WHEN** the cron has not fired for longer than its expected interval (so no fresh records are written)
- **THEN** `/health` still responds (served by the independent fetch path) and reports the job's stale `last_run_at`, letting an external monitor detect the outage

#### Scenario: A job that has never run is reported as such

- **WHEN** `/health` is queried before a job's first run (cold cache)
- **THEN** that job is reported as not-yet-run rather than omitted or reported healthy

### Requirement: Health endpoint is token-gated and opt-in

`/health` SHALL require a `HEALTH_TOKEN` secret, supplied as a query parameter or header. When the `HEALTH_TOKEN` secret is **unset**, the endpoint SHALL be disabled (respond `404`), so a deployment that has not opted in exposes no operational state. When the secret is set, a request without the correct token SHALL be rejected (`401`).

#### Scenario: Missing or wrong token is rejected

- **WHEN** `HEALTH_TOKEN` is set and a request to `/health` omits it or presents the wrong value
- **THEN** the endpoint responds 401 without revealing health state

#### Scenario: Endpoint disabled when unconfigured

- **WHEN** `HEALTH_TOKEN` is unset
- **THEN** `/health` responds 404, exposing no operational state by default

### Requirement: Scheduled handlers surface failures to the platform

A `scheduled` handler SHALL log a failed run AND rethrow it, so that the run is recorded as a failure by the platform's native cron status (rather than being swallowed and reported as success). Because cron runs are not retried, rethrowing loses no work.

#### Scenario: A failed tick is recorded as a failure

- **WHEN** a scheduled tick throws
- **THEN** the handler logs the error and rethrows it, so the platform's cron run status reflects the failure rather than success

### Requirement: Registered background jobs report health

The flyer warm and the inbound email handler SHALL each write their `health:job:<name>` record, so both current background processes are covered by `/health`. The flyer warm's record SHALL additionally carry the freshness signal a monitor asserts on (the last sweep's completion time — when the rollups were last refreshed).

#### Scenario: The flyer warm reports health

- **WHEN** a warm tick runs
- **THEN** it writes `health:job:flyer-warm` with `ok`, `last_run_at`, and a summary including sweep freshness (last completion time) and the run's error count

#### Scenario: The email handler reports health

- **WHEN** the inbound `email` handler processes a message
- **THEN** it writes `health:job:email` with `ok`, `last_run_at`, and a tenant-data-free summary

### Requirement: Optional secret-gated failure notification

When an `NTFY_URL` secret (and optional `NTFY_TOKEN`) is configured, a background job that **fails** SHALL post a short, tenant-data-free alert to that ntfy topic — an independent failure push that does not depend on any external monitor. When `NTFY_URL` is **unset**, no notification SHALL be attempted and the job SHALL proceed unaffected (graceful degradation). A notification attempt that itself fails SHALL NOT change the job's own outcome.

#### Scenario: Failure posts an ntfy alert when configured

- **WHEN** a background job fails and `NTFY_URL` is configured
- **THEN** a short tenant-data-free alert is posted to the ntfy topic (authenticated with `NTFY_TOKEN` when set)

#### Scenario: No notification configured degrades gracefully

- **WHEN** a background job fails and `NTFY_URL` is unset
- **THEN** no notification is attempted and the job proceeds exactly as before

#### Scenario: A failing notification does not affect the job

- **WHEN** posting the ntfy alert itself errors
- **THEN** the failure is swallowed and the job's own success/failure outcome is unchanged

### Requirement: Health badge SVG variant

The Worker SHALL serve a `/health.svg` variant on the same public fetch path as `/health`, rendering the **same aggregate health payload** into an SVG **card** image. It SHALL be gated by the same `HEALTH_TOKEN`, accepting the token via a `?token=` query parameter or `Authorization: Bearer` header: when `HEALTH_TOKEN` is unset the variant SHALL be disabled (`404`); when set, a request without the correct token SHALL be rejected (`401`).

Unlike `/health` (which returns `200` healthy / `503` degraded), `/health.svg` SHALL return HTTP **`200` in all health states** and encode healthy-vs-degraded **visually by color**, because image proxies may not render a non-`200` response as an image. It SHALL set `content-type: image/svg+xml` and a short cache lifetime so an embedding README refreshes the badge on a TTL rather than live.

The rendered SVG SHALL be **tenant-data-free**, derived only from the aggregate payload — each registered job's `ok`/never-run state and `last_run_at`, plus the D1 probe — and SHALL NOT contain any per-tenant identifier. The card SHALL render every registered job row and the D1 row, and SHALL make a **never-run** job visually distinct from both healthy and failing, so a fresh deploy with pending jobs does not read as broken.

#### Scenario: Disabled when unconfigured

- **WHEN** `HEALTH_TOKEN` is unset and a request hits `/health.svg`
- **THEN** the variant responds `404`, exposing no operational state (the same opt-in posture as `/health`)

#### Scenario: Missing or wrong token is rejected

- **WHEN** `HEALTH_TOKEN` is set and a request to `/health.svg` omits it or presents the wrong value
- **THEN** the variant responds `401` without revealing health state

#### Scenario: Healthy state renders a 200 SVG

- **WHEN** an authorized request hits `/health.svg` and all jobs are `ok` and the D1 probe succeeds
- **THEN** the response is `200` with `content-type: image/svg+xml` and a card showing each job and D1 in a healthy style

#### Scenario: Degraded state still renders 200

- **WHEN** a registered job is failing or the D1 probe fails
- **THEN** `/health.svg` still returns `200` (not `503`) and shows the degraded state by color

#### Scenario: A never-run job is visually distinct

- **WHEN** a job has never run (no record yet) at the time `/health.svg` is requested
- **THEN** that job's row renders in a distinct pending style, neither healthy nor failing

#### Scenario: The card carries no tenant data

- **WHEN** the SVG card renders
- **THEN** it contains only aggregate state (job names, statuses, timestamps, D1 status) and no usernames, tenant ids, or other per-tenant identifiers


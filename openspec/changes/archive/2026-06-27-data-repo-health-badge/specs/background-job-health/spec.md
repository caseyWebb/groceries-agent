## ADDED Requirements

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

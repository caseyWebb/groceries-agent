# app-ui-testing Specification

## Purpose
TBD - created by archiving change member-app-foundations. Update Purpose after archive.
## Requirements
### Requirement: Blocking browser-level functional gate for the member app

The repository SHALL provide a Playwright suite that drives the real member app in a pinned Chromium against a seeded local `wrangler dev` (the harness under `packages/worker/app/visual/`, run by `aubr test:app`), and a CI job (`app-ui` in `.github/workflows/ci.yml`) that runs it as a **blocking** check from the app's first PR — the Worker deploy trigger SHALL depend on it, like the admin gate. The suite SHALL cover, at minimum: the login flow (an invalid code shows the uniform error; a valid seeded invite code lands on the authenticated shell; logout returns to login), a landmark assertion + full-page screenshot for every registered app area, and Worker-path passthrough (`/health` and `/cookbook` answer as Worker surfaces, never the SPA shell). The gate SHALL be functional-assertion-based with no pixel baselines; an app change ships with its Playwright coverage, same as the admin rule.

#### Scenario: A broken login flow fails CI

- **WHEN** a change breaks login, the authenticated shell's landmark, or a Worker-owned path's passthrough
- **THEN** the `app-ui` job fails as a blocking check and the deploy trigger does not fire

#### Scenario: The P0 acceptance is executable

- **WHEN** the suite runs against the seeded local `wrangler dev`
- **THEN** the seeded invite code logs into the app at `/` inside a real browser

### Requirement: The app harness mirrors the admin harness's shape

The app harness SHALL follow the admin harness's organization: page objects owning routes, landmarks, and expected fixtures (specs never hard-code either), Playwright fixtures wiring page objects into specs, an ordered area registry the smoke spec iterates, and deterministic seeding — sharing the admin harness's seed fixture set, extended with a deterministic invite mapping for login. Adding an app area SHALL require only its page object, registry/fixture registration, and any seed rows, after which the smoke coverage picks it up. Runs SHALL be offline (local bindings only) and deterministic across repeated runs on the same code.

#### Scenario: A new app area gets coverage through one seam

- **WHEN** a contributor adds a routed app area with its page object and registers it
- **THEN** the smoke suite covers it (landmark + screenshot) with no other spec edits

#### Scenario: Deterministic seeded login

- **WHEN** the suite runs twice on the same commit
- **THEN** both runs log in with the same seeded invite mapping and produce the same assertions and comparable screenshots

### Requirement: Per-area app screenshots are published inline on app-UI PRs

For a same-repo PR touching app-UI paths (the app or ui packages, the app harness, the `/api`/session Worker surface, or the app Playwright config), CI SHALL publish the suite's per-area screenshots inline on the PR as a **single sticky comment** (its own hidden marker, distinct from the admin comment; commit-SHA-pinned raw image URLs; a per-PR directory on the shared screenshots branch that never collides with the admin job's). A PR not touching app-UI paths gets no comment; fork PRs degrade to the artifact upload. Visual regression review is human, over the published screenshots — no pixel gate.

#### Scenario: An app-UI PR gets its own sticky screenshot comment

- **WHEN** a same-repo PR touches the member app and pushes twice
- **THEN** the PR carries exactly one app-screenshots comment, updated in place, alongside (not merged into) any admin screenshot comment

#### Scenario: The two suites never clobber each other's images

- **WHEN** the `admin-ui` and `app-ui` jobs publish for the same PR
- **THEN** each writes only its own directory on the screenshots branch and each maintains only its own comment

### Requirement: The suite establishes member sessions deterministically, never via per-test UI login

Authenticated specs SHALL start pre-authenticated from a session minted server-side, never by driving the login UI per test. The app harness (`packages/worker/app/visual/setup.mjs`) SHALL seed a member session directly into `TENANT_KV` (a `session:<token>` record mirroring `createSession`, alongside the already-seeded `tenant:<active>` allowlist key) and SHALL emit a Playwright `storageState` carrying the `__Host-session` cookie with the exact attributes `setSessionCookie` sets. The suite SHALL run as two Playwright projects: an `authed` project that loads that `storageState` and runs every non-login spec, and a `noauth` project that carries no `storageState` and runs the dedicated real-auth-UI specs (login, signup, passkey) genuinely logged out — the ONLY specs that exercise `POST /api/session`. The `asMember` fixture SHALL be a plain navigation to `/` that asserts the shell landmark, with no login request and no cached-cookie state. This SHALL hold `fullyParallel: false`, `workers: 1`, and the existing `retries` unchanged; the fix is the removal of login from the authenticated test path, not any relaxation of timeouts, retries, or the limiter.

#### Scenario: An authenticated spec issues no login request

- **WHEN** any spec in the `authed` project runs (it enters the app through `asMember` or a direct navigation)
- **THEN** it establishes its session from the injected `storageState` and issues no `POST /api/session` request

#### Scenario: The login limiter is exercised only by the dedicated login specs

- **WHEN** the full suite runs
- **THEN** only the `noauth` project's login/signup/passkey specs drive the real login UI, and the total `POST /api/session` attempts stay within the 10/min/IP limiter so it is never tripped

#### Scenario: A cold Worker is gated by an authenticated warmup

- **WHEN** the suite starts against a freshly booted local `wrangler dev`
- **THEN** a `globalSetup` blocks every worker until `GET /api/session` returns 200 for the seeded session — proving the KV-session read, the tenant allowlist, and D1 are warm — so the first spec's requests do not flake


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


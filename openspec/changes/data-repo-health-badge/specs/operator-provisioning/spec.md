## ADDED Requirements

### Requirement: Health token may be supplied as an operator variable

The operator SHALL be able to supply `HEALTH_TOKEN` as a plaintext `var` in their data-repo `wrangler.jsonc`, in addition to the existing Worker-secret form. Because `vars` are operator-owned in the config merge and are deployed to the Worker as environment values, a `HEALTH_TOKEN` var SHALL reach the Worker as `env.HEALTH_TOKEN` with **no change to the merge** and **no change to how the Worker reads the token**. Supplying it as a var SHALL be optional; when neither the var nor the secret is set, `/health` and `/health.svg` SHALL remain disabled (`404`). Storing the token in the **private** data repo is the supported way to make it available to the deploy for badge stamping.

#### Scenario: A health-token var reaches the Worker

- **WHEN** the operator sets `vars.HEALTH_TOKEN` in `wrangler.jsonc` and deploys
- **THEN** the deployed Worker reads it as `env.HEALTH_TOKEN`, enabling `/health` and `/health.svg`

#### Scenario: The secret form still works

- **WHEN** `HEALTH_TOKEN` is set as a Worker secret and not as a var
- **THEN** the endpoints behave exactly as before (the var is additive, not a replacement)

#### Scenario: Unset leaves the endpoints disabled

- **WHEN** neither the `HEALTH_TOKEN` var nor the secret is set
- **THEN** both `/health` and `/health.svg` respond `404`

### Requirement: Deploy optionally stamps the README health badge

When the operator has set both `HEALTH_TOKEN` (var) and the `WORKER_HOST` repo variable, the deploy SHALL render a health-badge markdown snippet pointing at `https://<WORKER_HOST>/health.svg?token=<HEALTH_TOKEN>` and SHALL maintain it in the data-repo README inside an **idempotent marker block**. The deploy SHALL replace the content between existing badge markers when present, and SHALL otherwise insert the marker block immediately after the README's first heading (so a repo created from an older template gains the badge without a manual paste). `WORKER_HOST` SHALL be passed into the reusable deploy workflow by the thin caller (mirroring how the plugin build passes its connector host), not resolved by guessing. When either `HEALTH_TOKEN` or `WORKER_HOST` is absent, the deploy SHALL skip stamping and still succeed (the badge is opt-in).

#### Scenario: Badge is stamped when configured

- **WHEN** both `HEALTH_TOKEN` and `WORKER_HOST` are set and the deploy can write back to the repo
- **THEN** the README contains the marker block with the correct `/health.svg` URL

#### Scenario: Re-stamp is idempotent

- **WHEN** the badge markers already exist and the deploy runs again with an unchanged URL
- **THEN** only the content between the markers is updated and the README is otherwise unchanged

#### Scenario: Existing repo gains the badge

- **WHEN** the README has no badge markers
- **THEN** the deploy inserts the marker block immediately after the first heading

#### Scenario: Skipped when not opted in

- **WHEN** `HEALTH_TOKEN` or `WORKER_HOST` is unset
- **THEN** the deploy does not modify the README and still completes successfully

### Requirement: Pin-back is optional with a manual fallback

Persisting deploy-time values back into the operator's data repo — the README health badge **and** the auto-provisioned KV/D1 ids — SHALL be optional and SHALL NOT be required for a successful deploy. When the deploy lacks `contents: write` (or the operator prefers manual setup), it SHALL NOT fail; it SHALL instead surface what the operator needs to apply by hand. In particular, when `HEALTH_TOKEN` and `WORKER_HOST` are set, the deploy SHALL **always** write the ready-to-paste health-badge snippet to the workflow job summary, regardless of whether it could commit the change. An operator SHALL be able to run the deploy without granting `contents: write` and complete badge setup (and id pinning) manually.

#### Scenario: Deploy without write permission still succeeds

- **WHEN** the deploy cannot push back because the caller did not grant `contents: write`
- **THEN** the deploy completes successfully and warns, rather than failing

#### Scenario: The badge snippet is always surfaced

- **WHEN** the deploy runs with `HEALTH_TOKEN` and `WORKER_HOST` set
- **THEN** the ready-to-paste badge snippet appears in the job summary whether or not it was committed back

#### Scenario: Manual setup is supported end to end

- **WHEN** an operator declines `contents: write` and pastes the badge snippet from the job summary into their README once
- **THEN** the badge renders and keeps working, because the token and host are stable (no recurring pin-back needed)

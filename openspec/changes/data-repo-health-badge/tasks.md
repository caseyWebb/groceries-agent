## 1. Worker — `/health.svg` SVG card

- [ ] 1.1 In `src/health.ts`, add a pure-JS `renderHealthSvg(payload)` that string-templates an SVG **card** from a `HealthPayload`: a healthy/degraded headline (mirrors `payload.ok`) plus one row per job (`HEALTH_JOBS` order) showing ok/fail/never-run + a relative last-run ("2h ago", from `generated_at - last_run_at`), and a D1 row. Use a monospace font + fixed columns (no font-metric math). Colors: ok=green, fail=red, never-run=amber. Escape all interpolated text.
- [ ] 1.2 Add a `handleHealthSvgRequest(request, env)` (or extend the health module) reusing `buildHealthPayload(...)`: same token gate as `/health` (404 when `HEALTH_TOKEN` unset, 401 on missing/wrong token via `?token=` or `Authorization: Bearer`), but respond **200 always** with `content-type: image/svg+xml` and a short `Cache-Control` (~120s). Never throw out of the handler.
- [ ] 1.3 In `src/index.ts`, route `url.pathname === "/health.svg"` to the new handler (alongside the existing `/health` line).

## 2. Worker — tests

- [ ] 2.1 Extend `test/health.test.ts`: `/health.svg` responds 404 when `HEALTH_TOKEN` unset and 401 on wrong/missing token.
- [ ] 2.2 Healthy case: 200, `content-type: image/svg+xml`, body is SVG and contains each job row + D1 (use a fake KV/D1 like the existing `/health` tests).
- [ ] 2.3 Degraded case (a failing job and/or failing D1 probe): still **200** (not 503), and the SVG reflects the degraded state.
- [ ] 2.4 Never-run case renders the pending/amber style for the cold job; assert it is distinct from healthy/failing.
- [ ] 2.5 Tenant-clean assertion: the SVG body contains no per-tenant identifiers (mirror the existing `/health` no-tenant-data test).

## 3. Deploy workflow (code repo) — optional README stamping

- [ ] 3.1 In `.github/workflows/data-deploy.yml`, add an optional `worker_host` `workflow_call` input.
- [ ] 3.2 Add a step that reads `HEALTH_TOKEN` from the operator's `wrangler.jsonc` (via `merge-wrangler-config.mjs`/JSON5 parse, the config already parsed in the deploy) and, when both it and `worker_host` are present, builds the badge snippet `![grocery-mcp health](https://<worker_host>/health.svg?token=<token>)`.
- [ ] 3.3 Stamp the data-repo README: replace content between `<!-- health-badge:start -->` / `<!-- health-badge:end -->` markers if present, else insert the marker block immediately after the first heading. Implement as a small `merge-wrangler-config.mjs`-style helper or inline node script (keep it unit-testable if extracted).
- [ ] 3.4 Commit the README back using the **same graceful posture** as the id pin-back step (warn, don't fail, when `git push` is denied for lack of `contents: write`).
- [ ] 3.5 **Always** write the ready-to-paste badge snippet to `$GITHUB_STEP_SUMMARY` (as `data-onboard.yml` surfaces the invite code), whether or not the commit succeeded. Skip the whole step with a clear note when `HEALTH_TOKEN` or `worker_host` is absent.
- [ ] 3.6 If the marker replace-or-insert logic is extracted to a script, add a focused tooling test (`tests/*.test.mjs`, fixture-based) covering: replace-between-markers, insert-after-first-heading, and idempotent re-run.

## 4. Data-template repo (cross-repo — `caseyWebb/groceries-agent-data-template`, branch `claude/data-repo-health-badge-vag3ik`)

- [ ] 4.1 In the template `deploy.yml` caller, pass `worker_host: ${{ vars.WORKER_HOST }}` into the reusable `data-deploy.yml` (mirroring how `build-plugin.yml` passes `mcp_url`).
- [ ] 4.2 In the template `README.md`, add the `<!-- health-badge:start -->`/`<!-- health-badge:end -->` marker block under the first heading and a short "health badge" note (what it shows, that it needs `HEALTH_TOKEN` + `WORKER_HOST`, that it refreshes on a TTL).
- [ ] 4.3 In the template `wrangler.jsonc`, add a commented `HEALTH_TOKEN` example var (e.g. `// "HEALTH_TOKEN": "<random string>"  // enables /health + /health.svg badge`).

## 5. Docs (code repo — same pass, no-drift)

- [ ] 5.1 `docs/SELF_HOSTING.md`: document `HEALTH_TOKEN` as an optional var (recommended when you want the badge) vs. the existing secret; the health badge and how it's stamped; and a **manual runbook** for operators without `contents: write` (copy the snippet from the deploy job summary into the README once).
- [ ] 5.2 `docs/SELF_HOSTING.md`: reframe pin-back (README badge **and** KV/D1 ids) as explicitly **optional/manual-supported** — running the deploy without `contents: write` is a supported path, not a failure.
- [ ] 5.3 `docs/TOOLS.md`: document the `/health.svg` route and its **200-always, `image/svg+xml`, TTL-cached** contract, noting `/health` stays `200`/`503` JSON and that HTTP-status monitors must target `/health` (not `.svg`).

## 6. Validate & verify

- [ ] 6.1 `aubr typecheck` and `aubr test` (Worker) green; `aubr test:tooling` green if a stamping helper test was added.
- [ ] 6.2 Manually render the SVG (e.g. via `aubr dev` + a local `HEALTH_TOKEN`) and eyeball the card in a browser for healthy, degraded, and never-run states; confirm it reads on both light and dark backgrounds (per the design's theming open question).
- [ ] 6.3 `npx @fission-ai/openspec validate "data-repo-health-badge"` passes.
- [ ] 6.4 Confirm the contract docs are in lockstep (no drift) before opening the PR; fill the PR template per CLAUDE.md.

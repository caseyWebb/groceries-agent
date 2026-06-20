## 1. Merge helper

- [ ] 1.1 Create `scripts/merge-wrangler-config.mjs` exporting a pure `mergeWranglerConfig(codeConfig, operatorConfig)` that applies the per-key rule table from design.md: code-level keys (`main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`, `workers_dev`) from code; `name`/`routes`/`vars` operator-overlay; `kv_namespaces` merged by binding name with **operator or absent ids only** (code ids dropped).
- [ ] 1.2 Parse JSONC (both inputs have comments) — reuse the repo's existing JSON/TOML tooling or a JSONC parser, not raw `JSON.parse`. Provide a small CLI wrapper (`node scripts/merge-wrangler-config.mjs <operator.jsonc> <code.jsonc>` → merged JSON on stdout / written in place) for the workflow.

## 2. Tests (the security-critical core)

- [ ] 2.1 `tests/merge-wrangler-config.test.mjs` (Node `--test`, like the other tooling tests):
  - code `triggers.crons` propagate when the operator config lacks them
  - `compatibility_date`/`compatibility_flags` come from code even when the operator's differ
  - operator `name`/`routes`/`vars` win
  - **`kv_namespaces`: operator id wins AND the code repo's id never appears in the output**
  - a code-only binding appears **without an id** (auto-provision)
  - an operator-declared id-less binding stays id-less

## 3. Wire into the deploy

- [ ] 3.1 In `.github/workflows/data-deploy.yml`, replace the `cp "<operator config>" _code/wrangler.jsonc` overlay step with a step that runs the merge (operator config + `_code/wrangler.jsonc` → `_code/wrangler.jsonc`), positioned after `npm ci` (so the toolchain is available) and before Deploy.
- [ ] 3.2 Confirm the downstream steps still work over the merged config (auto-provision writes ids back; `--var` coord injection; onboard/revoke unaffected since they read the operator's config, not the merged one).

## 4. KV-id footgun (open question)

- [ ] 4.1 Decide the open question: scrub the maintainer's real KV ids from the **code repo's** `wrangler.jsonc` (replace with id-less bindings) in addition to the merge-strip. If yes, do it and confirm the maintainer's own deploy path still provisions correctly; if deferred, rely on the merge-strip + tests and note the residual footgun.

## 5. Docs (same pass — no drift)

- [ ] 5.1 `docs/SELF_HOSTING.md`: remove the manual "add `triggers` to your data-repo `wrangler.jsonc`" stopgap; describe the merged-config model and exactly what an operator's `wrangler.jsonc` is responsible for now (KV ids, `routes`/domain, `name`, account `vars`).
- [ ] 5.2 `CONTRIBUTING.md` and/or `docs/ARCHITECTURE.md`: document the code-vs-operator wrangler ownership boundary (the rule table) so future wrangler changes land in the right place.
- [ ] 5.3 `wrangler.jsonc`: update/remove the heads-up comment at the `triggers` block (the manual-sync caveat no longer applies once this lands).

## 6. Ship

- [ ] 6.1 `npm run test:tooling` (incl. the new merge tests) + `npm run typecheck` green.
- [ ] 6.2 After merge + operator redeploy: confirm the cron registers in Cloudflare and `/health`'s `flyer-warm` job transitions from `never_run` to `ok` within a sweep interval.

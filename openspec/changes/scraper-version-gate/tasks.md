## 1. CI version-bump gate

- [ ] 1.1 Add a `scraper-version` job to `.github/workflows/ci.yml`, gated `if: github.event_name == 'pull_request'`; `permissions: contents: read`; `actions/checkout` with `fetch-depth: 0` (pin the same action SHA the other jobs use).
- [ ] 1.2 Detect touched paths: `git diff --name-only "origin/${{ github.base_ref }}...HEAD" -- packages/scraper packages/contract`; if empty, pass as a no-op.
- [ ] 1.3 When touched: read the base version (`git show "origin/${{ github.base_ref }}:packages/scraper/package.json"`) and the head version; FAIL unless the head `version` is strictly greater (semver) than the base; emit a clear `::error::` naming both versions and the fix (bump `packages/scraper/package.json` `version`).
- [ ] 1.4 Exempt bot authors (login ending in `[bot]`) with a neutral pass, mirroring `pr-checklist.yml`.
- [ ] 1.5 Use only the built-in `GITHUB_TOKEN`; do not reference `DATA_REPO_ACTIONS_TOKEN`; the job never commits.

## 2. PR template

- [ ] 2.1 Add one `- [ ]` considerations item to `.github/pull_request_template.md` (scraper-version bump; the not-applicable case folded into the wording). Keep the `<!-- pr-checklist:v1 -->` sentinel and the section headings intact.

## 3. Spec + docs

- [ ] 3.1 On archive, apply the `build-automation` spec delta (`specs/build-automation/spec.md`) into `openspec/specs/build-automation/spec.md`.
- [ ] 3.2 `CONTRIBUTING.md`: add a short scraper-versioning subsection (package.json `version` is the SoT; a scraper/contract change bumps it; the CI gate + the checklist item enforce it; strictly-greater semver). Place it near "Opening a pull request" / "Deployment".

## 4. Verification

- [ ] 4.1 Fixture PRs: scraper change without a bump fails; scraper (or contract) change with a strictly-greater bump passes; docs-only / Worker-only PR no-ops; bot PR neutral-passes.
- [ ] 4.2 `openspec validate "scraper-version-gate" --strict`; run `/code-review` on the diff before opening the PR.
- [ ] 4.3 Archive before merge (`/opsx:archive`) — the `no-open-changes` job blocks merge while the change dir is unarchived. To make the gate merge-blocking, add the `scraper-version` check to `main`'s required status checks (operator repo-settings step, as with the other gates).

## Context

The repo has no `.github/dependabot.yml`. npm packages and GitHub Actions are unmonitored — no automated PRs for updates, no security alert surfacing. Actions are pinned to mutable major-version tags (`@v4`, `@v5`, `@v6`), which are vulnerable to supply-chain tag-mutation attacks (a compromised upstream maintainer account can push malicious code to the tag without changing the tag name).

CI already runs typecheck + tests on every PR, so Dependabot PRs will be automatically validated. One subtlety: the `trigger-deploy` job in `ci.yml` fires on merges to `main` that touch `package.json` or `package-lock.json`, meaning every merged npm Dependabot PR triggers a Worker redeploy.

## Goals / Non-Goals

**Goals:**
- Automated PRs for npm updates (security vulnerabilities and version drift)
- Automated PRs for GitHub Actions updates
- Reduce per-PR noise by grouping related npm packages
- Eliminate mutable-tag risk by SHA-pinning all Actions (initial pin done in this change; Dependabot maintains them going forward)

**Non-Goals:**
- Auto-merge (manual review is preserved given deploy coupling)
- PR labeling, reviewer assignment, or custom commit messages
- Pinning npm packages to exact versions (semver ranges are fine)

## Decisions

### SHA-pin Actions on first pass, not via Dependabot

Dependabot updates existing SHAs but does not convert mutable tags to SHAs. The initial conversion must be done manually. Once SHAs are in place, Dependabot's `github-actions` updater will keep them current, adding a comment with the human-readable tag equivalent (e.g., `# v4.2.2`).

*Alternative considered:* Leave tags as-is and rely solely on Dependabot version bumps. Rejected because tags remain mutable between Dependabot update intervals — a compromised tag could persist for up to a week undetected.

### Weekly cadence, no auto-merge

Weekly matches Dependabot's default and balances freshness against review noise. No auto-merge is set because npm Dependabot PRs touching `package-lock.json` automatically trigger a Worker deploy on merge — auto-merge would remove the human checkpoint before production changes.

*Alternative considered:* Daily cadence. Rejected — too much noise for a solo/small-team project.

### Group Cloudflare and MCP packages

`wrangler` and `@cloudflare/workers-types` are released on Cloudflare's coordinated schedule; reviewing them together reduces context-switching. `agents` and `@modelcontextprotocol/sdk` form the MCP runtime stack — compatibility issues between them are best caught in a single PR rather than two sequential ones.

*Alternative considered:* No grouping. Fine for this dep count, but grouping is free and the groupings are semantically meaningful.

### Seven Actions to SHA-pin across seven workflow files

The affected Actions: `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/upload-pages-artifact`, `actions/configure-pages`, `actions/deploy-pages`, `cloudflare/wrangler-action`. SHA resolution happens at implementation time via the GitHub API or Actions release pages.

## Risks / Trade-offs

**Deploy coupling** → Every merged npm Dependabot PR deploys the Worker. Mitigation: manual merge gate (no auto-merge). Acceptable because a human is already in the loop.

**SHA comment drift** → Dependabot adds a `# vX.Y.Z` comment next to each SHA. If someone edits the SHA manually without updating the comment, the comment becomes misleading. Mitigation: none needed — Dependabot overwrites both SHA and comment on each update.

**devDep bumps trigger deploy** → A `vitest` or `typescript` bump in `package.json` still touches `package-lock.json` and fires the deploy trigger. These are safe but wasteful deploys. Mitigation: acceptable noise; the deploy is idempotent and the Worker code hasn't changed.

## Migration Plan

1. Add `.github/dependabot.yml` (new file, no existing state to migrate)
2. Resolve current commit SHAs for all seven Actions at their current tags
3. Replace `@vN` tags with `sha@...  # vN.M.P` in all seven workflow files
4. Merge to main — first Dependabot scan will run on the weekly schedule from that point

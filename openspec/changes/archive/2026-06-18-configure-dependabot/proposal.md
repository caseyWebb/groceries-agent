## Why

The repo has no Dependabot configuration, so npm packages and GitHub Actions are never automatically flagged for security vulnerabilities or version drift. Actions are pinned to mutable major-version tags (`@v6`, `@v4`) which are vulnerable to supply-chain tag-mutation attacks.

## What Changes

- Add `.github/dependabot.yml` enabling automated update PRs for both the `npm` and `github-actions` ecosystems (weekly cadence)
- Group related npm packages (`@cloudflare/*` + `wrangler`; `@modelcontextprotocol/*` + `agents`) to reduce PR noise
- SHA-pin all GitHub Actions across every workflow file, replacing mutable `@vN` tags with immutable commit SHAs (Dependabot will keep these current going forward)

## Capabilities

### New Capabilities

- `dependency-automation`: Automated dependency update PRs via Dependabot for npm and GitHub Actions, with grouped updates and SHA-pinned Actions for supply-chain security

### Modified Capabilities

*(none — no existing spec-level behavior changes)*

## Impact

- `.github/dependabot.yml` — new file
- `.github/workflows/ci.yml` — Actions SHA-pinned
- `.github/workflows/data-build-indexes.yml` — Actions SHA-pinned
- `.github/workflows/data-build-plugin.yml` — Actions SHA-pinned
- `.github/workflows/data-build-site.yml` — Actions SHA-pinned
- `.github/workflows/data-deploy.yml` — Actions SHA-pinned
- `.github/workflows/data-onboard.yml` — Actions SHA-pinned
- `.github/workflows/data-revoke.yml` — Actions SHA-pinned

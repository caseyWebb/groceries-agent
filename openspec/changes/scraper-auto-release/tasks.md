## 1. Reusable release workflow + bug fixes

- [ ] 1.1 Refactor `.github/workflows/scraper-release.yml` triggers: `on: workflow_call` with a required `version` input (the auto path) + `workflow_dispatch` with **no** `version` input (manual fallback). Drop `on: push: tags: ["scraper-v*"]` (recommended in design — a human tag reintroduces tag/version drift; the fallback is `workflow_dispatch`). Keep `permissions: { contents: write, packages: write }`.
- [ ] 1.2 Derive/verify version from `packages/scraper/package.json` `version` (the single source of truth). When a `version` input is provided (workflow_call), assert it equals the `package.json` version and fail fast on mismatch. Construct the tag as `scraper-v<version>`. Retain the `CONTRACT_VERSION` grep from `packages/contract/src/ingest.ts` for the Release-notes body only.
- [ ] 1.3 Fix the `tag_name` bug: set the `softprops/action-gh-release` `tag_name` to `scraper-v<version>` (derived), never `${{ github.ref_name }}`.
- [ ] 1.4 Remove the dead `build-args:` block (`SCRAPER_VERSION`/`CONTRACT_VERSION`) from the `docker/build-push-action` step — the Dockerfile declares no matching `ARG` and the running scraper derives both at runtime. Leave the multi-arch `platforms: linux/amd64,linux/arm64`, QEMU/Buildx setup, GHCR login, `:latest`, and the embedded-version guarantee intact. **The Dockerfile needs no edit.**

## 2. Idempotence guard

- [ ] 2.1 Add an early guard step to the `publish` job: if a Release/tag `scraper-v<version>` already exists (`gh release view "scraper-v$version"` with `GH_TOKEN: ${{ github.token }}`), skip the build/push/release steps and succeed as a no-op. Gate the remaining steps on the guard's "not published" output. This makes re-runs, `workflow_dispatch` at an already-published version, and accidental double-fires safe.

## 3. Main-push version-change detector (ci.yml)

- [ ] 3.1 Add a push-only `detect-scraper-version` job to `.github/workflows/ci.yml` (`if: github.event_name == 'push'`), `actions/checkout` with `fetch-depth: 2`, reading `packages/scraper/package.json` `version` at `HEAD` and at `HEAD^` (`git show HEAD^:packages/scraper/package.json`), emitting `changed` + `version` outputs. If `HEAD^` lacks the file or it does not parse, treat the version as changed (the idempotence guard prevents an actual double-publish).
- [ ] 3.2 Add a `release-scraper` job that `uses: ./.github/workflows/scraper-release.yml`, `needs: [detect-scraper-version, test, no-open-changes]`, `if: needs.detect-scraper-version.outputs.changed == 'true'`, `with: { version: <detected> }`, and `permissions: { contents: write, packages: write }`. This mirrors `trigger-deploy`'s push-only, CI-gated shape.
- [ ] 3.3 Confirm the `trigger-deploy` path filter is **unchanged** — it still excludes `packages/scraper/**`, so a scraper version bump publishes the image without deploying the Worker, and a Worker change never publishes a scraper image (the two remain independent control planes).

## 4. Docs (in lockstep)

- [ ] 4.1 Reword any maintainer-facing "push a `scraper-v*` tag to cut a release" instruction (`CONTRIBUTING.md`, `docs/SELF_HOSTING.md`, `packages/scraper/README.md`) to "bump `packages/scraper/package.json` `version`; the merge to `main` auto-publishes the `scraper-v<version>` image + Release." Leave operator-facing "pull the image from GHCR" text unchanged.

## 5. Verification

- [ ] 5.1 `openspec validate "scraper-auto-release" --strict` passes.
- [ ] 5.2 Lint/inspect the workflow YAML (e.g. `actionlint` if available) for a valid `workflow_call` reusable signature, correct `needs`/`if`, and `uses:` job permissions.
- [ ] 5.3 Static trigger-matrix walkthrough (documented in the PR): (a) push to `main` with a version bump + green CI → publishes once; (b) push with no version change → publishes nothing; (c) a version-bump push whose `scraper-v<version>` release already exists (re-run) → no-ops; (d) PR / `workflow_dispatch` → detector does not fire the auto path; (e) `workflow_dispatch` at the current version → publishes iff not already published; (f) confirm no `packages/scraper/**` entry crept into the deploy path filter.
- [ ] 5.4 **End-to-end can only be fully verified by a real merge to `main` that bumps `packages/scraper/package.json` `version`** — this is CD; the publish path has no pre-merge dry-run. Expected: on that merge, CI cuts `scraper-v<version>`, pushes the multi-arch image to GHCR, and the Worker deploy does not fire. Note this explicitly in the PR as the acceptance step to watch post-merge.
- [ ] 5.5 Run `/code-review` on the diff before opening the PR.
- [ ] 5.6 **Archive this change** (`openspec archive`) before opening the PR — `ci.yml`'s `no-open-changes` job blocks merge while any unarchived change dir exists.

## Notes

- **Sequencing:** rebase onto a `main` that already carries `scraper-multiarch-image` (multi-arch workflow + spec) and `scraper-version-gate` (the human version-bump enforcement this change assumes). The modified `build-automation` requirement is layered on the post-multi-arch text.
- **No repo mutation on publish:** no version-bump commit, no committed tag on a branch; the tag is created only as part of the Release.

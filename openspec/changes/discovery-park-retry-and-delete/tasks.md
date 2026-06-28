# Tasks — discovery-park-retry-and-delete

## 1. Data model
- [ ] 1.1 Migration `0018_discovery_retry.sql`: add `attempts INTEGER NOT NULL DEFAULT 0` and `next_retry_at TEXT` to `discovery_log`; add `CREATE INDEX idx_discovery_log_retry ON discovery_log(outcome, next_retry_at)`.
- [ ] 1.2 `docs/SCHEMAS.md`: document the two new columns and their semantics; note `detail.reason = "ok"` is retired.

## 2. Sweep retry core (`src/discovery-sweep.ts`)
- [ ] 2.1 Add `retryBackoffMinutes`, `retryMaxAttempts`, `retryFetchMaxPerTick` to `DiscoveryConfig` + `DEFAULT_CONFIG` (placeholders: `[60,360,1440,4320]`, `5`, a value `< fetchMaxPerTick`).
- [ ] 2.2 Extract the per-candidate loop body into `processCandidate(deps, candidate, ctx, opts)` where `opts.existingRowId` selects resolve-in-place vs INSERT.
- [ ] 2.3 Resolve-in-place path: on success update the existing row (outcome/detail/slug, clear `next_retry_at`); on transient re-failure bump `attempts` + set next backoff, or terminalize at the cap (`unreachable` → terminal `error`; `failed` → terminal `error`).
- [ ] 2.4 Fresh-park path: when first parking `unreachable`/`failed`, set `attempts=1` + `next_retry_at = now + backoff(1)`.
- [ ] 2.5 Add the retry stream to `loadCandidates`/the deps: gather due retryable rows (excluding rejected URLs) as `SweepCandidate`s carrying their row id; process under `retryFetchMaxPerTick` after fresh intake.

## 3. DB layer (`src/discovery-db.ts`)
- [ ] 3.1 `loadEvaluatedUrls` stays all-logged-urls for fresh dedup; add `loadDueRetries(env, nowIso, limit)` returning due retryable rows (`outcome IN ('error','failed') AND next_retry_at <= now`, minus rejections).
- [ ] 3.2 `resolveDiscoveryRow(env, id, entry)` (update outcome/detail/slug/next_retry_at) and `bumpDiscoveryRetry(env, id, attempts, nextRetryAt)`.
- [ ] 3.3 `deleteDiscoveryRow(env, id)`; reuse `addDiscoveryRejection` for the rejection half.
- [ ] 3.4 Remove `readLegacyUnreachable` and `updateDiscoveryDetail` (only the re-probe used them).

## 4. Admin API (`src/admin.ts`)
- [ ] 4.1 `POST /admin/api/discovery/:id/retry` → run `processCandidate` once via `buildDiscoveryDeps`, override backoff/cap, only for `error`/`failed`, return resolved row; `405` otherwise.
- [ ] 4.2 `DELETE /admin/api/discovery/:id` → `addDiscoveryRejection(canonical(url))` + `deleteDiscoveryRow`; idempotent; `405` otherwise.
- [ ] 4.3 Remove the `POST /admin/api/discovery/reprobe-parked` route.

## 5. Remove the relabel re-probe
- [ ] 5.1 `src/discovery-probe.ts`: delete `reprobeParked` + `ReprobeResult` + `REPROBE_BATCH_CAP`; keep `probeFeed` and the feed-probe types.
- [ ] 5.2 `admin/src/Logs.elm`: replace the re-probe button/`ReprobeState`/`ReprobeSummary` with per-row Retry/Delete actions and their single-state model; drop `postReprobe`/`reprobeSummaryDecoder` and the now-unused outcome relabeling.
- [ ] 5.3 Rebuild `admin/dist` (`aubr build:admin`) and commit, or note CI rebuild if `package.elm-lang.org` is unreachable.

## 6. Tests
- [ ] 6.1 `test/discovery-sweep.test.ts`: due retry re-admitted + resolved in place; recover→import; repeated-fail backoff/terminalize; exhausted `failed`→terminal `error` (health clears); rejected URL never re-admitted; retry sub-budget doesn't starve fresh.
- [ ] 6.2 `test/admin-discovery.test.ts` (+ `admin-logs`): `:id/retry` happy/override/non-retryable/`405`/`404`; `DELETE :id` rejects+removes, idempotent, `404`.
- [ ] 6.3 `admin/tests/LogsTest.elm`: per-row action state model.
- [ ] 6.4 Remove `reprobe`-specific tests (`admin-feed-probe`/`admin-discovery`/`LogsTest`) for the deleted endpoint.

## 7. Docs
- [ ] 7.1 `docs/ARCHITECTURE.md`: discovery-sweep retry lifecycle; admin Retry/Delete; removed re-probe.
- [ ] 7.2 `docs/TOOLS.md`: `read_discovery_errors` note — `failed` is transient/in-retry; exhausted infra failures terminalize to `error`.

## 8. Validate
- [ ] 8.1 `openspec validate discovery-park-retry-and-delete --strict`; `aubr typecheck`; `aubr test`; `aubr test:tooling`.

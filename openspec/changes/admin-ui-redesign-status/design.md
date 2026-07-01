## Context

The Status area is the first redesigned surface to consume the foundation's component kit. The handoff mock (`StatusScreen.jsx`) shows: corpus stat tiles (Recipes/Members/RSS feeds/Cached SKUs), a "Background jobs" `ItemGroup` where each job carries an uptime sparkline (per-run ok/fail bars + % uptime) and a "Healthy/Unhealthy since" line, and a separate "Dependencies" group (D1 probe, admin gate). The overall rollup already moved to the global health dock (the foundation change).

Two of these are not backed today:
- **Per-run history.** `job_health` (migration 0019) upserts one last-state row per job — no per-run series. `recordUsagePoint` streams to the `grocery_usage` Analytics Engine dataset, but that is per-day aggregate metrics (`runs`, `avg_ms`) with no individual-run `ok` outcome and no stable id to link a bar to a log. The mock's sparkline is per-run, ok/fail-coloured, and (downstream) clickable to a log entry. So it needs a real per-run store.
- **Corpus counts.** Recipe/member/feed/SKU counts are simple aggregates not currently assembled in one reader.

## Goals / Non-Goals

**Goals:**
- A bounded D1 `job_runs` history, appended on every background-job run, with a reader for the last N runs per job + the current-streak start ("healthy since").
- A small corpus-counts reader (recipes, members, feeds, cached SKUs).
- The redesigned Status page composing the foundation kit (`StatCardGrid`/`StatCard`, `Item`/`ItemGroup`, `Sparkline`, `Badge`), staying SSR.

**Non-Goals:**
- The Logs area's dedicated all-jobs run-log *view* — it consumes `job_runs` but is its own change.
- The sparkline bar→log **deep-link** — the target (a Logs detail by run id) lands with Logs; here the sparkline is read-only.
- Any new client island — Status stays pure SSR (the mock's hover tooltip + bar click are deferred with Logs).
- Backfilling history for runs before this ships — the sparkline fills in as new runs accrue.

## Decisions

**1. `job_runs` is a new bounded D1 table, written beside `job_health`.**
Shape: `id TEXT, job TEXT, ok INTEGER, ran_at INTEGER, duration_ms INTEGER, summary TEXT (JSON)`, indexed on `(job, ran_at DESC)`. A `writeJobRun(env, name, record)` in `src/health.ts` appends through `src/db.ts` (storage error → no-op, mirroring `writeJobHealth`), and prunes that job's rows beyond a fixed per-job cap (e.g. keep the most recent ~100). `readJobRuns(env, name, limit)` returns the last N newest-first; a sibling derives the current-streak start by scanning newest→older while `ok` is unchanged.
*Alternative considered:* read the sparkline from the `grocery_usage` AE dataset. Rejected — no per-run `ok` outcome and no stable id, so neither the fail-bars nor the (downstream) log link are expressible; "build backing now" was the chosen posture.
*Alternative considered:* store run history in KV. Rejected — same standing-write-load rationale that put `job_health` in D1.

**2. The writer hooks the existing `writeJobHealth` call sites.**
Every place a job already records health (`src/index.ts` scheduled/email; the per-job modules) gains a `writeJobRun` next to it, sharing the same `ok`/`summary` and a freshly-stamped `ran_at`/`duration_ms`/`id`. Keeping the two writes adjacent means a job can't report health without also appending history.
*Alternative considered:* a single combined `recordJobRun` that does both writes. Tempting, but `writeJobHealth` is an established contract with its own spec scenarios; a separate additive writer is the smaller, lower-risk change. (A later refactor could merge them.)

**3. "Healthy since" is derived, not stored.**
The streak start is computed from `job_runs` (earliest run in the current unbroken `ok`-streak), not a new `job_health` column — no field that can drift from the run log.

**4. Status stays SSR; the page reads everything in-process.**
The page calls `buildHealthPayload`, the corpus-counts reader, and `readJobRuns` per job directly (SSR), then composes the kit. No island — consistent with the panel's "a page that only reads is pure SSR" rule and the foundation's relocation of the only interactive bit (the dock).

## Risks / Trade-offs

- **[Write amplification: a second D1 write per cron run.]** → One small append + an occasional prune per job per tick. Negligible against D1's budget and the same load class as `job_health`; the prune is a bounded `DELETE … WHERE id NOT IN (recent)` or `ran_at <` cutoff.
- **[Unbounded growth if pruning regresses.]** → The spec makes "bounded per job" a requirement with a scenario; the writer prunes on every append, and the index keeps the prune/read cheap.
- **[Coupling with Logs.]** → Intentional: Status introduces `job_runs`; Logs consumes it for the dedicated log view. The reader returns ids now so the Logs deep-link wires up without a data change. Documented in the proposal.
- **[Delta-on-delta on the Status health requirement.]** → This change ADDS new Status requirements rather than re-MODIFYing the foundation's just-modified "Status homepage surfaces service health" block, so the two changes don't fight over one requirement. **Archive ordering:** `admin-ui-redesign-foundation` must archive before this change.
- **[The sparkline shows nothing until runs accrue.]** → Acceptable and specified (a job with no history omits the sparkline); history fills in within a few cron ticks.

## Migration Plan

1. Add `migrations/d1/00NN_job_runs.sql` (table + index); the deploy applies it `--remote`.
2. Add `writeJobRun`/`readJobRuns` + streak helper to `src/health.ts`; add the corpus-counts reader.
3. Append `writeJobRun` at the existing `writeJobHealth` call sites.
4. Rebuild `src/admin/pages/status.tsx` over the kit: stat tiles, job rows (glyph/name/age/badge/chips + sparkline + since), dependencies group.
5. `aubr build:admin`, `aubr typecheck`, `aubr test` (extend the Status SSR test for tiles + uptime + since; add `job_runs` writer/reader unit tests).

Rollback is a revert; the new table is additive (no existing data touched), so a rollback simply stops writing/reading it.

## Open Questions

- Per-job retention cap and sparkline window — propose ~100 retained, last ~20–30 shown. Confirm the shown window during apply against the mock's density.
- Should `duration_ms` come from the existing `recordUsagePoint` duration path (already measured) or be measured independently at the `writeJobRun` site? Leaning toward reusing the measured duration where the call site already has it.

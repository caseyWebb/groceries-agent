# Design: audit-pass-card-burndown

## Context

The Normalize › Audits tab (`packages/worker/src/admin/pages/audits.tsx`, model in `packages/worker/src/audit-admin.ts`) renders a backlog-burndown hero (alias + edge un-audited counts with back-summed series) above three pass cards that show this-tick activity only (worked/changed sparkline + latest-run summary chips). The operator wants each pass card to carry its own current burndown status, and the surface to reflect the newest convergence work: the edge audit's one-shot replay (#192) and the disjunction shape sweep (the normalize job's `disjunction*` summary counters, which are persisted per run but surfaced nowhere in the admin today).

Constraints: SSR only, no new client JS; compose strictly from the design handoff's `au-*` vocabulary (`BurndownSpark`, `au-pass*`, `au-burn*`, tones `g`/`p`/`b`) and the existing Loadable/discriminated-union modeling; reads stay bounded; no job summary shapes change (reader/display-side only, so `docs/SCHEMAS.md` and `docs/TOOLS.md` are untouched).

This is a data-density extension of a designed surface composed from the handoff's own components (precedent: the mappings-only chip). It deliberately does not fork the design language; if the operator wants it reflected upstream, the change is a natural prompt for the companion Claude Design project ("give each audit pass card its own backlog burndown: count + compact BurndownSpark + converging/converged chip, plus a fourth compact card for the disjunction sweep").

## Goals / Non-Goals

**Goals:**
- Every pass card carries its own burndown status: remaining backlog count, a compact `BurndownSpark` trend, and a converging/converged chip driven by that backlog (converged = green positive terminal, the same two-state language as the hero).
- The edge card surfaces the one-shot replay's done-state (un-replayed `edge_drop` backlog).
- The sku card gets an honest live-plan gauge (stampless pass — its backlog IS the current plan size), capped for display.
- The disjunction sweep gets a compact fourth card in the pass grid: live-concrete-disjunctive-id count burning to zero, with a trend from the normalize job's run history.
- Playwright coverage asserting a converging card and a converged card; vitest for the new derivations.

**Non-Goals:**
- No change to the hero's or the Status row's semantics: `AuditObservability.state` / `backlog.converged` remain alias+edge only (they feed the Status row and sub-nav dot; the disjunction gauge does not gate them).
- No new D1 columns, stamps, or job-summary fields; no changes to the audit jobs themselves.
- No island/hydration; no new colors or visual primitives; no Status-page cost increase.

## Decisions

### 1. New gauges live on `AuditSurface`, not `AuditObservability`

`readAuditObservability` is also the Status page's reader; the new gauges need corpus reads the Status row would never render. Extending `AuditObservability` would make the Status path either pay those reads or carry lying fields — the impossible-states antipattern. Instead `AuditSurface` (the Audits tab's one-shot payload) gains `gauges: AuditGauges`:

```ts
/** A pass card's own remaining-backlog gauge (count + trend). */
export interface PassGauge {
  /** Live remaining rows (a lower bound when capped). */
  count: number;
  /** True when count hit the display cap — rendered as "200+". */
  capped: boolean;
  /** Remaining-after-each-run, oldest→newest (trend only; may be empty). */
  series: number[];
}

/** The disjunction shape sweep's convergence gauge (normalize-job sub-pass). */
export interface DisjunctionGauge {
  /** Live concrete disjunctive ids — the sweep's quiesce predicate. */
  live: number;
  series: number[];
  /** Latest normalize run's disjunction* counters, short-labeled for chips. */
  summary: Array<[string, number]>;
  lastRun: number | null;
}

export interface AuditGauges {
  sku: PassGauge;
  replay: { pending: number; capped: boolean };
  disjunction: DisjunctionGauge;
}
```

The **alias and edge cards' gauges are not stored anywhere** — they are exactly the hero's live counts and back-summed series (`obs.backlog.alias`/`aliasSeries`, `.edge`/`edgeSeries`), assembled inline by the view ("derive, don't store"; zero re-query, per the operator's reuse instruction). `deriveAuditObservability`'s signature and the Status reader are untouched, so existing tests and the Status page are unaffected.

Card chip state is derived in the render: `converged = gauge.count === 0 && !gauge.capped` → the existing `settled`/`auditing` words with the existing `converged`/`converging` classes. The chip is now backlog-driven (the operator's ask) rather than latest-tick-no-op-driven; the this-tick caption over the worked sparkline keeps using `pass.settled`/`pass.worked` unchanged.

### 2. Sku gauge: run the pure planners over the same reads the cron does (cost: one small table + CPU)

The sku-cache re-key is stampless — the only honest backlog is the live plan size: `planSkuRekey(...).length + planAliasRetarget(...).length` (pending groups + eligible retargets, matching the job's own units). The reader performs the exact loading the job performs each 5-minute tick (`readResolver` + `readIdentitySources` + `readAliasTargets` + a full `sku_cache` SELECT) and runs the two exported pure planners.

The reader does **one identity scan and one alias scan, shared by everything**: `readIdentitySources` + `readAliasTargets` feed the representative chain, the alias front-door map (rebuilt locally with `readResolver`'s own `toId` construction — `variant → chase(id)` — so the resolver read is NOT repeated), both planners, *and* the disjunction count. Honest totals: the gauges add **five queries per Audits view** — the identity scan, the alias scan, the tiny `sku_cache` SELECT, a SQL-bounded un-replayed-drop probe, and a 15-row run window. Route-wide, `/normalize` then scans identity/alias **three times per view** (once each in `readNormalizationPage`, `readNodesPage`, and the gauges); threading one reader's rows into another was considered and rejected — the other readers' alias shapes lack the `audited_at` the retarget planner needs, and cross-reader row passing would serialize the route's parallel fan-out and couple reader signatures.

Why this is the cheapest *honest* gauge and not "running the full plan per request" in the expensive sense:
- The scans are operator-scale (hundreds to low thousands of rows), the same reads the cron performs every 5 minutes, and in-memory planning is O(rows).
- Alternatives rejected: (a) deriving pending from the last run's `truncated` flag is a *stale* zero (up to a tick old, and blind to drift between ticks — an alias merge landing after the tick shows "settled" while rows are off-key); (b) a SQL approximation can't exist — resolution goes through the alias front-door + representative chain + `normalizeIngredient`, which is JS.
- Display is capped at 200 (`AUDIT_GAUGE_CAP`, the `SKU_REKEY_MAX_PER_TICK` bound) → "200+"; the count itself is computed exactly (the plan is already in memory) but the model carries `capped` so the view never renders an unbounded-looking number.

The trend series is back-summed **from the model's own sku ticks** (`obs.passes` sku `ticks[].worked`), not from a second `readJobRuns`: `remaining_after(k) = pending_now + Σ worked(after k)`. `worked` includes `merged` collision losers, so the old tail reads slightly high — the same class of skew the file header already accepts for the hero series ("fine for a trend sparkline — the headline number is always the live count").

Failure mode: the corpus reads ride the same `Promise.all` as the existing backlog COUNTs — a failed read is a real `storage_error`, exactly like the counts (no partial/fabricated gauge).

### 3. Edge replay gauge: a SQL-bounded probe validated by the replay's own predicate

The replay's backlog predicate (`detail.replayed_at` absent, including unparseable detail) lives in JSON. The gauge's render-path read is `countUnreplayedEdgeDrops(env, AUDIT_GAUGE_CAP + 1)` (corpus-db): the SQL mirror of the mark (`detail IS NULL OR NOT json_valid(detail) OR json_extract(detail, '$.replayed_at') IS NULL`) narrows and `LIMIT`s server-side, so the admin never materializes the whole drop log — and the surviving rows are re-validated by `pendingReplayDetail`, the **same JS predicate the replay's selection uses** (extracted, shared), so the two can never disagree: the SQL over-selects at worst (e.g. a literal-null mark the replay never writes) and the JS layer drops it. The replay job's own `readUnreplayedEdgeDrops` is untouched (its existing test pins the semantics). The done-state IS cheaply derivable and is shown: the edge card renders `replay done — every pre-calibration drop re-checked` at zero, else `N drop(s) awaiting replay` with capped display.

### 4. Disjunction status: a compact fourth card in the pass grid

Chosen home: a fourth `au-pass` card ("disjunction sweep") in `au-pass-grid`, not a hero annotation. Rationale: the hero's converged state feeds the Status row and the sub-nav dot — folding disjunctions into it would silently change what "clean" gates. The sweep is genuinely a fourth self-quiescing convergence pass (of the normalize job), so the pass grid is its honest home; the sub-nav and tab structure stay stable, and the card count change is exactly what the operator sanctioned ("likely a compact fourth card"). The grid's `repeat(3, 1fr)` becomes `repeat(auto-fit, minmax(200px, 1fr))` so four cards share the row on desktop and wrap gracefully (the existing 640px one-column override stays).

Gauge semantics:
- **Count**: live concrete disjunctive ids the sweep will actually flip/fold — counted with the sweep's own **family-level** grouping and skip conditions mirrored from `reconcileDisjunctions` (`isDisjunctiveTerm`/`baseOf` are JS patterns, inexpressible in SQL, so counted over the `readIdentitySources` rows **already fetched for the sku gauge** — one read, two gauges). Excluded exactly as the sweep excludes: human rows anywhere (pinned operator intent, `disjunctionSkipped`), the **whole family under a human-sourced base** (the sweep skips the family, so its auto children must not count), and a family whose base merged **elsewhere** (only the inverted merge — into its own surviving child — is a shape the sweep re-roots). This makes the card settle at zero exactly when the sweep quiesces. Approximation note: a live *abstract* auto child pending fold isn't counted (rare shape; it carries no concrete-count weight).
- **Trend**: back-summed from the normalize job's run history — the one genuinely new bounded read, `readJobRuns(env, NORMALIZE_JOB, AUDIT_RUN_WINDOW)` (15 rows; these summaries are written every tick and surfaced nowhere today). Per-run drain = `disjunctionFlipped + disjunctionFolded` (a flip removes a concrete base from the live set; a fold removes a live child), via `backlogSeries` generalized to sum a list of summary fields (default stays `["audited"]` — existing callers unchanged). `ingredient-normalize.ts` gains an exported `NORMALIZE_JOB` constant replacing the four inline string literals (no behavior change).
- **Chips + foot**: the latest normalize run's `disjunction*` counters short-labeled (`flipped`/`folded`/`edges`/`enqueued`/`skipped`) as the standard `jstat` chips, and the normalize job's last-run age.

### 5. View & styles: handoff vocabulary only

Each pass card gains a burndown row above the worked sparkline: the live count (`au-burn-v`, green `zero` treatment at 0, `+` suffix when capped) + backlog label (`au-burn-k`) + `BurndownSpark` compact with the pass's existing tone (alias `g`, edge `p`; sku and disjunction reuse `b` — the "derived gauge" blue already established by the recipe backfill; no new colors). The replay line reuses the `au-pass-foot` treatment (RotateIcon + text). New CSS is layout-only: `.au-pass-burn` (row spacing inside the card), a small `.au-burn-v.sm` size step so the card count doesn't compete with the hero's, and the grid-template change — all within the `au-*` namespace and existing tokens. Everything is SSR in `audits.tsx`; no island.

## Risks / Trade-offs

- [The gauges add 5 queries per Audits view; identity/alias are scanned 3x route-wide (once per reader)] → Tables are operator-scale, the drop probe and run window are SQL-bounded, and the gauge reader shares one identity + one alias scan internally; no cron or Status-page cost. If the graph ever outgrows this, the gauge can fall back to the truncated-flag heuristic — the model (`PassGauge`) wouldn't change.
- [Back-summed sku series over-counts `merged` in the old tail; disjunction series skews when sweep work and arrivals interleave] → Same accepted trend-only skew as the hero series; headline numbers are always live counts. Documented at the derivation.
- [Disjunction count is a predicate count, not a full sweep simulation (misses live abstract children pending fold; blocked human families are excluded by design)] → It is exactly the quiesce predicate the operator named; the card's blurb says what it counts.
- [Seeding `ingredient-normalize` job_runs could ripple into Status-area fixtures/screenshots] → The Status page keys off `job_health` (already seeded for this job); new `job_runs` rows only add run history. Suite run + screenshot review is the gate.
- [Chip semantics change: settled/auditing now backlog-driven, not latest-tick-no-op-driven] → This is the operator's ask (a card with zero backlog but a failed last tick reads "settled"; failures still surface via Status/health). The worked-spark caption keeps the this-tick language.

## Migration Plan

Display-side only; no migrations, no deploy ordering. Rollback = revert.

## Open Questions

None — gauge choices, costs, and the disjunction card's home are decided above.

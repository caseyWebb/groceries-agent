// Pure convergence-derivation helpers the Status screen applies client-side to the run
// histories its query already fetched. Structural param types so the wire-inferred
// StatusData runs satisfy them without importing Worker types.

/** The minimal run shape the helpers read (StatusData's runs satisfy it structurally). */
export interface RunLike {
  ok: boolean;
  /** Epoch ms of this run. */
  ran_at: number;
  summary: Record<string, unknown>;
}

/**
 * The earliest `ran_at` in the current unbroken `ok`-streak — the "healthy since" / "unhealthy
 * since" instant. `runs` MUST be newest-first (as the status read returns). Scans from the
 * newest run while `ok` matches the newest run's `ok`; returns null when `runs` is empty (no
 * history yet — the caller omits the since-label in that case, same as it omits the sparkline).
 *
 * Ported from packages/worker/src/health.ts `currentStreakStart` — keep in sync.
 */
export function currentStreakStart(runs: readonly Pick<RunLike, "ok" | "ran_at">[]): number | null {
  if (runs.length === 0) return null;
  const currentOk = runs[0].ok;
  let start = runs[0].ran_at;
  for (const run of runs) {
    if (run.ok !== currentOk) break;
    start = run.ran_at;
  }
  return start;
}

/** The inline backfill gauge model on the recipe-index Status row. */
export interface RecipeBackfill {
  /** The latest run's unresolved count. */
  unresolved: number;
  /** The window's high-water unresolved count (the %-resolved denominator; ≥ unresolved). */
  start: number;
  /** Unresolved per run, oldest→newest. */
  series: number[];
  /** The latest run reported a degraded tick. */
  degraded: boolean;
  /** Epoch ms of the most recent degraded run in the window, or null. */
  degradedAt: number | null;
}

/** A finite numeric summary field, else 0 (failure runs carry `{error}` summaries).
 *  Ported from packages/worker/src/audit-admin.ts `numField` — keep in sync. */
function numField(summary: Record<string, unknown>, key: string): number {
  const v = summary[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Derive the backfill gauge from the recipe-index run history (newest-first). Null when no
 * run in the window carries a numeric `unresolved` (nothing to gauge — the row renders as a
 * plain job). PURE — the Status screen applies it to the runs it already fetched.
 *
 * Ported from packages/worker/src/audit-admin.ts `deriveRecipeBackfill` — keep in sync.
 */
export function deriveRecipeBackfill(runs: readonly RunLike[]): RecipeBackfill | null {
  const withUnresolved = runs.filter((r) => typeof r.summary.unresolved === "number");
  if (withUnresolved.length === 0) return null;
  const ordered = [...withUnresolved].reverse();
  const series = ordered.map((r) => numField(r.summary, "unresolved"));
  const latest = withUnresolved[0];
  const degradedRun = runs.find((r) => r.summary.degraded === true) ?? null;
  return {
    unresolved: numField(latest.summary, "unresolved"),
    start: Math.max(...series),
    series,
    degraded: latest.summary.degraded === true,
    degradedAt: degradedRun ? degradedRun.ran_at : null,
  };
}

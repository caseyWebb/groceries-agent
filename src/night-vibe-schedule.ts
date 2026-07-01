// The LEVEL-1 "shape the week" leg for `propose_meal_plan`: cadence-as-debt scheduling over a
// per-tenant night-vibe palette. Each night vibe carries a target PERIOD P (days) — "a simple
// pasta ~weekly", "a big project cook ~monthly" — and we track when it was last satisfied
// (slot provenance) so OVERDUE vibes bid harder for this plan's N slots.
//
//   debt(vibe)     = days_since(last_satisfied) / P        (0 = just done, 1 = exactly due)
//   samplingWeight = base · debtCurve(debt) · weatherMult  (debtCurve monotonic + CAPPED, so
//                    an ancient vibe can't monopolize the plan)
//
// `sampleWeek` force-places pinned + high-debt vibes first, then fills the rest by SEEDED
// BOUNDED-MULTIPLICITY weighted sampling: each non-forced vibe may be drawn up to
// `max(1, floor(window / vibe_period))` times, where `window` is the planning window in days
// (see `planning_cadence_days`) — a weekly-period vibe (period 7) in a 14-day window can
// legitimately fill 2 slots, not just 1. A vibe with no period (or a period ≥ the window) caps
// at 1, matching the plan's previous at-most-once behavior. Over-subscription resolves by debt
// rank; losers roll over (their debt keeps climbing). Deterministic (seed).
//
// A spike against synthetic backlogs surfaced one refinement encoded here: under a realistic
// backlog, force-placed overdue vibes ate every slot and weather never shaped the outcome. So
// PINNED vibes stay sticky (explicit user intent) but OVERDUE force-placement yields
// `minSampledSlots` back to the weighted pool, guaranteeing weather always shapes ≥1 slot.
//
// Weather uses the controlled vibe set from src/weather.ts `deriveVibes`
// (soup / comfort / grill-friendly / light / no-grill): a palette vibe declares
// `weather_affinity` (weather-vibes that favor it) and optional `weather_antipathy`.

import { mulberry32 } from "./rng.js";

/** One night vibe as the scheduler sees it (the palette row's scheduling-relevant fields). */
export interface NightVibeSpec {
  id: string;
  /** Base sampling weight before debt/weather (default 1). */
  base_weight?: number;
  /** Always place this vibe (explicit weekly intent) — outranks debt, immune to the reserve. */
  pinned?: boolean;
  /** Weather-vibes that favor this vibe (each match bumps its weight). */
  weather_affinity?: string[];
  /** Weather-vibes that suppress this vibe (any match applies the penalty). */
  weather_antipathy?: string[];
  /** Target cadence period in days — the divisor for this vibe's occurrence cap within a
   *  planning window (`max(1, floor(window / cadence_days))`). Absent/null → cap 1. */
  cadence_days?: number | null;
}

/** Tunable knobs for the debt curve, weather multiplier, and forcing. */
export interface CadenceParams {
  /** Debt at/above which a vibe is force-placed before sampling (hard "overdue"). */
  forceDueAt: number;
  /** debtCurve saturation ceiling — the multiplier an infinitely-overdue vibe reaches. */
  debtCap: number;
  /** debtCurve steepness past the due line (how fast debt→weight ramps once due). */
  debtSteepness: number;
  /** Floor multiplier for a not-yet-due vibe (debt near 0) so it can still surface. */
  debtFloor: number;
  /** Per-matched-weather-vibe bump (weight × (1 + weatherBoost·matches)). */
  weatherBoost: number;
  /** Multiplier when a vibe is anti-matched by weather (e.g. grill on a rainy day). */
  weatherPenalty: number;
  /** Debt assigned to a never-satisfied vibe (treated as maximally overdue). */
  neverDebt: number;
  /** Slots reserved for weighted sampling that overdue force-placement may NOT consume, so
   *  weather always shapes at least this many slots (pinned vibes are exempt). */
  minSampledSlots: number;
}

export const DEFAULT_CADENCE_PARAMS: CadenceParams = {
  forceDueAt: 1.5,
  debtCap: 4,
  debtSteepness: 1.5,
  debtFloor: 0.25,
  weatherBoost: 0.6,
  weatherPenalty: 0.35,
  neverDebt: 3,
  minSampledSlots: 1,
};

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Monotonic, capped debt→weight curve.
 *   debt ≤ 0     → debtFloor                                  (just satisfied; barely eligible)
 *   0 < debt < 1 → floor ramping linearly to 1 at the due line
 *   debt ≥ 1     → 1 + (cap−1)·(1 − e^{−k·(debt−1)})          (saturating toward debtCap)
 * Non-decreasing everywhere; never exceeds debtCap. k = debtSteepness.
 */
export function debtCurve(debt: number, params: CadenceParams = DEFAULT_CADENCE_PARAMS): number {
  const p = { ...DEFAULT_CADENCE_PARAMS, ...params };
  if (debt <= 0) return p.debtFloor;
  if (debt < 1) return p.debtFloor + (1 - p.debtFloor) * debt;
  const over = debt - 1;
  return 1 + (p.debtCap - 1) * (1 - Math.exp(-p.debtSteepness * over));
}

/** `days_since(last_satisfied) / period`. Never-satisfied (null) → `neverDebt` (max overdue). */
export function debt(
  lastSatisfiedDay: string | null,
  period: number,
  now: Date,
  neverDebt = DEFAULT_CADENCE_PARAMS.neverDebt,
): number {
  if (lastSatisfiedDay == null) return neverDebt;
  const then = Date.parse(`${lastSatisfiedDay}T00:00:00Z`);
  if (Number.isNaN(then)) return neverDebt;
  const days = Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
  return period > 0 ? days / period : neverDebt;
}

/**
 * Weather multiplier for one vibe. `weatherVibes` is the union of derived meal-vibes across the
 * planning window. `mult = (1 + weatherBoost·favorMatches) · (weatherPenalty if any antipathy
 * match else 1)`. No affinity + no antipathy → neutral 1 (weather-agnostic vibe).
 */
export function weatherMultiplier(
  vibe: NightVibeSpec,
  weatherVibes: string[],
  params: CadenceParams = DEFAULT_CADENCE_PARAMS,
): number {
  const p = { ...DEFAULT_CADENCE_PARAMS, ...params };
  const wset = new Set(weatherVibes);
  let favor = 0;
  for (const w of vibe.weather_affinity ?? []) if (wset.has(w)) favor++;
  let anti = false;
  for (const w of vibe.weather_antipathy ?? []) if (wset.has(w)) anti = true;
  return (1 + p.weatherBoost * favor) * (anti ? p.weatherPenalty : 1);
}

/** A vibe's computed weight + scheduling flags for this week. */
export interface WeightedVibe {
  id: string;
  weight: number;
  debt: number;
  pinned: boolean;
  /** Force-placed before sampling (pinned, or debt ≥ forceDueAt). */
  forced: boolean;
  vibe: NightVibeSpec;
}

/** Compute each vibe's sampling weight: `base · debtCurve(debt) · weatherMult`. `debtByVibe`
 *  maps vibe id → debt (from `debt()`), so satisfaction/provenance stays the caller's concern. */
export function computeWeights(
  palette: NightVibeSpec[],
  weatherVibes: string[],
  debtByVibe: Map<string, number>,
  params: CadenceParams = DEFAULT_CADENCE_PARAMS,
): WeightedVibe[] {
  const p = { ...DEFAULT_CADENCE_PARAMS, ...params };
  return palette.map((vibe) => {
    const d = debtByVibe.get(vibe.id) ?? 0;
    const base = vibe.base_weight ?? 1;
    const weight = base * debtCurve(d, p) * weatherMultiplier(vibe, weatherVibes, p);
    return { id: vibe.id, weight, debt: d, pinned: !!vibe.pinned, forced: !!vibe.pinned || d >= p.forceDueAt, vibe };
  });
}

/**
 * Seeded weighted sampling WITHOUT replacement of `k` items (each `{ id, weight }`), via the
 * Efraimidis–Spirakis key (`key = u^{1/w}`, take top-k). Exact weighted-without-replacement,
 * deterministic given `rng`. Non-positive weights get an epsilon so they stay last-resort
 * eligible rather than producing NaN.
 */
export function weightedSampleWithoutReplacement<T extends { id: string; weight: number }>(
  items: T[],
  k: number,
  rng: () => number,
): T[] {
  const keyed = items.map((it) => {
    const w = it.weight > 0 ? it.weight : 1e-9;
    const u = Math.max(rng(), 1e-12);
    return { it, key: Math.pow(u, 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key || a.it.id.localeCompare(b.it.id));
  return keyed.slice(0, Math.max(0, k)).map((x) => x.it);
}

/** A vibe's occurrence cap within a planning window: `max(1, floor(window / vibe_period))`.
 *  No period (or a period ≥ the window) → cap 1, the plan's original at-most-once behavior. */
export function occurrenceCap(vibePeriod: number | null | undefined, window: number): number {
  if (vibePeriod == null || vibePeriod <= 0 || window <= 0) return 1;
  return Math.max(1, Math.floor(window / vibePeriod));
}

/** A per-draw cooldown multiplier applied to a vibe's weight right after it's drawn, so a
 *  recurring vibe's occurrences spread across the window rather than clustering adjacently.
 *  Restored to normal (1×) after one draw — a short, local nudge, not a hard exclusion. */
const RECURRENCE_COOLDOWN = 0.15;

/**
 * Seeded BOUNDED-MULTIPLICITY weighted sampling of `k` slots from `items` (each carrying its own
 * `cap` — the max times it may be drawn). Draw-by-draw: each draw runs one Efraimidis–Spirakis
 * pick (`key = u^{1/w}`, top-1) over every vibe whose remaining count is still > 0, then
 * decrements that vibe's remaining count (removing it from the pool only once exhausted) and
 * applies `RECURRENCE_COOLDOWN` to its weight for the *next* draw only, so a just-placed vibe is
 * less likely (not impossible) to land on the immediately following slot. Stops when `k` slots
 * are filled or every ticket is exhausted. Deterministic given `rng`.
 */
export function boundedMultiplicitySample<T extends { id: string; weight: number; cap: number }>(
  items: T[],
  k: number,
  rng: () => number,
): T[] {
  const remaining = new Map(items.map((it) => [it.id, Math.max(0, it.cap)]));
  const cooldown = new Map<string, number>(); // id -> multiplier applied to THIS draw only
  const out: T[] = [];

  for (let draw = 0; draw < Math.max(0, k); draw++) {
    const eligible = items.filter((it) => (remaining.get(it.id) ?? 0) > 0);
    if (eligible.length === 0) break;

    let best: T | null = null;
    let bestKey = -Infinity;
    for (const it of eligible) {
      const mult = cooldown.get(it.id) ?? 1;
      const w = it.weight * mult > 0 ? it.weight * mult : 1e-9;
      const u = Math.max(rng(), 1e-12);
      const key = Math.pow(u, 1 / w);
      if (key > bestKey || (key === bestKey && best !== null && it.id.localeCompare(best.id) < 0)) {
        bestKey = key;
        best = it;
      }
    }
    if (!best) break;

    out.push(best);
    remaining.set(best.id, (remaining.get(best.id) ?? 1) - 1);
    // Cooldown resets each draw (spacing is local, not a permanent penalty); only the
    // just-drawn vibe carries one into the NEXT draw.
    cooldown.clear();
    if ((remaining.get(best.id) ?? 0) > 0) cooldown.set(best.id, RECURRENCE_COOLDOWN);
  }
  return out;
}

/** One placed slot: which vibe, why it landed, and its scheduling signals. */
export interface WeekSlot {
  id: string;
  reason: "pinned" | "overdue" | "sampled";
  debt: number;
  weight: number;
}

export interface SampledWeek {
  slots: WeekSlot[];
  /** Forced vibes that didn't fit (over-subscription or the reserve) — roll over to next week. */
  rolledOver: string[];
  /** Every vibe's weight/debt/flags, weight-descending, for diagnostics. */
  weights: { id: string; weight: number; debt: number; forced: boolean; pinned: boolean }[];
  /** Each non-forced vibe's occurrence cap this plan (`max(1, floor(window / vibe_period))`),
   *  for diagnostics/inspection — a forced (pinned/overdue) vibe is placed at most once and
   *  isn't included here (its cardinality isn't governed by the window). */
  occurrenceCaps: { id: string; cap: number }[];
}

/**
 * Shape one plan of `n` vibe slots over a `window`-day planning horizon. Deterministic given
 * `seed`.
 *   1. Compute weights (debtCurve · weather).
 *   2. Place PINNED vibes (debt-desc), up to n — sticky, exempt from the reserve.
 *   3. Place OVERDUE vibes (debt ≥ forceDueAt, debt-desc) up to `n − minSampledSlots` (so the
 *      weighted pool — where weather matters — keeps at least `minSampledSlots` when it can
 *      supply them). Excess overdue vibes roll over.
 *   4. Fill the remaining slots by seeded BOUNDED-MULTIPLICITY weighted sampling over the rest:
 *      each non-forced vibe may be drawn up to `max(1, floor(window / vibe_period))` times (a
 *      weekly vibe in a 14-day window can fill 2 slots), with a short per-draw cooldown so
 *      repeat draws of the same vibe don't cluster on adjacent slots.
 *
 * `window` defaults to `n` (the plan's own night count) when omitted, which reproduces the
 * previous at-most-once behavior for every vibe (a period ≥ its own window caps at 1).
 */
export function sampleWeek(
  palette: NightVibeSpec[],
  weatherVibes: string[],
  debtByVibe: Map<string, number>,
  n: number,
  seed = 1,
  params: Partial<CadenceParams> = {},
  window?: number,
): SampledWeek {
  const p: CadenceParams = { ...DEFAULT_CADENCE_PARAMS, ...params };
  const rng = mulberry32(seed);
  const weights = computeWeights(palette, weatherVibes, debtByVibe, p);
  const effectiveWindow = window ?? n;
  const periodById = new Map(palette.map((v) => [v.id, v.cadence_days ?? null]));

  const slots: WeekSlot[] = [];
  const used = new Set<string>();
  const rolledOver: string[] = [];

  // How many non-forced vibes could be weather-sampled? Only reserve slots for weather if such
  // a pool exists (an all-forced palette can't reserve — everything is intent/overdue).
  const sampleablePool = weights.filter((w) => !w.forced);
  const reserve = sampleablePool.length > 0 ? Math.min(p.minSampledSlots, n) : 0;

  // Step 2: pinned first (sticky, ignore the reserve), ranked by debt. A pinned vibe is a
  // single force-place per id, not itself repeated.
  const pinned = weights.filter((w) => w.pinned).sort((a, b) => b.debt - a.debt || a.id.localeCompare(b.id));
  for (const w of pinned) {
    if (slots.length < n) {
      slots.push({ id: w.id, reason: "pinned", debt: round4(w.debt), weight: round4(w.weight) });
      used.add(w.id);
    } else {
      rolledOver.push(w.id);
    }
  }

  // Step 3: overdue (non-pinned forced), ranked by debt, but leave `reserve` slots for weather.
  // Force-placement cardinality is unaffected by the window — a palette shouldn't declare the
  // same vibe overdue twice, and this is a single force-place per vibe id.
  const overdue = weights
    .filter((w) => w.forced && !w.pinned)
    .sort((a, b) => b.debt - a.debt || a.id.localeCompare(b.id));
  const overdueCap = Math.max(0, n - reserve);
  for (const w of overdue) {
    if (slots.length < overdueCap) {
      slots.push({ id: w.id, reason: "overdue", debt: round4(w.debt), weight: round4(w.weight) });
      used.add(w.id);
    } else {
      rolledOver.push(w.id); // yields to the weather-sampled reserve, or over-subscribed
    }
  }

  // Step 4: fill the rest by seeded BOUNDED-MULTIPLICITY weighted sampling over the non-forced,
  // not-yet-placed vibes — each gets an occurrence cap derived from its own period vs. the window.
  const remaining = n - slots.length;
  const occurrenceCaps: { id: string; cap: number }[] = [];
  if (remaining > 0) {
    const pool = weights
      .filter((w) => !used.has(w.id) && !w.forced)
      .map((w) => {
        const cap = occurrenceCap(periodById.get(w.id), effectiveWindow);
        occurrenceCaps.push({ id: w.id, cap });
        return { ...w, cap };
      });
    for (const s of boundedMultiplicitySample(pool, remaining, rng)) {
      slots.push({ id: s.id, reason: "sampled", debt: round4(s.debt), weight: round4(s.weight) });
      used.add(s.id);
    }
  }

  return {
    slots,
    rolledOver,
    weights: weights
      .map((w) => ({ id: w.id, weight: round4(w.weight), debt: round4(w.debt), forced: w.forced, pinned: w.pinned }))
      .sort((a, b) => b.weight - a.weight),
    occurrenceCaps,
  };
}

import { describe, it, expect } from "vitest";
import {
  debt,
  debtCurve,
  weatherMultiplier,
  sampleWeek,
  occurrenceCap,
  DEFAULT_CADENCE_PARAMS,
  type NightVibeSpec,
} from "../src/night-vibe-schedule.js";

const NOW = new Date("2026-07-01T00:00:00Z");

describe("debt", () => {
  it("treats a never-satisfied vibe as maximally overdue", () => {
    expect(debt(null, 7, NOW)).toBe(DEFAULT_CADENCE_PARAMS.neverDebt);
    expect(debt("not-a-date", 7, NOW)).toBe(DEFAULT_CADENCE_PARAMS.neverDebt);
  });

  it("is days-since over the period", () => {
    expect(debt("2026-06-24", 7, NOW)).toBeCloseTo(1, 5); // 7 days / 7-day period
    expect(debt("2026-06-01", 30, NOW)).toBeCloseTo(1, 5); // 30 days / 30-day period
    expect(debt("2026-06-30", 7, NOW)).toBeCloseTo(1 / 7, 5); // 1 day / 7
  });
});

describe("debtCurve", () => {
  it("is monotonic non-decreasing and capped", () => {
    expect(debtCurve(0)).toBeCloseTo(DEFAULT_CADENCE_PARAMS.debtFloor);
    expect(debtCurve(1)).toBeCloseTo(1);
    expect(debtCurve(1000)).toBeLessThanOrEqual(DEFAULT_CADENCE_PARAMS.debtCap);
    let prev = -Infinity;
    for (const d of [0, 0.25, 0.5, 1, 2, 5, 50, 500]) {
      const v = debtCurve(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("weatherMultiplier", () => {
  it("bumps on affinity, penalizes on antipathy, neutral otherwise", () => {
    const soup: NightVibeSpec = { id: "soup", weather_affinity: ["soup", "comfort"] };
    expect(weatherMultiplier(soup, ["soup", "comfort"])).toBeCloseTo(1 + 0.6 * 2);
    expect(weatherMultiplier(soup, [])).toBe(1);
    const grill: NightVibeSpec = { id: "grill", weather_affinity: ["grill-friendly"], weather_antipathy: ["no-grill"] };
    expect(weatherMultiplier(grill, ["no-grill"])).toBeCloseTo(DEFAULT_CADENCE_PARAMS.weatherPenalty);
  });
});

describe("sampleWeek", () => {
  it("force-places a pinned vibe", () => {
    const palette: NightVibeSpec[] = [{ id: "pasta", pinned: true }, { id: "a" }, { id: "b" }, { id: "c" }];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const wk = sampleWeek(palette, [], debts, 2, 1);
    const pasta = wk.slots.find((s) => s.id === "pasta");
    expect(pasta?.reason).toBe("pinned");
  });

  it("places overdue vibes by debt rank and rolls over the excess", () => {
    const palette: NightVibeSpec[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const debts = new Map([["a", 5], ["b", 4], ["c", 3], ["d", 2]]); // all ≥ forceDueAt
    const wk = sampleWeek(palette, [], debts, 2, 1);
    expect(wk.slots.length).toBe(2);
    expect(wk.rolledOver.length).toBe(2);
    expect(wk.slots.map((s) => s.id)).toContain("a"); // highest debt placed
  });

  it("reserves a slot for weather-sampling under an overdue backlog", () => {
    const palette: NightVibeSpec[] = [
      { id: "o1" },
      { id: "o2" },
      { id: "o3" },
      { id: "o4" },
      { id: "soup", weather_affinity: ["soup"] },
    ];
    const debts = new Map([["o1", 5], ["o2", 4], ["o3", 3], ["o4", 2], ["soup", 0.1]]);
    const wk = sampleWeek(palette, ["soup"], debts, 3, 1); // minSampledSlots default 1
    const reasons = wk.slots.map((s) => s.reason);
    expect(wk.slots.length).toBe(3);
    expect(reasons.filter((r) => r === "overdue").length).toBeLessThanOrEqual(2);
    expect(reasons).toContain("sampled");
    // the only non-forced vibe takes the reserved weather slot
    expect(wk.slots.find((s) => s.reason === "sampled")?.id).toBe("soup");
    expect(wk.rolledOver.length).toBeGreaterThanOrEqual(1);
  });

  it("samples without replacement, deterministically per seed, varying across seeds", () => {
    const palette: NightVibeSpec[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const debts = new Map(palette.map((v) => [v.id, 0])); // none forced → all sampled
    const w1 = sampleWeek(palette, [], debts, 3, 42).slots.map((s) => s.id);
    const w2 = sampleWeek(palette, [], debts, 3, 42).slots.map((s) => s.id);
    expect(w1).toEqual(w2);
    expect(new Set(w1).size).toBe(3); // no repeats
    const shapes = new Set<string>();
    for (let s = 1; s <= 20; s++) {
      shapes.add(sampleWeek(palette, [], debts, 3, s).slots.map((x) => x.id).sort().join(","));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe("occurrenceCap", () => {
  it("is max(1, floor(window / period))", () => {
    expect(occurrenceCap(7, 14)).toBe(2);
    expect(occurrenceCap(7, 21)).toBe(3);
    expect(occurrenceCap(30, 14)).toBe(1); // floored up to the minimum
    expect(occurrenceCap(14, 14)).toBe(1); // window == period → still 1
    expect(occurrenceCap(null, 14)).toBe(1);
    expect(occurrenceCap(undefined, 14)).toBe(1);
  });
});

describe("sampleWeek — period-aware bounded-multiplicity repeatability", () => {
  it("a weekly vibe (cadence_days: 7) may recur up to twice in a 14-day window", () => {
    // A single non-forced vibe filling many slots must hit its cap, not repeat unboundedly.
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 40; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 14);
      const pastaCount = wk.slots.filter((s) => s.id === "pasta").length;
      expect(pastaCount).toBeLessThanOrEqual(2); // cap = floor(14/7) = 2
      counts.set(seed.toString(), pastaCount);
    }
    // Over many seeds, pasta should actually reach 2 occurrences at least once (the cap is
    // reachable, not merely a theoretical ceiling nothing exercises).
    expect([...counts.values()].some((c) => c === 2)).toBe(true);
  });

  it("a monthly vibe (cadence_days: 30) stays capped at one occurrence in a 14-day window", () => {
    const palette: NightVibeSpec[] = [
      { id: "big-project", cadence_days: 30 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    for (let seed = 1; seed <= 20; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 14);
      expect(wk.slots.filter((s) => s.id === "big-project").length).toBeLessThanOrEqual(1);
    }
  });

  it("a window shorter than or equal to a vibe's period preserves at-most-once behavior", () => {
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    for (let seed = 1; seed <= 20; seed++) {
      // window (7) == period (7) → cap 1
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 7);
      expect(wk.slots.filter((s) => s.id === "pasta").length).toBeLessThanOrEqual(1);
    }
  });

  it("omitting window defaults it to n, reproducing today's at-most-once behavior", () => {
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    for (let seed = 1; seed <= 20; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed); // no window arg
      expect(new Set(wk.slots.map((s) => s.id)).size).toBe(wk.slots.length); // no repeats
    }
  });

  it("is deterministic given the same seed, including which vibes recur and how many times", () => {
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "soup", cadence_days: 14 },
      { id: "other-a" },
      { id: "other-b" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const w1 = sampleWeek(palette, [], debts, 6, 7, DEFAULT_CADENCE_PARAMS, 14).slots.map((s) => s.id);
    const w2 = sampleWeek(palette, [], debts, 6, 7, DEFAULT_CADENCE_PARAMS, 14).slots.map((s) => s.id);
    expect(w1).toEqual(w2);
  });

  it("preserves pinned/overdue precedence over the bounded-multiplicity pool", () => {
    const palette: NightVibeSpec[] = [
      { id: "regular", pinned: true },
      { id: "overdue-one", cadence_days: 7 },
      { id: "weekly", cadence_days: 7 },
      { id: "other" },
    ];
    const debts = new Map([
      ["regular", 0],
      ["overdue-one", 5], // ≥ forceDueAt
      ["weekly", 0],
      ["other", 0],
    ]);
    const wk = sampleWeek(palette, [], debts, 4, 3, DEFAULT_CADENCE_PARAMS, 14);
    const regular = wk.slots.find((s) => s.id === "regular");
    const overdue = wk.slots.find((s) => s.id === "overdue-one");
    expect(regular?.reason).toBe("pinned");
    expect(overdue?.reason).toBe("overdue");
    // pinned/overdue are placed exactly once each, never repeated by the window.
    expect(wk.slots.filter((s) => s.id === "regular").length).toBe(1);
    expect(wk.slots.filter((s) => s.id === "overdue-one").length).toBe(1);
  });

  it("over-subscription still rolls over forced vibes that don't fit", () => {
    const palette: NightVibeSpec[] = [
      { id: "a", cadence_days: 7 },
      { id: "b", cadence_days: 7 },
      { id: "c", cadence_days: 7 },
      { id: "d", cadence_days: 7 },
    ];
    const debts = new Map([["a", 5], ["b", 4], ["c", 3], ["d", 2]]); // all overdue
    const wk = sampleWeek(palette, [], debts, 2, 1, DEFAULT_CADENCE_PARAMS, 14);
    expect(wk.slots.length).toBe(2);
    expect(wk.rolledOver.length).toBe(2);
  });

  it("spreads a recurring vibe's occurrences rather than always landing it adjacent", () => {
    // With a sparse-enough alternative pool, the cooldown should sometimes separate the two
    // pasta occurrences rather than forcing them onto consecutive slots every single seed.
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    let sawSeparated = false;
    for (let seed = 1; seed <= 60; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 14);
      const idxs = wk.slots.map((s, i) => (s.id === "pasta" ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 2 && idxs[1] - idxs[0] > 1) sawSeparated = true;
    }
    expect(sawSeparated).toBe(true);
  });
});

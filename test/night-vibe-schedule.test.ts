import { describe, it, expect } from "vitest";
import {
  debt,
  debtCurve,
  weatherMultiplier,
  sampleWeek,
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

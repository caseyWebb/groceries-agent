import { describe, it, expect } from "vitest";
import { plannedOf, applyMealPlanOps, dueAndFuture, type PlannedItem } from "../src/meal-plan.js";

describe("plannedOf", () => {
  it("coerces planned rows; missing planned_for becomes null", () => {
    const parsed = { planned: [{ recipe: "a", planned_for: "2026-06-10" }, { recipe: "b" }] };
    expect(plannedOf(parsed)).toEqual([
      { recipe: "a", planned_for: "2026-06-10" },
      { recipe: "b", planned_for: null },
    ]);
  });
  it("returns [] when absent", () => {
    expect(plannedOf({})).toEqual([]);
  });
  it("carries open-world sides when present, omits when empty/absent", () => {
    const parsed = {
      planned: [
        { recipe: "salmon", sides: ["roasted broccoli", "white rice"] },
        { recipe: "chili", sides: [] }, // empty → no sides key
        { recipe: "tacos" }, // absent → no sides key
      ],
    };
    const out = plannedOf(parsed);
    expect(out[0]).toEqual({ recipe: "salmon", planned_for: null, sides: ["roasted broccoli", "white rice"] });
    expect(out[1]).toEqual({ recipe: "chili", planned_for: null });
    expect(out[2]).toEqual({ recipe: "tacos", planned_for: null });
  });
});

describe("applyMealPlanOps", () => {
  const items: PlannedItem[] = [{ recipe: "salmon", planned_for: "2026-06-10" }];

  it("adds a new row and upserts an existing one", () => {
    const res = applyMealPlanOps(items, [
      { op: "add", recipe: "tacos", planned_for: "2026-06-11" },
      { op: "add", recipe: "salmon", planned_for: "2026-06-12" },
    ]);
    expect(res.items).toContainEqual({ recipe: "tacos", planned_for: "2026-06-11" });
    expect(res.items.find((i) => i.recipe === "salmon")!.planned_for).toBe("2026-06-12");
    expect(res.conflicts).toHaveLength(0);
  });

  it("removes a row and conflicts on a missing one", () => {
    const res = applyMealPlanOps(items, [
      { op: "remove", recipe: "salmon" },
      { op: "remove", recipe: "ghost" },
    ]);
    expect(res.items).toHaveLength(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ op: "remove", recipe: "ghost" });
  });

  it("conflicts on an invalid planned_for", () => {
    const res = applyMealPlanOps(items, [{ op: "add", recipe: "x", planned_for: "tomorrow" }]);
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts[0].reason).toMatch(/planned_for/);
  });

  it("attaches open-world sides on add", () => {
    const res = applyMealPlanOps([], [{ op: "add", recipe: "miso-salmon", planned_for: "2026-06-14", sides: ["roasted broccoli"] }]);
    expect(res.items).toContainEqual({ recipe: "miso-salmon", planned_for: "2026-06-14", sides: ["roasted broccoli"] });
  });

  it("records from_vibe slot provenance on add and preserves it on a later add", () => {
    const res = applyMealPlanOps([], [{ op: "add", recipe: "miso-salmon", from_vibe: "weeknight-fish" }]);
    expect(res.items.find((i) => i.recipe === "miso-salmon")!.from_vibe).toBe("weeknight-fish");
    // A later add without from_vibe keeps the prior provenance (doesn't clobber to null).
    const res2 = applyMealPlanOps(res.items, [{ op: "add", recipe: "miso-salmon", planned_for: "2026-06-15" }]);
    expect(res2.items.find((i) => i.recipe === "miso-salmon")!.from_vibe).toBe("weeknight-fish");
  });

  it("merges sides onto an existing row (union, no duplicate row)", () => {
    const start: PlannedItem[] = [{ recipe: "miso-salmon", planned_for: "2026-06-14", sides: ["roasted broccoli"] }];
    const res = applyMealPlanOps(start, [{ op: "add", recipe: "miso-salmon", sides: ["roasted broccoli", "white rice"] }]);
    const row = res.items.filter((i) => i.recipe === "miso-salmon");
    expect(row).toHaveLength(1);
    expect(row[0].sides).toEqual(["roasted broccoli", "white rice"]); // deduped union, order preserved
  });

  it("remove drops the row and its sides", () => {
    const start: PlannedItem[] = [{ recipe: "miso-salmon", planned_for: null, sides: ["roasted broccoli"] }];
    const res = applyMealPlanOps(start, [{ op: "remove", recipe: "miso-salmon" }]);
    expect(res.items).toHaveLength(0);
  });
});

describe("dueAndFuture", () => {
  it("treats on/before-today and unset as due; future-dated as future", () => {
    const items: PlannedItem[] = [
      { recipe: "past", planned_for: "2026-06-01" },
      { recipe: "today", planned_for: "2026-06-10" },
      { recipe: "future", planned_for: "2026-06-20" },
      { recipe: "unset", planned_for: null },
    ];
    const { due, future } = dueAndFuture(items, "2026-06-10");
    expect(due.map((i) => i.recipe).sort()).toEqual(["past", "today", "unset"]);
    expect(future.map((i) => i.recipe)).toEqual(["future"]);
  });
});

describe("applyMealPlanOps — set (replace semantics)", () => {
  const base = (): PlannedItem[] => [
    { recipe: "miso-salmon", planned_for: "2026-06-12", sides: ["white rice", "roasted broccoli"], from_vibe: "weeknight-fish" },
  ];

  it("replaces sides wholesale — removing one side leaves the rest and everything else untouched", () => {
    const res = applyMealPlanOps(base(), [{ op: "set", recipe: "miso-salmon", sides: ["white rice"] }]);
    expect(res.applied).toEqual([{ op: "set", recipe: "miso-salmon" }]);
    expect(res.items[0]).toEqual({
      recipe: "miso-salmon",
      planned_for: "2026-06-12",
      sides: ["white rice"],
      from_vibe: "weeknight-fish",
    });
  });

  it("an empty sides array removes them all", () => {
    const res = applyMealPlanOps(base(), [{ op: "set", recipe: "miso-salmon", sides: [] }]);
    expect(res.items[0].sides).toBeUndefined();
  });

  it("an explicit planned_for: null clears the date; absent preserves it", () => {
    const cleared = applyMealPlanOps(base(), [{ op: "set", recipe: "miso-salmon", planned_for: null }]);
    expect(cleared.items[0].planned_for).toBeNull();
    expect(cleared.items[0].from_vibe).toBe("weeknight-fish"); // preserved
    const untouched = applyMealPlanOps(base(), [{ op: "set", recipe: "miso-salmon", sides: ["white rice"] }]);
    expect(untouched.items[0].planned_for).toBe("2026-06-12");
  });

  it("a set on an absent row is a per-op conflict, not an error", () => {
    const res = applyMealPlanOps(base(), [{ op: "set", recipe: "ghost", planned_for: null }]);
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts).toEqual([{ op: "set", recipe: "ghost", reason: "no planned row for that recipe" }]);
    expect(res.items).toEqual(base());
  });

  it("a set with an invalid date is a per-op conflict", () => {
    const res = applyMealPlanOps(base(), [{ op: "set", recipe: "miso-salmon", planned_for: "June 12" }]);
    expect(res.conflicts).toHaveLength(1);
    expect(res.items[0].planned_for).toBe("2026-06-12");
  });

  it("add semantics are untouched: union sides, null planned_for preserves", () => {
    const res = applyMealPlanOps(base(), [
      { op: "add", recipe: "miso-salmon", planned_for: null, sides: ["edamame"] },
    ]);
    expect(res.items[0].sides).toEqual(["white rice", "roasted broccoli", "edamame"]);
    expect(res.items[0].planned_for).toBe("2026-06-12");
  });
});

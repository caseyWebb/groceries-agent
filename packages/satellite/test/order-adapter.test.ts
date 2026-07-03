import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrderAdapters, validateOrderEmit } from "../src/order-adapter.js";
import type { SatelliteConfig } from "../src/config.js";

// The cart-fill adapter model (satellite-order-cart-fill): the loader is browser-only and has NO
// built-ins (an order adapter is always the operator's ToS-hostile driver from adapters_dir), and
// validateOrderEmit is the local sensor-not-judge contract gate a receipt is assembled behind.

const baseConfig = (over: Partial<SatelliteConfig> = {}): SatelliteConfig => ({
  connector_url: "https://mcp.example.workers.dev",
  sources: [],
  ...over,
});

const rawOrder = (over: Record<string, unknown> = {}) => ({
  kind: "order",
  item_id: "whole milk",
  disposition: "carted",
  product: { productId: "p1", description: "Whole Milk, 1 gal" },
  ...over,
});

describe("loadOrderAdapters (no built-ins, operator modules only)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "satellite-order-adapters-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an EMPTY map when no adapters_dir is configured (no built-in named-retailer adapter)", async () => {
    const adapters = await loadOrderAdapters(baseConfig());
    expect(Object.keys(adapters)).toEqual([]);
  });

  it("returns an empty map when adapters_dir does not exist (not fatal)", async () => {
    const adapters = await loadOrderAdapters(baseConfig({ adapters_dir: join(dir, "nope") }));
    expect(Object.keys(adapters)).toEqual([]);
  });

  it("loads an operator module (basename = adapter name) from adapters_dir — and nothing else", async () => {
    writeFileSync(
      join(dir, "target.mjs"),
      `export default (sdk) => ({ id: "target", async fill(_sdk, lines) { return lines.map((l) => ({ kind: "order", item_id: l.item_id, disposition: "carted", product: { productId: "x", description: "y" } })); } });`,
      "utf8",
    );
    const adapters = await loadOrderAdapters(baseConfig({ adapters_dir: dir }));
    // Exactly the one operator adapter — no built-in leaks in.
    expect(Object.keys(adapters)).toEqual(["target"]);
    const built = adapters.target({} as never);
    expect(built.id).toBe("target");
    const out = await built.fill({} as never, [
      { item_id: "milk", name: "milk", quantity: 1, for_recipes: [], assumed_quantity: false },
    ]);
    expect(Array.isArray(out)).toBe(true);
  });

  it("throws when a module does not default-export a factory", async () => {
    writeFileSync(join(dir, "broken.mjs"), `export const notDefault = 1;`, "utf8");
    await expect(loadOrderAdapters(baseConfig({ adapters_dir: dir }))).rejects.toThrow(/must default-export a factory/);
  });
});

describe("validateOrderEmit (local sensor-not-judge contract gate)", () => {
  it("accepts a well-formed carted observation", () => {
    expect(validateOrderEmit(rawOrder()).ok).toBe(true);
  });

  it("accepts an unavailable observation with no product", () => {
    const r = validateOrderEmit({ kind: "order", item_id: "eggs", disposition: "unavailable" });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-contract shape (missing the canonical item_id)", () => {
    const { item_id: _drop, ...noId } = rawOrder();
    const r = validateOrderEmit(noId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid order observation/);
  });

  it("rejects an unknown disposition", () => {
    expect(validateOrderEmit(rawOrder({ disposition: "backordered" })).ok).toBe(false);
  });

  it("rejects a sensor-not-judge violation (a smuggled derived grocery-list state field)", () => {
    for (const field of ["status", "in_cart", "ordered", "state", "advanced"]) {
      const r = validateOrderEmit(rawOrder({ [field]: "in_cart" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("sensor-not-judge");
    }
  });
});

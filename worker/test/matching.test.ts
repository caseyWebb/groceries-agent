import { describe, it, expect } from "vitest";
import {
  matchIngredient,
  normalizeIngredient,
  brandKey,
  tiebreak,
  type MatchDeps,
} from "../src/matching.js";
import type { KrogerCandidate } from "../src/kroger.js";

function cand(overrides: Partial<KrogerCandidate> & { productId: string }): KrogerCandidate {
  return {
    brand: "",
    description: "",
    categories: [],
    size: null,
    price: { regular: 0, promo: 0 },
    fulfillment: { curbside: true, delivery: true },
    ...overrides,
  };
}

function makeDeps(opts: Partial<MatchDeps> & { byId?: Record<string, KrogerCandidate | null> } = {}): MatchDeps {
  return {
    search: opts.search ?? (async () => []),
    productById: opts.productById ?? (async (id: string) => opts.byId?.[id] ?? null),
    aliases: opts.aliases ?? {},
    brands: opts.brands ?? {},
    cache: opts.cache ?? [],
  };
}

describe("normalizeIngredient", () => {
  it("strips a leading quantity/unit", () => {
    expect(normalizeIngredient("2 lb chicken thighs", {})).toBe("chicken thighs");
    expect(normalizeIngredient("1 cup olive oil", {})).toBe("olive oil");
    expect(normalizeIngredient("3 onions", {})).toBe("onions");
  });

  it("applies aliases case-insensitively", () => {
    expect(normalizeIngredient("EVOO", { EVOO: "olive oil" })).toBe("olive oil");
    expect(normalizeIngredient("Extra Virgin Olive Oil", { "extra virgin olive oil": "olive oil" })).toBe(
      "olive oil",
    );
  });

  it("derives the [brands] key by underscoring spaces", () => {
    expect(brandKey("olive oil")).toBe("olive_oil");
  });
});

describe("matchIngredient — cache lookup + revalidation", () => {
  it("returns a confident cache hit revalidated with fresh price", async () => {
    const fresh = cand({ productId: "S1", brand: "Simple Truth", size: "16.9 fl oz", price: { regular: 7.49, promo: 0 } });
    const deps = makeDeps({
      aliases: { "extra virgin olive oil": "olive oil" },
      cache: [{ ingredient: "olive oil", sku: "S1" }],
      byId: { S1: fresh },
      search: async () => {
        throw new Error("search should not be called on a healthy cache hit");
      },
    });
    const res = await matchIngredient(deps, "Extra Virgin Olive Oil");
    expect(res).toMatchObject({ resolved: true, sku: "S1", price: { regular: 7.49 }, reason: "cache hit (revalidated)" });
  });

  it("re-resolves when the cached SKU is no longer fulfillable", async () => {
    const dead = cand({ productId: "S1", fulfillment: { curbside: false, delivery: false } });
    const searchHit = cand({ productId: "S2", brand: "Store", price: { regular: 3.0, promo: 0 } });
    const deps = makeDeps({
      brands: { olive_oil: [] }, // don't-care so re-resolution is confident
      cache: [{ ingredient: "olive oil", sku: "S1" }],
      byId: { S1: dead },
      search: async () => [searchHit],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "S2" });
  });

  it("bypass_cache skips the cache and runs full search", async () => {
    const deps = makeDeps({
      brands: { olive_oil: [] },
      cache: [{ ingredient: "olive oil", sku: "S1" }],
      byId: { S1: cand({ productId: "S1" }) },
      search: async () => [cand({ productId: "S2", price: { regular: 4, promo: 0 } })],
    });
    const res = await matchIngredient(deps, "olive oil", {}, true);
    expect(res).toMatchObject({ resolved: true, sku: "S2" });
  });
});

describe("matchIngredient — confidence gate", () => {
  it("absent brand key with no cache → ambiguous", async () => {
    const deps = makeDeps({
      search: async () => [
        cand({ productId: "A", brand: "Brand A", price: { regular: 5, promo: 0 } }),
        cand({ productId: "B", brand: "Brand B", price: { regular: 6, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
    if (res.resolved === false && "ambiguous" in res) {
      expect(res.candidates).toHaveLength(2);
    }
  });

  it("empty list [] → confident cheapest acceptable", async () => {
    const deps = makeDeps({
      brands: { yellow_onion: [] },
      search: async () => [
        cand({ productId: "cheap", size: "2 lb", price: { regular: 1.5, promo: 0 } }),
        cand({ productId: "pricey", size: "2 lb", price: { regular: 3.0, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "yellow onion");
    expect(res).toMatchObject({ resolved: true, sku: "cheap", reason: "don't-care: cheapest acceptable" });
  });

  it("commodity sizing picks smallest package covering the quantity_hint", async () => {
    const deps = makeDeps({
      brands: { rice: [] },
      search: async () => [
        cand({ productId: "small", size: "1 lb", price: { regular: 2, promo: 0 } }),
        cand({ productId: "mid", size: "3 lb", price: { regular: 5, promo: 0 } }),
        cand({ productId: "big", size: "5 lb", price: { regular: 7, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "rice", { quantity_hint: "2 lb" });
    expect(res).toMatchObject({ resolved: true, sku: "mid" });
  });

  it("ranked list honored by order (highest-ranked available brand wins)", async () => {
    const deps = makeDeps({
      brands: { olive_oil: ["Brand A", "Brand B"] },
      search: async () => [
        cand({ productId: "b", brand: "Brand B", price: { regular: 5, promo: 0 } }),
        cand({ productId: "a", brand: "Brand A", price: { regular: 9, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: true, sku: "a", reason: "preferred brand match" });
  });

  it("non-empty list whose brands are all unavailable → ambiguous", async () => {
    const deps = makeDeps({
      brands: { olive_oil: ["Brand A", "Brand B"] },
      search: async () => [cand({ productId: "c", brand: "Brand C", price: { regular: 5, promo: 0 } })],
    });
    const res = await matchIngredient(deps, "olive oil");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
  });
});

describe("matchIngredient — availability + scoring", () => {
  it("nothing fulfillable → unavailable, no substitution", async () => {
    const deps = makeDeps({
      brands: { salmon: [] },
      search: async () => [cand({ productId: "x", fulfillment: { curbside: false, delivery: false } })],
    });
    const res = await matchIngredient(deps, "salmon");
    expect(res).toEqual({
      resolved: false,
      reason: "unavailable",
      message: "No candidate is fulfillable via curbside/delivery at the preferred location.",
    });
  });

  it("a missing preferred brand does not empty the candidate set (routes to ambiguous)", async () => {
    const deps = makeDeps({
      brands: { butter: ["Kerrygold"] },
      search: async () => [
        cand({ productId: "store", brand: "Kroger", price: { regular: 3, promo: 0 } }),
        cand({ productId: "land", brand: "Land O Lakes", price: { regular: 4, promo: 0 } }),
      ],
    });
    const res = await matchIngredient(deps, "butter");
    expect(res).toMatchObject({ resolved: false, ambiguous: true });
    if (res.resolved === false && "ambiguous" in res) expect(res.candidates.length).toBeGreaterThan(0);
  });
});

describe("tiebreak", () => {
  it("prefers on-sale over regular", () => {
    const onSale = cand({ productId: "sale", size: "16 oz", price: { regular: 5, promo: 3 } });
    const regular = cand({ productId: "reg", size: "16 oz", price: { regular: 2, promo: 0 } });
    expect(tiebreak([regular, onSale]).productId).toBe("sale");
  });

  it("breaks remaining ties by best unit price", () => {
    const a = cand({ productId: "a", size: "32 oz", price: { regular: 4, promo: 0 } });
    const b = cand({ productId: "b", size: "16 oz", price: { regular: 3, promo: 0 } });
    // a: 4/32 = 0.125/oz ; b: 3/16 = 0.1875/oz -> a is cheaper per unit
    expect(tiebreak([a, b]).productId).toBe("a");
  });
});

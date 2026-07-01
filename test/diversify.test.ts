import { describe, it, expect } from "vitest";
import {
  diversifySelect,
  weekDiversity,
  type DiversifyCandidate,
} from "../src/diversify.js";

// A candidate with sensible defaults; override per test. Embeddings are tiny synthetic
// vectors — cosineSimilarity handles any length, and orthogonal vectors read as "distinct".
function c(over: Partial<DiversifyCandidate> & { slug: string }): DiversifyCandidate {
  return {
    title: over.slug,
    protein: null,
    cuisine: null,
    course: ["main"],
    time_total: null,
    score: 0.5,
    embedding: [1, 0, 0],
    ...over,
  };
}

describe("diversifySelect", () => {
  it("λ=1 with caps disabled reduces to top-K by score", () => {
    const cands = [
      c({ slug: "a", score: 0.9, embedding: [1, 0, 0] }),
      c({ slug: "b", score: 0.8, embedding: [0, 1, 0] }),
      c({ slug: "c", score: 0.7, embedding: [0, 0, 1] }),
    ];
    const picks = diversifySelect(cands, 3, 1, {
      lambda: 1,
      proteinCap: null,
      cuisineCap: null,
      courseCap: null,
      jitter: 0,
    });
    expect(picks.map((p) => p.slug)).toEqual(["a", "b", "c"]);
  });

  it("lowering λ spreads apart near-duplicates within the gate", () => {
    const cands = [
      c({ slug: "twin1", score: 1.0, embedding: [1, 0, 0], protein: "chicken" }),
      c({ slug: "twin2", score: 0.95, embedding: [1, 0, 0], protein: "chicken" }),
      c({ slug: "other", score: 0.6, embedding: [0, 1, 0], protein: "beef" }),
    ];
    // λ=1: pure relevance → the two twins win on score.
    const hi = diversifySelect(cands, 2, 1, { lambda: 1, proteinCap: null, jitter: 0 });
    expect(hi.map((p) => p.slug)).toEqual(["twin1", "twin2"]);
    // low λ: the redundant twin is penalized, the distinct dish takes the second slot.
    const lo = diversifySelect(cands, 2, 1, { lambda: 0.3, proteinCap: null, jitter: 0 });
    expect(lo.map((p) => p.slug)).toEqual(["twin1", "other"]);
  });

  it("honors the protein cap and never admits more than allowed", () => {
    const cands = [
      c({ slug: "ch1", score: 0.9, protein: "chicken", embedding: [1, 0, 0] }),
      c({ slug: "ch2", score: 0.85, protein: "chicken", embedding: [0, 1, 0] }),
      c({ slug: "ch3", score: 0.8, protein: "chicken", embedding: [0, 0, 1] }),
      c({ slug: "bf1", score: 0.5, protein: "beef", embedding: [1, 1, 0] }),
    ];
    const picks = diversifySelect(cands, 4, 1, { lambda: 0.7, proteinCap: 2, cuisineCap: null, jitter: 0 });
    expect(picks.filter((p) => p.protein === "chicken").length).toBeLessThanOrEqual(2);
    expect(picks.some((p) => p.protein === "beef")).toBe(true);
    // 2 chicken (cap) + 1 beef; the 3rd chicken is excluded → a genuine short slot.
    expect(picks.length).toBe(3);
  });

  it("leaves null-protein recipes uncapped", () => {
    const cands = [
      c({ slug: "n1", protein: null, embedding: [1, 0, 0], score: 0.9 }),
      c({ slug: "n2", protein: null, embedding: [0, 1, 0], score: 0.8 }),
    ];
    expect(diversifySelect(cands, 2, 1, { proteinCap: 1, jitter: 0 }).length).toBe(2);
  });

  it("is deterministic for a fixed seed and varies across seeds", () => {
    const cands = [
      c({ slug: "x", score: 0.5, embedding: [1, 0, 0] }),
      c({ slug: "y", score: 0.5, embedding: [0, 1, 0] }),
      c({ slug: "z", score: 0.5, embedding: [0, 0, 1] }),
    ];
    expect(diversifySelect(cands, 3, 7).map((p) => p.slug)).toEqual(
      diversifySelect(cands, 3, 7).map((p) => p.slug),
    );
    const firsts = new Set<string>();
    for (let s = 1; s <= 20; s++) firsts.add(diversifySelect(cands, 1, s)[0].slug);
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("returns fewer than n (or empty) when the caps/pool cannot supply more", () => {
    expect(diversifySelect([], 3)).toEqual([]);
    const chicken = [
      c({ slug: "a", protein: "chicken", embedding: [1, 0, 0], score: 0.9 }),
      c({ slug: "b", protein: "chicken", embedding: [0, 1, 0], score: 0.8 }),
      c({ slug: "c", protein: "chicken", embedding: [0, 0, 1], score: 0.7 }),
    ];
    expect(diversifySelect(chicken, 3, 1, { proteinCap: 1, jitter: 0 }).length).toBe(1);
  });
});

describe("weekDiversity", () => {
  it("counts distinct facets and the tightest pairwise similarity", () => {
    const emb = new Map<string, number[]>([
      ["a", [1, 0, 0]],
      ["b", [1, 0, 0]],
      ["c", [0, 1, 0]],
    ]);
    const d = weekDiversity(
      [
        { slug: "a", protein: "chicken", cuisine: "italian" },
        { slug: "b", protein: "chicken", cuisine: "french" },
        { slug: "c", protein: "beef", cuisine: "thai" },
      ],
      emb,
    );
    expect(d.distinctProteins).toBe(2);
    expect(d.distinctCuisines).toBe(3);
    expect(d.maxPairwiseSim).toBeCloseTo(1); // a and b are identical vectors
  });
});

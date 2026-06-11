import { describe, it, expect } from "vitest";
import { filterRecipes, type RecipeIndex } from "../src/recipes.js";

const index: RecipeIndex = {
  active1: {
    slug: "active1",
    title: "Active One",
    status: "active",
    protein: "beef",
    cuisine: "american",
    tags: ["weeknight", "beef", "one-pot"],
    season: ["fall"],
    dietary: ["dairy-free"],
    time_total: 40,
    last_cooked: null,
  },
  active2: {
    slug: "active2",
    title: "Active Two",
    status: "active",
    protein: "chicken",
    cuisine: "italian",
    tags: ["weeknight"],
    season: [],
    dietary: [],
    time_total: 90,
    last_cooked: "2026-06-05", // 3 days before the fixed now
  },
  draft1: {
    slug: "draft1",
    title: "Draft One",
    status: "draft",
    protein: "beef",
    tags: ["beef"],
    time_total: 20,
    last_cooked: "2025-01-01",
  },
};

const NOW = new Date("2026-06-08T00:00:00Z");

describe("filterRecipes", () => {
  it("defaults to active status", () => {
    const out = filterRecipes(index, {}, NOW).map((r) => r.slug);
    expect(out.sort()).toEqual(["active1", "active2"]);
  });

  it("status 'all' returns every status", () => {
    const out = filterRecipes(index, { status: "all" }, NOW).map((r) => r.slug);
    expect(out.sort()).toEqual(["active1", "active2", "draft1"]);
  });

  it("selects an explicit non-active status", () => {
    const out = filterRecipes(index, { status: "draft" }, NOW).map((r) => r.slug);
    expect(out).toEqual(["draft1"]);
  });

  it("array filters (dietary/season) match ALL listed values (AND)", () => {
    // active1: dietary ["dairy-free"], season ["fall"]
    expect(filterRecipes(index, { dietary: ["dairy-free"] }, NOW).map((r) => r.slug)).toEqual([
      "active1",
    ]);
    // requires BOTH values → active1 has only "dairy-free" → excluded
    expect(filterRecipes(index, { dietary: ["dairy-free", "gluten-free"] }, NOW).map((r) => r.slug)).toEqual([]);
    expect(filterRecipes(index, { season: ["fall"] }, NOW).map((r) => r.slug)).toEqual(["active1"]);
  });

  it("tags is no longer a filter — passing it is ignored", () => {
    // active1 has tag "beef"; with no tags filter the result is just the active default.
    const withTags = filterRecipes(index, { tags: ["beef"] } as never, NOW).map((r) => r.slug).sort();
    const without = filterRecipes(index, {}, NOW).map((r) => r.slug).sort();
    expect(withTags).toEqual(without);
  });

  it("filters by scalar fields and max_time_total", () => {
    expect(filterRecipes(index, { cuisine: "italian" }, NOW).map((r) => r.slug)).toEqual([
      "active2",
    ]);
    expect(filterRecipes(index, { max_time_total: 50 }, NOW).map((r) => r.slug)).toEqual([
      "active1",
    ]);
  });

  it("not_cooked_since admits never-cooked recipes (null last_cooked)", () => {
    const out = filterRecipes(index, { not_cooked_since: "2026-01-01" }, NOW).map((r) => r.slug);
    // active1 (null) passes; active2 cooked 2026-06-05 (>= date) is excluded.
    expect(out).toEqual(["active1"]);
  });

  it("exclude_cooked_within_days drops recently cooked, keeps never-cooked", () => {
    const out = filterRecipes(
      index,
      { status: "all", exclude_cooked_within_days: 14 },
      NOW,
    ).map((r) => r.slug);
    // active2 cooked 3 days ago -> excluded. active1 (null) and draft1 (2025) kept.
    expect(out.sort()).toEqual(["active1", "draft1"]);
  });

  it("returns slug, title, and frontmatter for matches", () => {
    const [item] = filterRecipes(index, { status: "draft" }, NOW);
    expect(item.slug).toBe("draft1");
    expect(item.title).toBe("Draft One");
    expect(item.frontmatter.protein).toBe("beef");
  });
});

const queryIndex: RecipeIndex = {
  "chicken-and-rice": {
    slug: "chicken-and-rice",
    title: "Chicken and Rice",
    status: "active",
    protein: "chicken",
    tags: ["weeknight", "comfort-food"],
    last_cooked: null,
  },
  "arroz-caldo": {
    slug: "arroz-caldo",
    title: "Arroz Caldo",
    status: "active",
    protein: "chicken",
    tags: ["chicken", "rice", "filipino"],
    last_cooked: null,
  },
  "lemon-chicken": {
    slug: "lemon-chicken",
    title: "Lemon Chicken",
    status: "active",
    protein: "chicken",
    tags: ["weeknight"],
    last_cooked: null,
  },
  "beef-stew": {
    slug: "beef-stew",
    title: "Beef Stew",
    status: "draft",
    protein: "beef",
    tags: ["comfort-food"],
    last_cooked: null,
  },
};

describe("filterRecipes query", () => {
  it("returns the exact-title named dish", () => {
    const out = filterRecipes(queryIndex, { query: "chicken rice" }, NOW).map((r) => r.slug);
    // "Chicken and Rice" (title has both tokens) and Arroz Caldo (tags have both) match.
    expect(out.sort()).toEqual(["arroz-caldo", "chicken-and-rice"]);
  });

  it("requires every token (AND) across title or tags", () => {
    // Lemon Chicken lacks the "rice" token in title and tags -> excluded.
    const out = filterRecipes(queryIndex, { query: "chicken rice" }, NOW).map((r) => r.slug);
    expect(out).not.toContain("lemon-chicken");
  });

  it("matches a token as a substring of a tag", () => {
    const out = filterRecipes(queryIndex, { query: "comfort" }, NOW).map((r) => r.slug);
    // comfort matches the comfort-food tag on chicken-and-rice (active default).
    expect(out).toEqual(["chicken-and-rice"]);
  });

  it("composes with other filters (AND)", () => {
    const out = filterRecipes(
      queryIndex,
      { query: "chicken", status: "active", protein: "chicken" },
      NOW,
    ).map((r) => r.slug);
    expect(out.sort()).toEqual(["arroz-caldo", "chicken-and-rice", "lemon-chicken"]);
  });

  it("absent or empty query preserves prior behavior", () => {
    const without = filterRecipes(queryIndex, {}, NOW).map((r) => r.slug).sort();
    const emptyQuery = filterRecipes(queryIndex, { query: "   " }, NOW).map((r) => r.slug).sort();
    expect(emptyQuery).toEqual(without);
    expect(without).toEqual(["arroz-caldo", "chicken-and-rice", "lemon-chicken"]);
  });

  it("drops connective stopwords so the natural phrase matches", () => {
    // "and" is a stopword → {chicken, rice}. Without stripping, arroz-caldo (no
    // "and" anywhere) would be wrongly excluded while only the title with "and"
    // survived. With stripping, both the title-match and the tag-match return.
    const out = filterRecipes(queryIndex, { query: "chicken and rice" }, NOW).map((r) => r.slug).sort();
    expect(out).toEqual(["arroz-caldo", "chicken-and-rice"]);
  });

  it("finds a title-only keyword (tag absent)", () => {
    // chicken-and-rice is titled "Chicken and Rice" but has no "rice" tag.
    const out = filterRecipes(queryIndex, { query: "rice" }, NOW).map((r) => r.slug);
    expect(out).toContain("chicken-and-rice");
  });

  it("an all-stopword query applies no text narrowing", () => {
    const out = filterRecipes(queryIndex, { query: "and the" }, NOW).map((r) => r.slug).sort();
    const without = filterRecipes(queryIndex, {}, NOW).map((r) => r.slug).sort();
    expect(out).toEqual(without);
  });
});

describe("filterRecipes makeability gate", () => {
  const gateIndex: RecipeIndex = {
    plain: { slug: "plain", title: "Plain", status: "active", last_cooked: null },
    needs: {
      slug: "needs",
      title: "Sous Vide Steak",
      status: "active",
      last_cooked: null,
      requires_equipment: ["sous-vide-circulator"],
    },
    twoNeeds: {
      slug: "twoNeeds",
      title: "Fancy",
      status: "active",
      last_cooked: null,
      requires_equipment: ["blender", "ice-cream-maker"],
    },
  };

  it("empty owned is a no-op (unknown inventory shows everything)", () => {
    const out = filterRecipes(gateIndex, {}, NOW, []).map((r) => r.slug).sort();
    expect(out).toEqual(["needs", "plain", "twoNeeds"]);
  });

  it("drops recipes whose requires_equipment is not a subset of owned", () => {
    const out = filterRecipes(gateIndex, {}, NOW, ["blender"]).map((r) => r.slug).sort();
    // plain (needs nothing) passes; needs (sous-vide) and twoNeeds (needs ice-cream-maker too) are gated out.
    expect(out).toEqual(["plain"]);
  });

  it("keeps a recipe when owned is a superset of its requirement", () => {
    const out = filterRecipes(gateIndex, {}, NOW, ["sous-vide-circulator", "blender"])
      .map((r) => r.slug)
      .sort();
    expect(out).toEqual(["needs", "plain"]);
  });

  it("include_unmakeable returns gated recipes annotated with missing_equipment", () => {
    const out = filterRecipes(gateIndex, { include_unmakeable: true }, NOW, ["blender"]);
    const needs = out.find((r) => r.slug === "needs");
    const twoNeeds = out.find((r) => r.slug === "twoNeeds");
    const plain = out.find((r) => r.slug === "plain");
    expect(needs?.frontmatter.missing_equipment).toEqual(["sous-vide-circulator"]);
    // twoNeeds owns blender but not ice-cream-maker → only the missing one is flagged.
    expect(twoNeeds?.frontmatter.missing_equipment).toEqual(["ice-cream-maker"]);
    // a makeable recipe carries no annotation.
    expect(plain?.frontmatter.missing_equipment).toBeUndefined();
  });

  it("gate ANDs with other filters", () => {
    // A status filter still applies alongside the gate.
    const out = filterRecipes(gateIndex, { status: "all" }, NOW, ["blender"]).map((r) => r.slug).sort();
    expect(out).toEqual(["plain"]);
  });
});

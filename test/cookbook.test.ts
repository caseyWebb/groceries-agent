import { describe, it, expect } from "vitest";
import { handleCookbook } from "../src/cookbook.js";
import type { Env } from "../src/env.js";
import { fakeR2 } from "./fake-r2.js";

const RECIPE_MD = [
  "---",
  "title: Miso Salmon",
  "protein: fish",
  "cuisine: japanese",
  "time_total: 25",
  "source: https://ex.com/miso-salmon",
  "---",
  "",
  "## Ingredients",
  "- salmon",
  "- miso",
  "",
  "## Instructions",
  "1. Glaze and broil.",
  "",
].join("\n");

/** An env whose DB returns the given recipe-index rows for loadRecipeIndex's SELECT. */
function envWith(opts: { recipeRows?: Record<string, unknown>[]; files?: Record<string, string> }): Env {
  const rows = opts.recipeRows ?? [];
  const stmt = { bind: () => stmt, all: async () => ({ results: rows }) };
  return {
    DB: { prepare: () => stmt },
    CORPUS: fakeR2(opts.files ?? {}).bucket,
  } as unknown as Env;
}

const get = (path: string, method = "GET") =>
  new Request(`https://groc.example.com${path}`, { method });

describe("handleCookbook", () => {
  it("renders the index from the D1 recipe index", async () => {
    const env = envWith({
      recipeRows: [
        { slug: "miso-salmon", title: "Miso Salmon", protein: "fish", cuisine: "japanese", description: "A quick glazed salmon." },
      ],
    });
    const res = await handleCookbook(get("/cookbook"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("Cookbook");
    expect(html).toContain('href="/cookbook/miso-salmon"');
    expect(html).toContain("Miso Salmon");
    expect(html).toContain("A quick glazed salmon.");
  });

  it("renders an empty index cleanly", async () => {
    const res = await handleCookbook(get("/cookbook"), envWith({}));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No recipes yet");
  });

  it("renders one recipe's R2 body to HTML", async () => {
    const env = envWith({ files: { "recipes/miso-salmon.md": RECIPE_MD } });
    const res = await handleCookbook(get("/cookbook/miso-salmon"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Miso Salmon</h1>");
    expect(html).toContain("<h2>Ingredients</h2>"); // marked rendered the body
    expect(html).toContain("Glaze and broil");
    expect(html).toContain("https://ex.com/miso-salmon"); // source link
  });

  it("neutralizes XSS in an untrusted recipe body (drops raw HTML + unsafe URL schemes)", async () => {
    const malicious = [
      "---",
      "title: Bad Recipe",
      "source: javascript:alert('src')",
      "---",
      "",
      "## Ingredients",
      "- <img src=x onerror=alert(1)>",
      "",
      "## Instructions",
      "<script>alert(2)</script>",
      "",
      "[click me](javascript:alert(3))",
      "",
    ].join("\n");
    const env = envWith({ files: { "recipes/bad.md": malicious } });
    const res = await handleCookbook(get("/cookbook/bad"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror=/i);
    expect(html).not.toMatch(/javascript:/i); // both the body link AND the source href
    // a restrictive CSP blocks script execution even if something slipped through
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });

  it("returns a graceful 404 (not a 500) for a recipe with malformed YAML frontmatter", async () => {
    // `parseMarkdown` throws ToolError('malformed_data'); the open route has no runTool
    // boundary, so the handler must catch it.
    const env = envWith({ files: { "recipes/broken.md": "---\ntitle: [unclosed\n---\n## Ingredients\n" } });
    const res = await handleCookbook(get("/cookbook/broken"), env);
    expect(res.status).toBe(404);
  });

  it("404s a missing recipe", async () => {
    const res = await handleCookbook(get("/cookbook/ghost"), envWith({}));
    expect(res.status).toBe(404);
  });

  it("404s an invalid slug without touching R2", async () => {
    const res = await handleCookbook(get("/cookbook/..%2Fsecret"), envWith({}));
    expect(res.status).toBe(404);
  });

  it("405s a non-GET method", async () => {
    const res = await handleCookbook(get("/cookbook", "POST"), envWith({}));
    expect(res.status).toBe(405);
  });
});

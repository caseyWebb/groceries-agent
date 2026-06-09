// Registers the six repo-data read tools on an McpServer. Each tool reads via
// the shared GitHub client and returns a structured result; failures map to the
// structured-error convention (errors.ts).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { createGitHubClient, GitHubError, type GitHubClient } from "./github.js";
import { parseMarkdown, parseToml } from "./parse.js";
import { ToolError, runTool } from "./errors.js";
import { filterRecipes, type RecipeFilters, type RecipeIndex } from "./recipes.js";
import { createKrogerClient, type KrogerCandidate } from "./kroger.js";
import {
  matchIngredient,
  isFulfillable,
  type CachedMapping,
  type MatchDeps,
} from "./matching.js";
import { compareUnitPrice, type UnitPriceItem } from "./unit-price.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const recipeFiltersShape = {
  status: z.string().optional(),
  protein: z.string().optional(),
  cuisine: z.string().optional(),
  tags: z.array(z.string()).optional(),
  season: z.array(z.string()).optional(),
  dietary: z.array(z.string()).optional(),
  max_time_total: z.number().optional(),
  not_cooked_since: z.string().optional(),
  exclude_cooked_within_days: z.number().optional(),
};

const pantryFilterShape = {
  category: z.string().optional(),
  prepared_only: z.boolean().optional(),
  stale_only: z.boolean().optional(),
};

const flyerFilterShape = {
  terms: z.array(z.string()).optional(),
  against_stockup: z.boolean().optional(),
  against_substitutions: z.boolean().optional(),
};

const matchContextShape = {
  recipe_slug: z.string().optional(),
  dietary: z.array(z.string()).optional(),
  quantity_hint: z.string().optional(),
};

const unitPriceItemShape = {
  id: z.string(),
  price: z.union([z.string(), z.number()]),
  size: z.string(),
  quantity_override: z.number().optional(),
  unit_override: z.string().optional(),
};

const READY_TO_EAT_MEALS = ["breakfast", "lunch", "dinner"] as const;

/** Read a file, mapping a 404 to `notFoundCode` and other failures to upstream. */
async function readFile(
  gh: GitHubClient,
  path: string,
  notFoundCode: "not_found" | "index_unavailable",
  notFoundMessage: string,
): Promise<string> {
  try {
    return await gh.getFile(path);
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 404) throw new ToolError(notFoundCode, notFoundMessage);
      throw new ToolError("upstream_unavailable", e.message);
    }
    throw e;
  }
}

/** Read a file that may be absent; map 404 to null, other failures to upstream. */
async function readOptional(gh: GitHubClient, path: string): Promise<string | null> {
  try {
    return await gh.getFile(path);
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 404) return null;
      throw new ToolError("upstream_unavailable", e.message);
    }
    throw e;
  }
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: "grocery-mcp", version: "0.1.0" });
  const gh = createGitHubClient(env);
  const kroger = createKrogerClient(env);

  // Per-request lazy caches: preferences is read once, the location resolved once,
  // even when several priced tools run in the same request.
  let prefsPromise: Promise<Record<string, unknown>> | null = null;
  function getPreferences(): Promise<Record<string, unknown>> {
    if (!prefsPromise) {
      prefsPromise = (async () => {
        const text = await readFile(gh, "preferences.toml", "not_found", "preferences.toml is missing");
        return parseToml(text, "preferences.toml");
      })();
    }
    return prefsPromise;
  }

  let locationPromise: Promise<string> | null = null;
  function getLocationId(): Promise<string> {
    if (!locationPromise) {
      locationPromise = (async () => {
        const prefs = await getPreferences();
        const stores = prefs.stores as Record<string, unknown> | undefined;
        const label =
          typeof stores?.preferred_location === "string" ? stores.preferred_location : null;
        if (!label) {
          throw new ToolError(
            "not_found",
            "preferences.toml [stores].preferred_location is not set; cannot price Kroger products",
          );
        }
        return kroger.resolveLocationId(label);
      })();
    }
    return locationPromise;
  }

  server.registerTool(
    "list_recipes",
    {
      description:
        "List recipes from the index, filtered. Array filters (tags/season/dietary) match ALL listed values. status defaults to 'active'; pass 'all' to include every status. exclude_cooked_within_days is a caller-supplied window.",
      inputSchema: { filters: z.object(recipeFiltersShape).optional() },
    },
    ({ filters }) =>
      runTool(async () => {
        const raw = await readFile(
          gh,
          "_indexes/recipes.json",
          "index_unavailable",
          "_indexes/recipes.json is missing",
        );
        let index: RecipeIndex;
        try {
          index = JSON.parse(raw) as RecipeIndex;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw new ToolError("index_unavailable", `_indexes/recipes.json is malformed: ${message}`);
        }
        return { recipes: filterRecipes(index, (filters ?? {}) as RecipeFilters) };
      }),
  );

  server.registerTool(
    "read_recipe",
    {
      description: "Read a single recipe's parsed frontmatter and markdown body by slug.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        const text = await readFile(
          gh,
          `recipes/${slug}.md`,
          "not_found",
          `Unknown recipe slug: ${slug}`,
        );
        const { frontmatter, body } = parseMarkdown(text, `recipes/${slug}.md`);
        return { slug, frontmatter, body };
      }),
  );

  server.registerTool(
    "read_pantry",
    {
      description:
        "Read pantry items. Supports category and prepared_only filters. stale_only is not yet supported (needs ingredients.toml).",
      inputSchema: { filter: z.object(pantryFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        if (filter?.stale_only) {
          throw new ToolError(
            "unsupported",
            "stale_only requires shelf-life data (ingredients.toml), introduced in a later change.",
          );
        }
        const text = await readFile(gh, "pantry.toml", "not_found", "pantry.toml is missing");
        const parsed = parseToml(text, "pantry.toml");
        let items = Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
        if (filter?.category !== undefined) {
          items = items.filter((i) => i.category === filter.category);
        }
        if (filter?.prepared_only) {
          items = items.filter((i) => i.prepared_from != null);
        }
        return { items };
      }),
  );

  server.registerTool(
    "read_preferences",
    {
      description: "Return the parsed contents of preferences.toml.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const text = await readFile(
          gh,
          "preferences.toml",
          "not_found",
          "preferences.toml is missing",
        );
        return parseToml(text, "preferences.toml");
      }),
  );

  server.registerTool(
    "read_taste",
    {
      description: "Return the raw markdown of taste.md (the user's taste profile narrative).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const content = await readFile(gh, "taste.md", "not_found", "taste.md is missing");
        return { content };
      }),
  );

  server.registerTool(
    "read_diet_principles",
    {
      description: "Return the raw markdown of diet_principles.md (variety rules narrative).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const content = await readFile(
          gh,
          "diet_principles.md",
          "not_found",
          "diet_principles.md is missing",
        );
        return { content };
      }),
  );

  server.registerTool(
    "kroger_prices",
    {
      description:
        "Current Kroger price for each ingredient at the preferred location: { regular, promo } price, on-sale flag, and curbside/delivery availability. Takes the top relevant fulfillable product per term.",
      inputSchema: { ingredients: z.array(z.string()) },
    },
    ({ ingredients }) =>
      runTool(async () => {
        const locationId = await getLocationId();
        const prices = [];
        for (const ingredient of ingredients) {
          const candidates = await kroger.search(ingredient, { locationId, limit: 5 });
          const fulfillable = candidates.filter(isFulfillable);
          const top = fulfillable[0] ?? candidates[0];
          if (!top) {
            prices.push({ ingredient, sku: null, available: { curbside: false, delivery: false } });
            continue;
          }
          prices.push({
            ingredient,
            sku: top.productId,
            brand: top.brand,
            size: top.size,
            price: top.price,
            on_sale: top.price.promo > 0,
            available: top.fulfillment,
          });
        }
        return { prices };
      }),
  );

  server.registerTool(
    "kroger_flyer",
    {
      description:
        "Synthesized sale scan (the public API has no flyer/circular endpoint). Scans precise context terms (passed plus stockup/substitution candidates) and broad curated terms from flyer_terms.toml, keeps promo > 0, dedupes by productId. Explicitly non-exhaustive: each term returns a relevance-ranked page, not a discount-sorted one.",
      inputSchema: { filter: z.object(flyerFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        const locationId = await getLocationId();
        const f = filter ?? {};

        const precise = [...(f.terms ?? [])];
        if (f.against_stockup) {
          const text = await readOptional(gh, "stockup.toml");
          if (text) {
            const items = (parseToml(text, "stockup.toml").items as Record<string, unknown>[]) ?? [];
            for (const it of items) if (typeof it.name === "string") precise.push(it.name);
          }
        }
        if (f.against_substitutions) {
          const text = await readOptional(gh, "substitutions.toml");
          if (text) {
            const rules = (parseToml(text, "substitutions.toml").rules as Record<string, unknown>[]) ?? [];
            for (const r of rules) {
              if (typeof r.ingredient === "string") precise.push(r.ingredient);
              if (Array.isArray(r.acceptable_substitutes)) {
                for (const s of r.acceptable_substitutes as unknown[]) {
                  if (typeof s === "string") precise.push(s);
                }
              }
            }
          }
        }

        // Broad terms: degrade gracefully when flyer_terms.toml is absent or empty.
        const broad: string[] = [];
        const flyerText = await readOptional(gh, "flyer_terms.toml");
        if (flyerText) {
          const parsed = parseToml(flyerText, "flyer_terms.toml");
          if (Array.isArray(parsed.terms)) {
            for (const t of parsed.terms as unknown[]) if (typeof t === "string") broad.push(t);
          }
        }

        const terms = [...new Set([...precise, ...broad].map((t) => t.trim()).filter(Boolean))];

        const PAGES = 2;
        const LIMIT = 20;
        const seen = new Map<string, unknown>();
        for (const term of terms) {
          for (let page = 0; page < PAGES; page++) {
            const candidates = await kroger.search(term, {
              locationId,
              limit: LIMIT,
              start: page * LIMIT,
            });
            if (candidates.length === 0) break;
            for (const c of candidates) {
              if (c.price.promo > 0 && isFulfillable(c) && !seen.has(c.productId)) {
                seen.set(c.productId, {
                  sku: c.productId,
                  brand: c.brand,
                  description: c.description,
                  size: c.size,
                  price: c.price,
                  savings: Math.round((c.price.regular - c.price.promo) * 100) / 100,
                  categories: c.categories,
                  matched_term: term,
                });
              }
            }
          }
        }
        return { items: [...seen.values()] };
      }),
  );

  server.registerTool(
    "ready_to_eat_available",
    {
      description:
        "Cross-reference ready_to_eat/*.toml catalogs against Kroger availability. 'Available' means fulfillable via curbside or delivery at the preferred location — the public API exposes no live in-store stock.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const locationId = await getLocationId();
        const available: Record<string, unknown[]> = { breakfast: [], lunch: [], dinner: [] };
        const unavailable: unknown[] = [];

        for (const meal of READY_TO_EAT_MEALS) {
          const text = await readOptional(gh, `ready_to_eat/${meal}.toml`);
          if (!text) continue;
          const items = (parseToml(text, `ready_to_eat/${meal}.toml`).items as Record<string, unknown>[]) ?? [];
          for (const item of items) {
            if (typeof item.name !== "string") continue;
            if (item.status === "rejected") continue;
            const candidates = await kroger.search(item.name, { locationId, limit: 5 });
            const match = candidates.find(isFulfillable);
            const record = {
              name: item.name,
              meal,
              sku: match?.productId ?? (typeof item.sku === "string" ? item.sku : null),
              price: match?.price ?? null,
              fulfillment: match?.fulfillment ?? { curbside: false, delivery: false },
            };
            if (match) available[meal].push(record);
            else unavailable.push(record);
          }
        }
        return { available, unavailable };
      }),
  );

  server.registerTool(
    "compare_unit_price",
    {
      description:
        "Deterministic price-per-unit comparison from raw price + size strings. The LLM never does the arithmetic. Ranks only WITHIN a dimension (volume/weight/count); cross-dimension or unparseable items land in incomparable, where the LLM may add quantity_override/unit_override and re-call.",
      inputSchema: { items: z.array(z.object(unitPriceItemShape)) },
    },
    ({ items }) => runTool(async () => compareUnitPrice(items as UnitPriceItem[])),
  );

  server.registerTool(
    "match_ingredient_to_kroger_sku",
    {
      description:
        "Run the resolve-only 7-step matching pipeline for one ingredient. Returns a confident match, ambiguous candidates, or unavailable. Never writes the cache (that rides write_cart_and_commit) and never substitutes (that's propose_substitutions). bypass_cache forces re-resolution.",
      inputSchema: {
        ingredient: z.string(),
        context: z.object(matchContextShape).optional(),
        bypass_cache: z.boolean().optional(),
      },
    },
    ({ ingredient, context, bypass_cache }) =>
      runTool(async () => {
        const locationId = await getLocationId();
        const prefs = await getPreferences();
        const brands = (prefs.brands as Record<string, string[]> | undefined) ?? {};

        const aliasText = await readOptional(gh, "aliases.toml");
        const aliases =
          aliasText !== null
            ? ((parseToml(aliasText, "aliases.toml").aliases as Record<string, string>) ?? {})
            : {};

        const cacheText = await readOptional(gh, "skus/kroger.toml");
        const cache: CachedMapping[] = [];
        if (cacheText) {
          const mappings = (parseToml(cacheText, "skus/kroger.toml").mappings as Record<string, unknown>[]) ?? [];
          for (const m of mappings) {
            if (typeof m.ingredient === "string" && typeof m.sku === "string") {
              cache.push({
                ingredient: m.ingredient,
                sku: m.sku,
                brand: typeof m.brand === "string" ? m.brand : undefined,
                size: typeof m.size === "string" ? m.size : undefined,
              });
            }
          }
        }

        const deps: MatchDeps = {
          search: (term: string): Promise<KrogerCandidate[]> =>
            kroger.search(term, { locationId, limit: 15 }),
          productById: (productId: string): Promise<KrogerCandidate | null> =>
            kroger.productById(productId, locationId),
          aliases,
          brands,
          cache,
        };
        return matchIngredient(deps, ingredient, context ?? {}, bypass_cache ?? false);
      }),
  );

  return server;
}

// Discovery + draft-creation tools (recipe-discovery capability):
//   - fetch_rss_discoveries — pull configured feeds, dedup vs corpus, return a
//     candidate POOL (no taste score; the agent judges fit and picks 1–2).
//   - import_recipe — PARSE-ONLY: fetch a page, return its JSON-LD Recipe data.
//     Writes nothing. The agent cleans/classifies, then calls create_recipe.
//   - create_recipe — write a new draft recipe as one solo commit.
//
// fetch_flyer_featured is intentionally NOT here: Kroger has no "featured"
// primitive, so on-sale ready-to-eat discovery rides the existing kroger_flyer
// pre-pass + flyer_terms.toml + agent-side catalog dedup (see AGENT_INSTRUCTIONS).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import { fetchWithBrowserHeaders } from "./http.js";
import { parseFeed } from "./feeds.js";
import { extractJsonLd, findRecipe, normalizeRecipe } from "./jsonld.js";
import {
  buildCandidates,
  buildNewRecipe,
  canonicalizeUrl,
  extractRecipeSources,
  indexSourceToSlug,
  type FeedEntry,
} from "./discovery.js";

const MAX_PER_FEED = 8;
const RECIPE_INDEX = "_indexes/recipes.json";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Discovery tools (recipe-discovery capability). Recipes are SHARED content, so
 * the corpus index + draft writes go through `sharedGh` (the data-repo root);
 * only `feeds.toml` is this tenant's personal config, read through `personalGh`
 * (their `users/<id>/` subtree). Imports dedupe by source URL against the shared
 * corpus so a recipe already present is reused, never duplicated (§6.4).
 */
export function registerDiscoveryTools(
  server: McpServer,
  sharedGh: GitHubClient,
  personalGh: GitHubClient,
): void {
  server.registerTool(
    "fetch_rss_discoveries",
    {
      description:
        "Pull the user's configured discovery feeds and return a deduped POOL of candidate recipes ({ url, title, source, feed_weight, summary }) — deduped against recipes already in the corpus (by source URL) and canonicalized (tracking query strings stripped). No taste score: YOU judge taste fit against the user's taste profile (read_taste) and pick the 1–2 worth importing, then import_recipe + create_recipe each. No configured feeds returns an empty pool. Unreachable feeds are skipped (reported in `skipped`), not fatal.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const feedsText = await readOptional(personalGh, "feeds.toml");
        if (!feedsText) return { candidates: [] };
        const parsed = parseToml(feedsText, "feeds.toml");
        const feeds = Array.isArray(parsed.feeds) ? (parsed.feeds as Record<string, unknown>[]) : [];
        if (feeds.length === 0) return { candidates: [] };

        const seen = extractRecipeSources(await readOptional(sharedGh, RECIPE_INDEX));

        const entries: FeedEntry[] = [];
        const skipped: { feed: string; reason: string }[] = [];
        for (const f of feeds) {
          const url = typeof f.url === "string" ? f.url : null;
          if (!url) continue;
          const feedName = typeof f.name === "string" ? f.name : url;
          const feedWeight = typeof f.weight === "number" ? f.weight : 1;
          try {
            const res = await fetchWithBrowserHeaders(url);
            if (!res.ok) {
              skipped.push({ feed: feedName, reason: `HTTP ${res.status}` });
              continue;
            }
            const items = parseFeed(await res.text()).slice(0, MAX_PER_FEED);
            for (const item of items) entries.push({ item, feedName, feedWeight });
          } catch (e) {
            skipped.push({ feed: feedName, reason: errMessage(e) });
          }
        }

        const candidates = buildCandidates(entries, seen);
        return skipped.length ? { candidates, skipped } : { candidates };
      }),
  );

  server.registerTool(
    "import_recipe",
    {
      description:
        "PARSE-ONLY: fetch a recipe page and return its schema.org JSON-LD as structured data ({ title, ingredients[], instructions[], servings, time_total, time_active, source, tools_hint? }). Writes nothing and commits nothing — clean up / classify the data, assemble the markdown body (with ## Ingredients and ## Instructions), then call create_recipe. `tools_hint` (present only when the page lists a schema.org `tool`) is a NON-AUTHORITATIVE hint for classifying `requires_equipment` — it lists every utensil, so default to [] and tag only truly-irreplaceable gear; never copy tools_hint into requires_equipment. If the source URL is already in the shared corpus, the result carries `existing_slug` — reuse that recipe instead of re-creating it (it's shared, you can rate/note it). Structured errors: unreachable (couldn't fetch), no_jsonld (no JSON-LD on page), not_a_recipe (JSON-LD but no Recipe), incomplete (Recipe missing ingredients/instructions). Bot-walled/paywalled sites (e.g. Serious Eats, NYT) return unreachable — paste the recipe instead.",
      inputSchema: { url: z.string() },
    },
    ({ url }) =>
      runTool(async () => {
        let res: Response;
        try {
          res = await fetchWithBrowserHeaders(url);
        } catch (e) {
          throw new ToolError("unreachable", `Could not fetch ${url}: ${errMessage(e)}`, { url });
        }
        if (!res.ok) {
          throw new ToolError("unreachable", `Fetching ${url} returned HTTP ${res.status}`, {
            url,
            status: res.status,
          });
        }

        const blocks = await extractJsonLd(res);
        if (blocks.length === 0) {
          throw new ToolError("no_jsonld", `No JSON-LD found at ${url}`, { url });
        }
        const recipe = findRecipe(blocks);
        if (!recipe) {
          throw new ToolError("not_a_recipe", `JSON-LD present but no schema.org Recipe at ${url}`, {
            url,
          });
        }
        const norm = normalizeRecipe(recipe);
        if (!norm.ok) {
          throw new ToolError("incomplete", `Recipe at ${url} is missing ${norm.missing.join(" and ")}`, {
            url,
            missing: norm.missing,
          });
        }

        const source = norm.recipe.source ?? canonicalizeUrl(url);
        // Idempotency (§6.4): if this source is already in the shared corpus, tell
        // the agent which slug to reuse rather than minting a duplicate.
        const existingSlug = indexSourceToSlug(await readOptional(sharedGh, RECIPE_INDEX)).get(
          canonicalizeUrl(source),
        );
        return existingSlug
          ? { ...norm.recipe, source, existing_slug: existingSlug }
          : { ...norm.recipe, source };
      }),
  );

  server.registerTool(
    "create_recipe",
    {
      description:
        "Write a NEW recipe to the SHARED corpus, as one solo commit. Slug derives from the title unless `slug` is given. Discovery imports: pass status 'draft' with discovered_at + discovery_source (status defaults to 'draft' if omitted). The body MUST contain ## Ingredients and ## Instructions. Classify `requires_equipment` conservatively: default [] (the common case) and include a vocab slug (pressure-cooker | sous-vide-circulator | blender | ice-cream-maker) ONLY when the dish is genuinely impossible without it — a wrong tag silently hides a makeable recipe. Refuses to overwrite an existing slug (slug_exists), and refuses to duplicate a recipe whose `source` URL is already in the corpus (already_exists, with the existing slug — reuse it).",
      inputSchema: {
        frontmatter: z.record(z.string(), z.unknown()),
        body: z.string(),
        slug: z.string().optional(),
      },
    },
    ({ frontmatter, body, slug }) =>
      runTool(async () => {
        // Idempotency (§6.4): a recipe is shared and single-source. If this
        // `source` already resolves to a corpus recipe, refuse the duplicate and
        // point the agent at the existing slug to reuse.
        const source = typeof frontmatter.source === "string" ? frontmatter.source : null;
        if (source) {
          const existing = indexSourceToSlug(await readOptional(sharedGh, RECIPE_INDEX)).get(
            canonicalizeUrl(source),
          );
          if (existing) {
            throw new ToolError(
              "already_exists",
              `A recipe for ${source} already exists (slug: ${existing}) — reuse it`,
              { slug: existing, source },
            );
          }
        }
        const { slug: finalSlug, file } = await buildNewRecipe(sharedGh, frontmatter, body, slug);
        const { commit_sha } = await commitFiles(sharedGh, [file], `add draft recipe ${finalSlug}`);
        return { slug: finalSlug, commit_sha };
      }),
  );
}

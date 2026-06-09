## 1. Extract (deterministic importer)

- [x] 1.1 Write `scripts/import-recime.mjs` — parse `recime-export.html`, split into cards by cookbook section, decode HTML entities; header comment names the ReciMe Recipe Exporter extension
- [x] 1.2 Drop non-recipe cards (zero ingredients AND zero steps), e.g. the "All Your Recipes… ReciMe" landing card
- [x] 1.3 Compute a raw-but-safe slug per card; exact-dedup by slug and merge each collapsed card's cookbook section into a `tags` array, excluding the `uncategorized` section (no tag)
- [x] 1.4 Extract deterministic fields: `title` (heading as-is for now; cleaned in pass 2), `servings`, `time_active` (prep, null if absent), `time_total` (sum of present prep/cook, null if neither)
- [x] 1.5 Build the body with `## Ingredients` (bullets) and `## Instructions` (numbered) from the card lists
- [x] 1.6 Emit each recipe via `gray-matter` with `status: active`, `source: null`, `discovered_at`/`discovery_source` null, and empty judgment fields (`protein`, `cuisine`, `style`, `difficulty`, `dietary`, `season`, `veg_forward`, `meal_preppable`, `ingredients_key`, `uses_components`, `produces_components`)
- [x] 1.7 Make the importer refuse to overwrite an existing recipe file (skip or fail loudly) so re-runs never clobber enrichment
- [x] 1.8 Run `node scripts/build-indexes.mjs --check`; confirm 63 files, exit 0, warnings only

## 2. Name (whole-corpus slug pass)

- [x] 2.1 Generate a clean `title` + slug for all 63 recipes: strip SEO "Recipe" suffixes and marketing qualifiers, resolve editorial-headline and foreign-name+gloss titles to the dish, preserve foreign dish names over their English gloss
- [x] 2.2 Ensure the proposed slug set is globally unique; disambiguate any collisions
- [x] 2.3 Surface the title+slug rename map to Casey for approval/tweaks
- [x] 2.4 Apply approved renames to filenames and write cleaned `title` into frontmatter

## 3. Beautify (batched enrichment)

- [x] 3.1 Fan out ~8 subagents, each owning ~8 recipes, with `SCHEMAS.md` + `taste.md` for context
- [x] 3.2 Per recipe, fill judgment frontmatter: `protein`, `cuisine`, `style`, `time` sanity, `difficulty`, `dietary`, `season`, `veg_forward`, `meal_preppable`
- [x] 3.3 Per recipe, curate `ingredients_key` (top 5–7) and tidy the body prose; re-split any wall-of-text instruction block into discrete steps (e.g. the egg-salad sandwich)
- [x] 3.4 Per recipe, attempt `source` recovery via web search; write `source` ONLY when the candidate page's ingredients/steps match the content, else leave null
- [x] 3.5 Per recipe, gut-check the extracted `time_total`/`time_active`/`servings` against the method; report (don't silently fix) anything implausible for Casey to confirm
- [x] 3.6 Run `--check` after each batch lands; confirm no new hard-fail errors

## 4. Reconcile (whole-corpus final pass)

- [x] 4.1 Wire `uses_components` / `produces_components` so every `uses_components` reference resolves to a producing recipe
- [x] 4.2 Review near-duplicate pairs (e.g. two `Pasta e Fagioli`, stovetop vs pressure-cooker `Butter Chicken`); report them for Casey's decision, do not auto-merge
- [x] 4.3 Run `node scripts/build-indexes.mjs` and drive warnings to zero
- [x] 4.4 Verify `_indexes/recipes.json` and `_indexes/components.json` regenerate cleanly

## 5. Finalize

- [x] 5.1 Delete `recime-export.html` (import complete; source data now lives in the recipe files)
- [x] 5.2 Single batched commit: 63 recipe files + `scripts/import-recime.mjs` + regenerated indexes + export removal, with a session-summary message

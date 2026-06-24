## 1. Schema

- [ ] 1.1 Add `migrations/d1/0002_recipes.sql`: the `recipes` table (scalar + JSON columns + `extra`) and `CREATE INDEX idx_recipes_source_url`. No subjective columns.
- [ ] 1.2 `wrangler d1 migrations apply DB --local` to seed dev; confirm it composes with `0001_init.sql`.

## 2. Build projection

- [ ] 2.1 `scripts/build-indexes.mjs`: replace `publishToKv(indexes, root)` with `projectToD1(indexes, root)` using `scripts/d1-rest.mjs` — one transaction: `DELETE FROM recipes` then batched `INSERT` of every recipe (arrays `JSON.stringify`'d into the JSON columns; non-promoted objective fields into `extra`). Drop the `index:recipes` `kvPut`.
- [ ] 2.2 Keep `writeIndexes` (`_indexes/recipes.json`) for now (open question); ensure determinism is unchanged.
- [ ] 2.3 Graceful skip (warn, don't fail `--check`/pre-provision) when D1 access can't resolve — mirror the old `publishToKv` skip behavior.

## 3. Worker read layer

- [ ] 3.1 Add `src/recipe-index.ts`: `loadRecipeIndex(env)` → `RecipeIndex` (`SELECT * FROM recipes`, JSON-parse arrays + `extra`); `recipeSourceMap(env)` → `Map<sourceUrl, slug>`; `recipeMeta(env, slugs)` for retrospective's per-slug protein/cuisine. Built on `src/db.ts`.
- [ ] 3.2 `src/tools.ts` `list_recipes`: swap `env.DATA_KV.get("index:recipes")` + `JSON.parse` for `loadRecipeIndex(env)`. Empty table → `{ recipes: [] }`; unreachable → `index_unavailable`. Overlay merge + `filterRecipes` unchanged.
- [ ] 3.3 `src/cooking-tools.ts` (`retrospective`): replace `dataKv.get("index:recipes")` with the D1 metadata query.
- [ ] 3.4 `src/discovery-tools.ts`: replace the three `dataKv.get("index:recipes")` reads — source enumeration + `source_url → slug` lookups — with `recipeSourceMap(env)` / indexed queries.

## 4. Env + deploy

- [ ] 4.1 `src/env.ts`: update the `DATA_KV` doc — it no longer holds `index:recipes`; the recipe index is in D1. (DATA_KV still holds profile/session keys.)
- [ ] 4.2 `.github/workflows/data-build-indexes.yml`: ensure the build step has D1 access (operator's pinned `database_id` in `wrangler.jsonc` + `CLOUDFLARE_API_TOKEN`); the post-deploy `build-indexes` in `data-deploy.yml` now populates D1.

## 5. Docs

- [ ] 5.1 `docs/SCHEMAS.md`: document the `recipes` D1 table (columns, JSON-array columns, `extra`, no subjective fields).
- [ ] 5.2 `docs/ARCHITECTURE.md`: the recipe index is D1-served; recipe content stays in git; note the derived-projection-rebuild pattern (no backfill).

## 6. Tests + verify

- [ ] 6.1 `tests/build-indexes.test.mjs`: assert the D1 projection (rows match parsed recipes; deleted recipe drops its row; arrays round-trip; `extra` carries unpromoted fields) instead of the KV publish.
- [ ] 6.2 Read-path tests against local D1: `list_recipes` filtering parity with the prior KV-blob behavior; empty table → empty list (not error); discovery source-URL lookup hits the index; `retrospective` resolves recipe metadata.
- [ ] 6.3 `npm run typecheck` + `npm test` green; manual: deploy → post-deploy build populates `recipes`; `list_recipes` returns; admin can `SELECT` the table.

## 1. Schema + backfill

- [ ] 1.1 Add `migrations/d1/0006_shared_corpus.sql`: `aliases`, `feeds`, `discovery_senders`, `discovery_members`, `flyer_terms`, `sku_cache`, `discovery_candidates` (UNIQUE url), `stores`, `store_notes`, `recipe_notes` + indexes (`sku_cache(ingredient, location_id)`, `recipe_notes(recipe)`, `store_notes(store)`).
- [ ] 1.2 Add `migrations/0005-shared-corpus-d1.mjs`: read the data-repo checkout TOML (single files + `stores/`, `store_notes/`, `notes/` trees), parse, insert rows. Idempotent (reload per table).
- [ ] 1.3 Test the backfill (each artifact → rows; attribution/private preserved for notes; inbox dedup by url).

## 2. Reads → D1

- [ ] 2.1 Matcher: aliases (`gh-read.ts`/`tools.ts`) and SKU cache (`getCacheMappings`) → D1 queries; cache lookup by `(ingredient, location_id)`.
- [ ] 2.2 Stores: `list_stores`/`read_store` (`stores.ts`/`stores-tools.ts`) → D1.
- [ ] 2.3 Notes: `read_store_notes` and `read_recipe_notes` (`notes-tools.ts`) → D1 (recipe-notes join the slice-4 ratings query; apply own-private + everyone-shared filter).
- [ ] 2.4 Discovery: `read_discovery_inbox`, feeds reader, flyer-terms reader (`flyer-warm.ts`) → D1.

## 3. Writes → D1 (with write-time validation)

- [ ] 3.1 `update_aliases`, `update_feeds`, `update_discovery_sources` → D1 upsert/delete.
- [ ] 3.2 `add/update/remove_store` + write-time store validation (slug/name/domain, moved from the build).
- [ ] 3.3 `add/update/remove_store_note`, `add/update/remove_recipe_note` → D1 (author = caller; private flag).
- [ ] 3.4 SKU-cache writer (`order-tools.ts`) → upsert `sku_cache`.
- [ ] 3.5 Email-ingest inbox writer (`email.ts`/`discovery.ts`) → insert `discovery_candidates` with `UNIQUE(url)` dedup + write-time candidate validation.

## 4. Build collapses to recipes-only

- [ ] 4.1 `scripts/build-indexes.mjs`: remove `validateStore`, `validateDiscoveriesInbox`, `validateDiscoverySources`, and `parseCheckToml`/`walkToml`; the run is now recipe validation + index projection (slice 1).
- [ ] 4.2 Move the dropped validations into `src/validate.ts` as write-time checks used by the tools in §3.

## 5. Remove TOML

- [ ] 5.1 Remove `smol-toml` usages; delete `src/parse.ts`/`src/serialize.ts` TOML helpers (or the files if empty); drop `smol-toml` from `package.json`/lockfile.
- [ ] 5.2 Data-repo cleanup commit: delete the now-orphaned `.toml` files (aliases/feeds/discovery/flyer/sku/inbox, `stores/`, `store_notes/`, `notes/`, and the slice-2 `cooking_log.toml` leftovers).

## 6. Docs

- [ ] 6.1 `docs/SCHEMAS.md`: D1 tables replace every remaining TOML schema.
- [ ] 6.2 `docs/ARCHITECTURE.md`: the completed boundary — GitHub = recipes only; D1 = all domain data; KV = ephemeral infra.
- [ ] 6.3 `CONTRIBUTING.md`: remove TOML data tooling; note write-time validation replaced build-time for non-recipe data.

## 7. Verify

- [ ] 7.1 `npm run typecheck` + `npm test` green (every read/write path; notes attribution/privacy; sku-cache + inbox dedup; build recipes-only).
- [ ] 7.2 Manual: backfill; matcher resolves via D1 aliases/cache; `read_recipe_notes` returns notes + group ratings in one path; store/discovery writes validate at the tool.

> Note: this slice has the largest tool surface — the two spec deltas here (`shared-corpus`, `build-automation`) capture the architecture; the per-tool deltas for `ingredient-matching`, `newsletter-discovery`, and `recipe-notes` are enumerated above and finalized when this slice is applied.

## 1. Schema + backfill

- [ ] 1.1 Add `migrations/d1/0004_profile.sql`: the `profile`, `brand_prefs`, `kitchen_equipment`, `staples`, `overlay`, `ready_to_eat`, `stockup` tables + `idx_overlay_recipe`.
- [ ] 1.2 Add `migrations/0003-profile-d1.mjs` (`up({ kv, d1, dataRoot, log })`): per `profile:<username>`, parse the TOML/markdown fields, delete-then-insert the tenant's rows across the profile tables, then `kv.delete` the bundle key. Idempotent (absent key → skip). Don't touch `state:<username>:*`.
- [ ] 1.3 Test the backfill against a sample bundle (all fields → rows; brands tri-state preserved; re-run no-ops; KV key removed).

## 2. D1 profile data layer

- [ ] 2.1 Add `src/profile-db.ts`: assembly reads (`readProfile(tenant)` → the full profile object; `readPreferences`, `readOverlay`, `readOwnedEquipment`, `readBrandPrefs`) and row writers (`setProfileFields`, `upsertBrand`/`deleteBrand`, `upsertStaple`/`deleteStaple`, `setOverlay`, `upsertReadyToEat`, `upsertStockup`, `setKitchen`), all over `src/db.ts`, using `batch` for multi-row writes.
- [ ] 2.2 Port `overlay.ts` semantics (`applyOverlayEdit`, `mergeOverlay`, `DEFAULT_STATUS`) to operate on rows/objects; delete `parseOverlay`/`serializeOverlay`/`quoteKey`/`formatScalar`.
- [ ] 2.3 Port `staples.ts`/`stockup.ts`/`kitchen.ts` pure logic to object/row in/out; delete their `parseToml`/`stringifyTomlWithHeader`/`*_HEADER` usage.

## 3. Reads → D1

- [ ] 3.1 `src/tools.ts`: `read_user_profile` assembles from `src/profile-db.ts` (batched); `getPreferences`/`getOverlay`/`getOwnedEquipment` and the weather location resolver read D1. Same returned shapes.
- [ ] 3.2 Matcher wiring (`resolveIngredient`): `brands` from `readBrandPrefs(tenant)`.
- [ ] 3.3 `src/notes-tools.ts` `read_recipe_notes`: ratings via `SELECT … FROM overlay WHERE recipe=?` scoped to the caller's group (drop the per-tenant bundle scan); notes half unchanged (GitHub, until slice 6).

## 4. Writes → D1

- [ ] 4.1 `update_preferences` → merge-patch on D1: implement/port `mergePatch`; staged validation (unknown top-level key → error toward `custom`; enum/type checks on the merged result, in `src/validate.ts`); apply as `profile` column updates + `brand_prefs` UPSERT/DELETE + JSON-column merges, in one `batch`.
- [ ] 4.2 `update_taste`/`update_diet_principles` → `UPDATE profile`.
- [ ] 4.3 `update_kitchen` → UPSERT/DELETE `kitchen_equipment` + `profile.kitchen_notes`.
- [ ] 4.4 `update_staples` → UPSERT/DELETE `staples` (normalized-name dedup).
- [ ] 4.5 `update_stockup` → UPSERT `stockup` + `profile.freezer_capacity_estimate`.
- [ ] 4.6 `add_draft_ready_to_eat`/`update_ready_to_eat` → UPSERT `ready_to_eat`.
- [ ] 4.7 `rate_recipe` (from slice 3): swap its backend from the KV overlay to `setOverlay` (D1 UPSERT).

## 5. Delete the KV-bundle layer

- [ ] 5.1 `src/user-kv.ts`: remove `ProfileBundle`, `readProfileBundle`, `writeProfileBundle`, `updateProfileField`, `getProfileBundle`, `deleteProfileBundle` (keep the `state:*` session helpers — slice 5). Update the file header.
- [ ] 5.2 Remove now-unused `smol-toml`/`parse`/`serialize` imports from the profile path; confirm `smol-toml` is still imported only by the GitHub-corpus modules (until slice 6).
- [ ] 5.3 Grep `src/**`/`test/**` for `profile:` / `ProfileBundle` / `parseOverlay` / `bundle.<field>` and clean up.

## 6. Docs + agent

- [ ] 6.1 `docs/SCHEMAS.md`: the profile D1 tables; the `preferences` shape (defined keys + `custom`) and merge-patch contract; remove the TOML profile schemas.
- [ ] 6.2 `docs/TOOLS.md`: `update_preferences` `patch` param; profile writes are D1-backed.
- [ ] 6.3 `docs/ARCHITECTURE.md`: profile in D1; group ratings as a SQL aggregate.
- [ ] 6.4 `AGENT_INSTRUCTIONS.md`: `update_preferences` patch shape; delete the configure-profile "read the whole file and rewrite every field" instruction (deep merge / row writes are the non-clobber guarantee). Rebuild the plugin.

## 7. Close out json-profile-bundle

- [ ] 7.1 Archive `json-profile-bundle` (realized here) and `finish-kv-migration` (absorbed) per the OpenSpec archive flow, or note them superseded.

## 8. Verify

- [ ] 8.1 `npm run typecheck` + `npm test` green (D1 read/write, merge-patch validation incl. brands tri-state, backfill).
- [ ] 8.2 Manual: backfill a sample tenant; `read_user_profile` matches the pre-migration shape; `update_preferences` partial patch doesn't clobber siblings; `rate_recipe` writes `overlay`; group ratings show "rated 4+ by others" via the query.

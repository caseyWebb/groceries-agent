# Remediation tracker — audit 2026-06-26

Working tracker for the findings from two reviews (internal "ultrareview" + a second
reviewer). Every item below was **verified against the code/docs at HEAD `e2208b8`** —
file:line references are real, not speculative. This is a temporary working doc; delete
it once the list is cleared.

> **✅ Resolved 2026-06-26 on branch `audit-remediation`.** All 20 items addressed via four
> parallel worktree agents (persona / Worker code / reference docs / specs+narrative), then
> integrated. Verification on the merged branch: `aubr typecheck` clean · `aubr test` 560 pass /
> 9 skipped · `aubr test:tooling` 104 pass · plugin drift guard PASS. One deviation worth
> noting: **CODE-3** (case-insensitive `meal_plan` delete via `LOWER(recipe)=LOWER(?2)`) also
> required teaching the `test/fake-d1.ts` harness the new SQL form — the regex-based fake
> previously fell through to a tenant-wide delete. Branch is based on `chore/enable-caseywebb-plugins`
> (the checked-out branch at the time), not `main` — rebase if a clean-main PR is wanted.

**Process:** fixes go straight to the relevant file (no OpenSpec proposal per item), but
**reconcile the affected `openspec/specs/*/spec.md` in the same commit** where a spec is
listed under "Spec impact." Keep each change green: `aubr typecheck`, `aubr test`,
`aubr test:tooling`, and rebuild the plugin (`aubr build:plugin`) when `AGENT_INSTRUCTIONS.md`
changes.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` won't fix / N/A

---

## Root-cause themes

Almost everything traces to two migrations whose cleanup stopped at the code boundary:

1. **GitHub/TOML/KV → Cloudflare D1.** Code finished it; `docs/TOOLS.md`, `docs/SCHEMAS.md`,
   `docs/ARCHITECTURE.md`, `docs/SELF_HOSTING.md`, three live specs, and a few in-code tool
   **descriptions** still describe KV keys, `*.toml` paths, and `commit_sha` returns that no
   longer exist.
2. **Status/rating lifecycle → favorites/rejections overlay (#78).** Code + persona are clean;
   three live specs and the README still describe the retired model.

Two findings are independent of the migrations: the **Kroger in-store flow** is built on a
tool that can't supply the data it needs (FN-3), and a **build/codegen** double-pointer bug
(BLD-1).

---

## Summary

| ID | Sev | Area | One-liner | Spec? |
|----|-----|------|-----------|-------|
| FN-1 | High | persona | `read_staples()` called in persona+skills; tool was removed | — |
| FN-2 | High | persona | `read_kitchen()` called in persona+skills; tool was removed | — |
| FN-3 | High | code | Kroger in-store walk needs a per-store location override + `aisleLocation`; `kroger_prices` supplies neither | kroger-integration, in-store-fulfillment |
| SPEC-1 | High | specs | `data-read-tools` still specs the retired recipe `status` lifecycle | data-read-tools |
| SPEC-2 | High | specs | `data-write-tools` specs a nonexistent `set_recipe_status` + `status` writes | data-write-tools |
| SPEC-3 | High | specs | `repo-structure` lists per-user `*.toml` state files that moved to D1 | repo-structure |
| DOC-1 | Med | TOOLS.md | Systemic KV / `commit_sha` / `*.toml` drift across tool families | — |
| DOC-2 | Med | code | In-code descriptions for `update_staples`/`update_stockup` cite `*.toml` paths + `commit_sha` | — |
| DOC-3 | Med | TOOLS.md | `read_user_profile` documents `staples: { items: [...] }`; code returns a bare array | — |
| SCH-1 | Med | SCHEMAS.md | `skus/kroger.toml` section never migrated to the D1 `sku_cache` framing (stale fields + field-name) | — |
| SCH-2 | Med | SCHEMAS.md | `discovery_candidates.status` and `stores.extra` columns undocumented | — |
| ARC-1 | Med | ARCHITECTURE.md | Self-contradiction + stale storage boundary (TOML files, smol-toml, `_indexes/`, diagram) | — |
| ARC-2 | Med | SELF_HOSTING.md | Operator steps tell you to hand-edit TOML files that are now D1; `_indexes/` regen description stale | — |
| BLD-1 | Low | build | Generated skills repeat every `> For details` pointer twice | — |
| BLD-2 | Low | build | `test:tooling` lists 4 deleted backfill test files | — |
| CODE-1 | Low | code | Dead exports: `prefixedClient`, `readStockup`, `MEAL_PLAN_PATH`, `stripCdata`, `__resetModuleCache` | — |
| CODE-2 | Low | code | `place_order` result carries a vestigial `sku_cache.commit_sha` (always null; SKU cache is D1) | — |
| CODE-3 | Low | code | `meal_plan` delete is case-sensitive (`WHERE recipe = ?`) but ops match case-insensitively | — |
| DOC-4 | Low | misc | Stale `smol-toml` comments; README markets retired "ratings" | — |
| SPEC-4 | Low | specs | `data-indexing` is superseded (D1) but body still describes `_indexes/recipes.json` + `DATA_KV` | data-indexing |

---

## High — functional / contract-breaking

### FN-1 · `read_staples()` is called but no longer exists  `[x]`
The tool was removed (subsumed into `read_user_profile()`'s `staples`). Not in `src/` or
`docs/TOOLS.md`, but the live persona still calls it:
- `AGENT_INSTRUCTIONS.md:97` — and it self-contradicts line 70 (says `read_user_profile()`
  already returns staples in the same batch).
- `AGENT_INSTRUCTIONS.md:155` — instructs a lazy `read_staples()` in the update-pantry flow.
- Propagated to `plugin/.../skills/meal-plan/SKILL.md:45`, `skills/update-pantry/SKILL.md:12`.

**Fix:** rewrite both source lines to read staples off the already-loaded `read_user_profile()`
result (and note the shape is a bare array, not `{ items }` — see DOC-3). Rebuild the plugin.
**Spec impact:** none.

### FN-2 · `read_kitchen()` is called but no longer exists  `[x]`
Same removal (subsumed into `read_user_profile()`'s `kitchen`):
- `AGENT_INSTRUCTIONS.md:172` — "`read_kitchen()` returns `owned` … and freeform `notes`".
- Propagated to `plugin/.../skills/cook/SKILL.md:16`.

**Fix:** source the equipment from `read_user_profile().kitchen`. Rebuild the plugin.
**Spec impact:** none.

### FN-3 · Kroger in-store walk can't get the data it's documented to use  `[x]`
The in-store reference drives the walk off `kroger_prices`, but the tool can't supply what the
flow needs:
- **No location override.** `kroger_prices` input is `{ ingredients }` only; it resolves the
  profile's *preferred* location internally (`src/tools.ts:524,533` → `getLocationId()`). The
  reference says to call it "passing the store's `location_id`"
  (`plugin/.../skills/shop-groceries/references/kroger-instore.md:18`, also `:14`). Walking a
  Kroger that isn't the saved preferred store therefore prices the wrong store.
- **`aisleLocation` is discarded.** The Kroger client fetches `aisleLocation`
  (`src/kroger.ts:41`), but `productRow` (`src/tools.ts:117`) drops it — it returns only
  `{ sku, brand, description, size, price, on_sale, available }`. The walk's core step ("order
  items by `aisleLocation.number`", kroger-instore.md) has no data to sort on. `inStore` is
  also only reachable nested under `available.inStore`, not the top-level `inStore` the
  reference claims.

**Fix (code):** add an optional `location_id`/`location` override to `kroger_prices` (fall back
to `getLocationId()`), and surface `aisleLocation` + top-level `inStore` in `productRow`. Then
re-confirm the kroger-instore reference matches. `docs/TOOLS.md:339` already advertises
"API-driven aisle ordering (`aisleLocation`)" as if it works — it'll be true once the field is
surfaced.
**Spec impact:** check `openspec/specs/kroger-integration` and `in-store-fulfillment` for the
intended contract; update whichever side is wrong.

### SPEC-1 · `data-read-tools` specs the retired `status` lifecycle  `[x]`
`openspec/specs/data-read-tools/spec.md` describes `list_recipes({ status })`, statuses
`active/draft/rejected/archived`, and `read_recipe` defaulting overlay `status` to `draft`
(lines ~9, 33, 37, 54–57, 115, 120). Code retired all of it (`src/overlay.ts:10-13,40` — overlay
is `favorite`/`reject` only). The spec even contradicts itself at lines ~204-206.
**Fix:** rewrite to the favorites/rejections overlay; remove status filtering/defaults. Align
the `read_user_profile`/`list_recipes` return shapes while here.

### SPEC-2 · `data-write-tools` specs `set_recipe_status` (doesn't exist)  `[x]`
`openspec/specs/data-write-tools/spec.md` lists `set_recipe_status` and
`update_recipe({ status })` (lines ~11, 34, 262, 273). No such tool (`git grep set_recipe_status
-- src` is empty); disposition is `toggle_favorite`/`toggle_reject` and `update_recipe` *rejects*
`status` (`src/write-tools.ts:60-65`). Self-contradicts its own line ~77.
**Fix:** replace with the toggle tools; note D1 writes return no `commit_sha`.

### SPEC-3 · `repo-structure` lists per-user TOML state that moved to D1  `[x]`
`openspec/specs/repo-structure/spec.md:27,116` still enumerate `pantry.toml`, `preferences.toml`,
`feeds.toml`, `stockup.toml`, `ready_to_eat.toml`, `overlay.toml`, `cooking_log.toml`,
`meal_plan.toml`, `grocery_list.toml` as on-disk files. All are D1 now; GitHub holds only
`recipes/*.md` and `storage_guidance/*.md`. (The submodule requirement at ~125-132 was correctly
updated for #80 — leave it.)
**Fix:** rewrite the storage layout to the D1 boundary.

---

## Medium — contract docs & schema drift

### DOC-1 · `docs/TOOLS.md` systemic KV / `commit_sha` / `*.toml` drift  `[x]`
The doc was only partially migrated. Confirmed-stale spots (code is D1, returns no `commit_sha`):

- **KV-backed claims** (now D1): grocery list `294,317,324,331` (names a `state:<username>:grocery_list`
  DATA_KV key); `read_user_profile` `643` ("`profile:<username>`" + deploy-time "migration runner");
  meal plan `726,737,741,788`; kitchen/pantry-verified `250,262`.
- **`commit_sha` on D1 write paths** (code returns none — verified): `add_store` `366`
  (`src/stores-tools.ts:101` → `{ store }`), `update_store` `380`, `remove_store` `390`;
  recipe notes `170,180,191` and store notes `403,413,424` (`src/notes-tools.ts` returns
  `{ slug, author, created_at }` / `{ slug, removed, created_at }`); `update_discovery_sources`
  `582` and `update_feeds` `594` (`src/discovery-tools.ts:241,264` → `{ added }`);
  `add_draft_ready_to_eat` `604` and `update_ready_to_eat` `615` (`src/write-tools.ts:394`).
- **Stale `*.toml` path prose:** kitchen `244`, staples `266`, stockup `279`, recipe notes `157`,
  store notes `397`.
- **Keep as-is (legitimately GitHub):** `update_recipe` `86` and `import_recipe` `144` —
  recipe markdown still commits to GitHub.

**Fix:** one full pass over `docs/TOOLS.md`. Note lines `273` (staples) and `286` (stockup) are
already correct — the *code* descriptions for those two are the wrong side (see DOC-2).

### DOC-2 · In-code tool descriptions cite `*.toml` paths + `commit_sha`  `[x]`
These descriptions ship to the model. Both are D1-backed and return no `commit_sha`, but:
- `update_staples` (`src/write-tools.ts:309`) — "users/<id>/staples.toml" + "Returns
  `{ added, removed, commit_sha }`"; actual return is `{ added, removed }`.
- `update_stockup` (`src/write-tools.ts:267`) — "users/<id>/stockup.toml" + "Returns
  `{ added, commit_sha }`"; actual return is `{ added }`.

This regresses the archived `strip-internal-paths-from-descriptions` change. **Fix:** drop the
internal paths and the `commit_sha` claims from both description strings.

### DOC-3 · `read_user_profile.staples` shape is wrong in the doc  `[x]`
`docs/TOOLS.md:637` documents `staples: { items: [...] }`. Code returns `staples: profile.staples`,
a bare `StaplesItem[]` (`src/tools.ts:497`, `src/profile-db.ts:60`). This is the likely origin of
the persona's `read_staples` returning `{ items: [] }` assumption (FN-1).
**Fix:** doc the array shape; fix the persona's `{ items }` handling in the same pass as FN-1.

### SCH-1 · `docs/SCHEMAS.md` `skus/kroger.toml` never migrated to D1 framing  `[x]`
Still framed as a machine-maintained TOML file with fields `reason` and `ambiguity_resolved`
(SCHEMAS.md ~671,681,684) and `locationId`. The authoritative `sku_cache` table
(`migrations/d1/0006_shared_corpus.sql`) has only `ingredient, location_id, sku, brand, size,
last_used` (read/written at `src/corpus-db.ts:84,118`). `reason`/`ambiguity_resolved` don't exist;
the column is `location_id`.
**Fix:** rewrite the section as the D1 `sku_cache` table; drop the two phantom fields.

### SCH-2 · Undocumented D1 columns  `[x]`
- `discovery_candidates.status` exists (`0006_shared_corpus.sql`) but is undocumented (SCHEMAS.md
  ~10, 427-453).
- `stores.extra` JSON column (holds `label/chain/address/location_id`) is the real shape
  (`src/corpus-db.ts:399`); SCHEMAS.md (~505-512) documents those as flat top-level keys and the
  placement summary (~10) omits `extra`. (`recipe_notes`/`store_notes` `id` PK also undocumented —
  minor, fold in here.)
**Fix:** document `status` and the `extra` JSON envelope.

### ARC-1 · `docs/ARCHITECTURE.md` self-contradiction + stale storage boundary  `[x]`
- **Self-contradiction:** line 113 correctly lists `discovery_candidates` as D1; line 203 says
  newsletter emails are captured "in the shared `discoveries_inbox.toml`". Code inserts into D1
  (`src/email.ts:226`, `src/corpus-db.ts:325`).
- Data-flow diagram (~33-36) lists `aliases.toml · skus/kroger.toml · feeds.toml · stores/*.toml`
  and per-user TOML as GitHub-resident — all D1 now.
- ~146,148,164 name `preferences.toml`, `grocery_list.toml`, `stores/*.toml`, `skus/kroger.toml`
  as active state; ~62 calls TOML files "the substrate"; ~142 attributes transient state to "KV".
- `smol-toml` listed in the tech stack (~254) — dropped from the repo.
- `_indexes/` projection prose (~80) — build projects to the D1 `recipes` table now.
- ~203 cross-ref "SELF_HOSTING step 9" should be step 8.
**Fix:** reconcile diagram + prose to the D1 boundary (GitHub = recipe + storage-guidance markdown
only).

### ARC-2 · `docs/SELF_HOSTING.md` dead operator paths  `[x]`
- Step 8 (~152,155) tells operators to hand-edit `discovery_sources.toml` `[[members]]`/`[[senders]]`
  and says mail lands in `discoveries_inbox.toml`. Both moved to D1 (`discovery_senders`/
  `discovery_members`/`discovery_candidates`, migration 0006); use `update_discovery_sources`.
- ~31,40 say CI regenerates `_indexes/recipes.json`; `scripts/build-indexes.mjs` projects into the
  D1 `recipes` table (`_indexes/` survives only for the static site's `components.json`).
**Fix:** rewrite the operator steps to the tool/D1 reality.

---

## Low — cleanup & edge cases

### BLD-1 · Generated skills duplicate every `> For details` pointer  `[x]`
`AGENT_INSTRUCTIONS.md` has a manual pointer line immediately before each `<!-- resource: -->`
block (e.g. `:279` before `:281`), and `scripts/build-plugin.mjs:107` *replaces* each resource
block with the same pointer — so generated `SKILL.md`s show it twice (e.g.
`plugin/.../skills/shop-groceries/SKILL.md:19`).
**Fix (pick one):** remove the manual pointer lines (`AGENT_INSTRUCTIONS.md:279,307,357,409` —
they're redundant even in the source, which inlines the full block), **or** have build-plugin skip
a pointer when the preceding line is identical. Rebuild + diff to confirm.

### BLD-2 · `test:tooling` lists 4 deleted test files  `[x]`
`package.json:26` invokes `tests/cooking-log-backfill.test.mjs`, `profile-d1-backfill.test.mjs`,
`session-state-d1-backfill.test.mjs`, `shared-corpus-d1-backfill.test.mjs` — all deleted with the
retired backfills (#71). `node --test` prints "Could not find" but exits 0, so **CI stays green**;
this is misleading cruft, not a break.
**Fix:** trim the script to the 4 real files (build-indexes/build-site/build-plugin/merge-wrangler-config).

### CODE-1 · Dead exports (zero call sites outside their own file/test)  `[x]`
- `prefixedClient` — `src/github.ts:289` (GitHub-as-data-store relic; only `test/github.test.ts`).
- `readStockup` — `src/profile-db.ts:208` (duplicate of inlined `readStockupItems`).
- `MEAL_PLAN_PATH` — `src/meal-plan.ts:5`.
- `stripCdata` — `src/text.ts:28` (`clean()` strips CDATA inline instead).
- `__resetModuleCache` — `src/kroger.ts:249` (no test uses it, unlike the sibling reset helpers).
**Fix:** delete (and the corresponding `test/github.test.ts` coverage for `prefixedClient`).

### CODE-2 · Vestigial `commit_sha` in `place_order` result  `[x]`
`makeCommitSkuCache` writes the D1 `sku_cache` and returns `null` (`src/order-tools.ts:99-...`),
but the result still carries `sku_cache: { committed, commit_sha?, error? }` (`src/order.ts:173,273`)
and `docs/TOOLS.md:786` documents it. The `commit_sha` is always null; the `committed`/`commitSkuCache`
naming is GitHub-era.
**Fix:** drop the `commit_sha` field (and rename to reflect a D1 upsert) or, minimally, document it
as always-null. Update `docs/TOOLS.md:786,788`.

### CODE-3 · `meal_plan` delete is case-sensitive  `[x]`
`applyMealPlanOps` matches recipe slugs case-insensitively (`src/meal-plan.ts:52` `sameRecipe`),
but `mealPlanDeleteStmt` deletes with exact SQL equality (`src/session-db.ts:217`
`WHERE recipe = ?2`) and the upsert stores the slug verbatim (`:204`). A mixed-case stored row
("Salmon") removed via "salmon" is reported `applied` but left in D1. Slugs are lowercase
kebab-case by convention, so this is legacy/edge risk only.
**Fix:** `WHERE tenant = ?1 AND LOWER(recipe) = LOWER(?2)`, or normalize the slug on write.

### DOC-4 · Misc stale text  `[x]`
- `smol-toml` comments: `wrangler.jsonc:30`, `docs/ARCHITECTURE.md:254`, `CONTRIBUTING.md:80`
  ("survives only in the `.mjs` backfill migrations" — those were deleted in #75).
- `README.md:15,35-36,46` markets "ratings" / "rate the chili 4 stars" — the `rating` column was
  dropped with the status lifecycle (migration 0012).
**Fix:** drop the smol-toml mentions; reword README to favorites/rejections.

### SPEC-4 · `data-indexing` spec superseded but body stale  `[x]`
`openspec/specs/data-indexing/spec.md` carries a SUPERSEDED banner (→ `recipe-index`) but the
requirement bodies still describe writing `_indexes/recipes.json` and `index:recipes` in `DATA_KV`.
Code projects to the D1 `recipes` table. Low harm (flagged), but pending.
**Fix:** rewrite the bodies to point at `recipe-index`, or retire the capability.

---

## Spec reconciliation rollup

Specs to touch (alongside the linked code/doc fix):
- **data-read-tools** ← SPEC-1 (status lifecycle), DOC-3 (profile shape)
- **data-write-tools** ← SPEC-2 (`set_recipe_status`, `commit_sha`)
- **repo-structure** ← SPEC-3 (per-user TOML)
- **data-indexing** ← SPEC-4 (superseded body)
- **kroger-integration / in-store-fulfillment** ← FN-3 (confirm intended `kroger_prices` contract)

---

## Suggested sequencing

1. **FN-1, FN-2, DOC-3** together — real agent-runtime failures; one `AGENT_INSTRUCTIONS.md`
   pass + the profile-shape doc fix + `aubr build:plugin`. Cheapest high-value win.
2. **FN-3** — the only High needing a code change + spec check.
3. **DOC-1, DOC-2, CODE-2** — the TOOLS.md / in-code `commit_sha`+KV sweep (one mental model).
4. **SPEC-1/2/3, SCH-1/2** — D1/status reconciliation across specs + SCHEMAS.md.
5. **ARC-1, ARC-2, DOC-4, SPEC-4** — narrative docs + leftover superseded spec.
6. **BLD-1, BLD-2, CODE-1, CODE-3** — codegen + dead-code + edge fixes (independent, do anytime).

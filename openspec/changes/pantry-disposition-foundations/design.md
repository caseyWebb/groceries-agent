# Design — pantry-disposition-foundations

Grounding set: product-specs pages/06 §2–3, stories/03 §2, DECISIONS.md D15/D17 (+D5, D21,
D25); shipped contracts in `openspec/specs/{data-write-tools,data-read-tools,member-app-offline,ingredient-normalization}`;
`docs/SCHEMAS.md` pantry, `docs/TOOLS.md` pantry tools; `packages/worker/src/{pantry-write,session-db,write-tools,tools,api/pantry,grocery-pantry-reconcile,corpus-db,ai}.ts`;
`migrations/d1/0005_session_state.sql`, `0007_pantry_notes.sql`, `0033_ingredient_identity.sql`,
`0045_display_names.sql`; and the production spike in §8. DECISIONS.md wins over page/story
text where they diverge (one divergence exists — D5 below).

## D1. Vocabularies (all snake_case, matching the repo's data-enum idiom — `in_cart`, `ad_hoc`)

- **Locations** (page 06, THE kitchen location vocabulary product-wide):
  `fridge | freezer | pantry | spice_rack | counter | cabinet`.
- **Categories** (page 06 food taxonomy — also the D17 analytics dimension source):
  `produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices |
  baking | frozen | snacks | beverages` (14 values).
- **Departments** (the D17 analytics dimension, stamped on events): the 14 categories ∪
  `household` ∪ `leftovers`. Waste events stamp the categories, `leftovers`
  (`prepared_from` rows), or `household` (non-food catch-all via the identity memo — pantry is
  food by construction, so this is rare, e.g. production's one `kitchen supply` row);
  `household` as a *grocery-line* override (`kind: household`) is the sibling spend change's
  concern. The cost-per-meal exclusion {household, beverages} (D17) is band 4's read rule.
- **Waste reasons** (ONE canonical enum — stories/03 §2's suggested set, exactly, slugged):
  `spoiled | moldy | over_ripe | expired | freezer_burned | stale | forgot | bought_too_much |
  never_opened | other`. Ten values — small enough for a single-tap list, and each is
  classifiable by band 4's versioned reason(+item-class)→avoidability table:
  `forgot`/`bought_too_much`/`never_opened`/`freezer_burned`/`stale` lean avoidable;
  `spoiled`/`moldy`/`over_ripe`/`expired` are item-class-dependent; `other` is the honest
  residual. The mock's 12-reason analytics list is a painted door (D5) — capture defines the
  enum, analytics consumes it.
- Home: new `packages/worker/src/department.ts` — exports `PANTRY_LOCATIONS`,
  `PANTRY_CATEGORIES`, `DEPARTMENTS`, `WASTE_REASONS`, `LEGACY_CATEGORY_TO_LOCATION`
  (`pantry→pantry, fridge→fridge, freezer→freezer, spices→spice_rack`), and the capture-time
  `stampDepartment` helper (D5 precedence). Worker-only for now; band 2 lifts the vocab arrays
  into `@yamp/contract` when the member app needs the dropdowns (a one-line move; deliberately
  not done speculatively). The sibling `spend-capture-on-order-commit` imports from here.

## D2. Migration — one file, additive schema + one-time legacy remap

New `migrations/d1/NNNN_pantry_location_disposition.sql` (next free number at implementation
time — `0049` as of planning; note migrations sort by filename and production has already
applied through `0048_substitution_edges.sql`):

1. `ALTER TABLE pantry ADD COLUMN location TEXT;` +
   `CREATE INDEX idx_pantry_location ON pantry(tenant, location);` (mirrors
   `idx_pantry_category`, backs the read filter).
2. `CREATE TABLE waste_events (…)` per D4 + its index.
3. `ALTER TABLE ingredient_identity ADD COLUMN category TEXT;` (the D6 memo — additive,
   nullable, no backfill in-migration; the cron fills it).
4. **Legacy remap**, in this order (location computed BEFORE category is rewritten), all
   matching on `LOWER(TRIM(category))`:
   - location: `pantry→pantry`, `fridge→fridge`, `freezer→freezer`,
     `spice`/`spices`/`spice blend`→`spice_rack`.
   - category: `spice`/`spices`/`spice blend`→`spices`, `condiment→condiments`,
     `baking→baking`, `canned goods→canned`, `dairy→dairy`, `produce→produce`,
     `grain→grains`, `pasta→grains`, `meat→meat`, `bread→bakery`; **everything else → NULL**.

The remap extends pages/06 q4's decided mapping (written before the spike) with the exact
food-flavored values production actually holds — dropping a member-asserted `condiment` to
NULL for an LLM to re-derive would discard signal for no reason. Values outside the map
(production: `legume` 5, `dried fruit` 4, `dried goods` 3, `fermented` 2, `nut` 1,
`kitchen supply` 1, `broth` 1) are deliberately dropped to NULL — weak free text, superseded by
the identity-keyed derivation (q4's decided posture); the pre-migration distribution is
archived in §8 so nothing is lost to history. The remap is deployment-generic: any
self-hoster's unmapped free text lands in the same NULL→cron-convergence path.

## D3. The disposition contract (`update_pantry` + `POST /api/pantry/ops`)

New op, alongside the unchanged `add`/`remove`/`verify`:

```
{ op: "dispose", name, disposition: "used" | "waste",
  reason?, event_id?, occurred_at? }
```

- **`dispose` removes the row.** `disposition: "used"` = consumed — pure removal, no event
  (pages/06 q2 resolved: no consumption signal in this band; the `disposition` enum leaves the
  seam). `disposition: "waste"` = removal + one `waste_events` row.
- **`reason`** required iff `waste`, one of the D1 enum; missing/unknown reason, missing
  `disposition`, malformed `event_id`, or malformed `occurred_at` are `validation_failed`
  (whole-call, matching the `/api` area's shape-validation posture). Semantic misses (no such
  row) are per-op **conflicts**, matching `remove`.
- **`event_id`** (waste only): the client-minted idempotency key — the member app mints a ULID
  at tap time (D15). Validated as 1–64 chars of `[A-Za-z0-9_-]`. When absent (the agent/MCP
  path — online by construction, no replay), the Worker mints one. Replay convergence: a
  `dispose` whose `event_id` already exists in `waste_events` reports `applied` and writes
  nothing (row already gone, event already recorded) — never a conflict, never a duplicate.
- **`occurred_at`** (waste only): ISO `YYYY-MM-DD`, the day the toss happened — stamped by the
  client at tap time so an offline toss replayed days later records the right day; defaults to
  the server's today. Format-validated only.
- **Value is NEVER asked.** The op accepts no value/price/cost field; the tool description
  carries the negative guarantee ("never prompt the member for what it cost — value is derived
  later from spend history"). Tool-description-owned per Appendix C's ownership test.
- **Atomicity:** the row DELETE and the event INSERT ride the same D1 batch
  (`applyPantryRowOps` already batches all statements). The event INSERT is
  `INSERT … ON CONFLICT(tenant, id) DO NOTHING`.
- **Plain `remove` stays** and records nothing — corrections, dedup cleanup, the verification
  section's stale-row trash (pages/06: "verification cleanup, not waste"). The *member app*
  losing the bare trash on regular rows is band-2 UI; the tool keeps `remove` because the
  agent legitimately needs non-telemetry removal (mistake fixing).
- **A dispose of an untracked item is a conflict** (row not found, unless the event id already
  exists). Rationale: the event's `item_id`/`department`/`prepared_from`/`quantity` snapshot
  the ROW's stored identity; the member app only offers dispose on rendered rows; the agent
  resolves the conflict conversationally. A rowless waste capture can be added later if real
  usage demands it — recorded as deliberately out of scope.

Result shape: `{ applied, conflicts }` gains an optional `warnings` array (D7's
accepted-and-dropped category). `applied` entries for dispose carry
`{ op: "dispose", name, disposition }`.

## D4. `waste_events` schema

```sql
CREATE TABLE waste_events (
  tenant        TEXT NOT NULL,
  id            TEXT NOT NULL,   -- client-minted event id (ULID); server-minted when omitted
  name          TEXT NOT NULL,   -- the row's display label at capture
  item_id       TEXT NOT NULL,   -- canonical ingredient id (the row's stored normalized_name)
  prepared_from TEXT,            -- recipe slug snapshot when the tossed row was a leftover
  quantity      TEXT,            -- the row's loose quantity at capture
  department    TEXT,            -- D17 stamp; NULL ONLY while pending classification (D5)
  reason        TEXT NOT NULL,   -- the canonical enum (D1)
  occurred_at   TEXT NOT NULL,   -- ISO date the toss happened
  created_at    TEXT NOT NULL,   -- ISO timestamp recorded
  PRIMARY KEY (tenant, id)
);
CREATE INDEX idx_waste_events_when ON waste_events(tenant, occurred_at);
```

- PK includes `tenant` so a client-minted id can never collide with (or squat on) another
  tenant's event — the standard per-tenant isolation column, D15's key scoped safely.
- No `value` column: band 4 owns value resolution (last-paid memo → sku-cache estimate,
  per-household, D2 memoization boundary) and decides then whether to snapshot a column or
  derive at read — nothing here forecloses either.
- `tenant` is today's tenant id; under D1/D10 (band 5) the column reads as the household —
  waste is household-scoped behavioral data, per stories/03 ("household scope").
- Events are append-only from the write path; the ONLY subsequent mutation is the D5
  pending-department fill (NULL → value, once, by the cron). No delete/edit surface in this
  band (a mistaken toss costs one noise event; band 4 can add voiding if analytics needs it).
- Writes go through `src/db.ts` helpers inside the shared session-db op — tools stay
  throw-free with structured `storage_error` mapping, per the repo rule.

## D5. Department stamping — capture-time precedence, pending convergence, immutability

Capture-time stamp (in `stampDepartment`, applied inside the shared dispose op):

1. `prepared_from IS NOT NULL` → `leftovers` (D17; waste-only pseudo-department).
2. else the row's `category` when it is in the 14-value vocab (post-migration it always is, or
   NULL) — the user-visible, possibly user-corrected capture-time truth (the same field
   pantry-add autofill fills, so member correction wins over derivation, D17's override
   spirit).
3. else the identity memo: `resolve(name)` → representative-resolved `ingredient_identity.category`.
4. else **NULL = pending**: the `ingredient-category` pass stamps it as soon as the identity
   classifies (typically the next hourly tick). The fill is NULL→value only; a stamped
   department is NEVER rewritten (vocab evolution never rewrites history — D17). This is the
   one deliberate refinement of D17's "stamped immutably at capture": a capture that races the
   classifier records `pending` rather than a guess, and converges through the pipeline —
   "Not mapped" still never *reaches analytics* because band 4 reads stamped values and the
   backlog drains to zero (§8: the whole registry classifies in ~a day; per-item, the memo is
   warm for anything that has sat in the pantry more than one tick).

Note: stories/03 §2 says Leftovers is "a read-time derivation over `prepared_from`"; D17 says
departments are stamped at capture, never derived at read time, and enumerates
`prepared_from → Leftovers` as a capture-time override. **DECISIONS.md wins**: stamped at
capture (the event still carries `prepared_from`, so nothing is lost).

## D6. The identity category memo + the `ingredient-category` scheduled pass

- **Memo:** `ingredient_identity.category TEXT` — one of the 14 food categories or
  `household` (the non-food catch-all so classification always terminates and "Not mapped"
  can never surface; D17 maps non-grocery to Household). NULL = not yet classified. Cron-owned
  (like `embedding`); survivors only (representative-resolved on read). Identity-keyed,
  source-derived (a food's category is a property of the food, not of tenant behavior) — so
  the memo is shared cross-tenant per D2's memoization boundary. Corrections, if ever needed,
  ship as reclassify migrations (the `0042_component_course_reclassify` precedent).
- **New job** `ingredient-category` (`packages/worker/src/ingredient-category.ts`, the
  `runXJob`/`buildXDeps` idiom), three bounded, idempotent phases per tick:
  1. **Classify**: batch-prompt up to ~2×40 unclassified concrete survivors
     (`representative IS NULL AND category IS NULL`) through the `runAi` gateway
     (`@cf/mistralai/…`, the registry's model) — a new `AiActivity` `"ingredient-category"`
     added to the `src/ai.ts` taxonomy (+ SCHEMAS.md's activity list). Prompt: pick exactly one
     of the 14 categories or `household` for each id (+`display_name` when present); parse
     strictly; unparseable/off-vocab answers leave NULL for retry (transient-failure posture
     mirrors the normalize job).
  2. **Pantry backfill**: fill `pantry.category` where NULL from the memo via
     `normalized_name` (alias→identity→representative), writing only 14-vocab values (a
     `household`-classified identity leaves the pantry row NULL — the pantry category is the
     food vocab). NEVER overwrites a non-NULL category (page 06 q4: readers treat NULL as
     uncategorized, never an error; user-set values are pinned).
  3. **Event stamp**: fill `waste_events.department` where NULL from the memo via `item_id`
     (any memo value, including `household`). NULL→value only (D5).
- Self-terminating: phase 1's backlog (798 concrete survivors in production, §8) drains in
  ~10–13 hourly ticks; thereafter every phase is a cheap no-op scan. Novel identities minted
  later by the normalize job are picked up on the following tick — deliberately NOT bolted
  onto the novel-term classify call, so ONE owner/prompt/parse path serves initial backfill
  and steady state alike (the extra cost is one tick of `pending` on a brand-new ingredient).
- Wiring: phase-1 `Promise.allSettled` group in `scheduled()` (independent of the recipe
  pipeline, internal `env.AI`/D1 budget, like `runNormalizeJob`). Writes `job_health` +
  `job_runs` under `ingredient-category`; the admin jobs surface reads `job_health`
  generically (`src/health.ts` selects all rows), so it appears with no admin-panel change.

## D7. Write/read validation posture and the D21 compatibility window

The pantry item object is an open record today (that is how 22 free-text categories got in).
Field validation lands in the shared apply path (`applyPantryOperations` semantics +
`applyPantryRowOps`), so the MCP tool and `/api` converge:

- **`location`** (new field, no legacy writers): off-vocab → per-op **conflict**, never a
  silent write (the `update_kitchen` off-vocab posture).
- **`category`**: a 14-vocab value → stored. A LEGACY documented value
  (`pantry|fridge|freezer|spices`) → **transposed onto `location`** (category left absent) —
  stale agents on the cached plugin keep working and their intent is preserved; one
  deprecation window per D21, then transposition drops to the generic off-vocab path. Any
  other value (the shipped app's free-text `"other"` default included) →
  **accepted-and-dropped**: the op applies, `category` is stored NULL, and a
  `warnings: [{ op, name, field: "category", reason }]` entry reports it (D21's
  accepted-and-dropped idiom — never `validation_failed`, so no stale writer breaks; the cron
  fills the NULL).
- **`read_pantry`**: gains a `location` filter (exact vocab value); `category` filters on the
  14-value vocab; a legacy location-flavored `category` value is **mapped onto the location
  filter** for the same deprecation window (`category: "freezer"` behaves as
  `location: "freezer"`), keeping cached-skill reads working. Items now include `location`.
  `stale_only` stays a structured `unsupported` error (unchanged rationale). The pantry app
  read (`GET /api/pantry`) gains the same `location` query filter.
- The re-key reconcile (`grocery-pantry-reconcile.ts`) carries `location` through its
  SELECT/merge/upsert (first non-NULL wins, like `category`) so a re-keyed row never loses its
  location. (Observed while grounding: that path drops `display_name` today — same-shape fix
  alongside, one line each in the row type, SELECT, mapper, and merge.)

## D8. Offline classification (member-app-offline delta)

- **Pantry dispose is class (b)**: an idempotent, canonical-key-mutating op whose idempotency
  key is the client-minted `event_id` (waste) — the app mints a ULID and stamps `occurred_at`
  at tap time, queues offline, replays serially on reconnect; replay converges by D3's
  already-recorded rule. `used` dispose replays as an idempotent delete (absent-row replay is
  a 200-with-conflict, exactly like today's `remove` — transport-level convergence).
- **`location`/`category` on add/upsert** ride the ALREADY-registered class (b) "pantry ops"
  row — fields on the same canonical-id-keyed upsert, no new registration.
- Nothing else new: no class (a) editor, no online-only surface, no new persisted query
  prefix (the pantry read is already allowlisted). The registry *code*
  (`packages/app/src/lib/mutations.ts` entry) ships with band 2's `pantry-page` alongside the
  UI; this change registers the CLASS in the spec so that change cannot re-litigate it, and
  ships the server side ready.

## D9. Deliberately out of scope (with owners)

| Concern | Owner |
|---|---|
| Pantry page UI (location group-by, multi-add, autofill, waste modal, split button) | band 2 `pantry-page` (design-requests; D5 painted-door) |
| `/api` mutation-registry client code for dispose | band 2 `pantry-page` |
| Spend events, send records, budget pref | band-1 sibling `spend-capture-on-order-commit` (consumes `src/department.ts`) |
| Waste $ value, avoidability table, Leftovers analytics read | band 4 `waste-analyzer` |
| "Used" consumption signal | deferred (pages/06 q2); `disposition` enum is the seam |
| Persona put-away/waste choreography | band 3 (Appendix C) |
| Vocab arrays in `@yamp/contract` for app dropdowns | band 2 (one-line lift) |

## §8. Production spike findings and acceptance fixtures (2026-07-10)

Read-only spike against production D1 (`grocery-mcp`, uuid `72599f36-…`, via
`wrangler d1 execute grocery-mcp --remote`; the repo's `wrangler.jsonc` binds the NAME `yamp`
— the deploy's config merge supplies the real database, so spikes address it by its actual
name). Production had applied through `0048_substitution_edges.sql` at spike time (5 commits
ahead of the original worktree base — the plan is grounded on `origin/main` @ `357297b`).

**Observed shapes:**

- `pantry` DDL: the 0005 table + `notes` (0007) + `display_name` (0045) — confirming the new
  columns land via `ALTER TABLE` on this exact shape.
- 336 rows, 2 tenants (casey 225, everett 111); **0 NULL categories; 0 `prepared_from` rows**
  (the Leftovers path has no production fixture — unit-fixture coverage only, noted).
- 22 distinct `category` values (full distribution, the remap's ground truth):

| legacy value | rows | → location | → category |
|---|---|---|---|
| pantry | 74 | pantry | NULL |
| spice | 45 | spice_rack | spices |
| freezer | 37 | freezer | NULL |
| fridge | 32 | fridge | NULL |
| spices | 27 | spice_rack | spices |
| condiment | 27 | NULL | condiments |
| baking | 25 | NULL | baking |
| canned goods | 13 | NULL | canned |
| spice blend | 12 | spice_rack | spices |
| dairy | 9 | NULL | dairy |
| produce | 6 | NULL | produce |
| legume | 5 | NULL | NULL |
| grain | 5 | NULL | grains |
| pasta | 4 | NULL | grains |
| dried fruit | 4 | NULL | NULL |
| dried goods | 3 | NULL | NULL |
| meat | 2 | NULL | meat |
| fermented | 2 | NULL | NULL |
| nut | 1 | NULL | NULL |
| kitchen supply | 1 | NULL | NULL |
| broth | 1 | NULL | NULL |
| bread | 1 | NULL | bakery |

- Identity registry: 869 identities, 857 survivors, **798 concrete survivors** (phase-1
  backlog); **336/336 pantry rows resolve** in the registry (id or alias) — the memo path
  covers the entire production pantry.

**Named acceptance fixtures** (verified against production after deploy, read-only):

- **F1 — remap totals**: `location` counts = pantry 74, freezer 37, fridge 32, spice_rack 84,
  NULL 109; `category` counts = spices 84, condiments 27, baking 25, canned 13, dairy 9,
  produce 6, grains 9, meat 2, bakery 1 (176 mapped), NULL 160. Zero rows retain a legacy
  value (`SELECT COUNT(*) FROM pantry WHERE category NOT IN (<14-vocab>) AND category IS NOT NULL` = 0).
- **F2 — convergence**: the 160 NULL categories monotonically decrease across cron ticks
  (`ingredient-category` `job_runs` show classify/backfill counts; steady state = 0 pending
  pantry rows whose identity classified to a food category).
- **F3 — memo drain**: `ingredient_identity` rows with `representative IS NULL AND concrete=1
  AND category IS NULL` drain from 798 toward 0; the job self-terminates (later `job_runs`
  report zero work).
- **F4 — first real dispositions**: the first member waste events carry a non-NULL
  `department`, a ULID-shaped id, and the chosen reason; a deliberately-replayed dispose
  (same `event_id`) leaves exactly one row. (No pre-existing rows to fixture — the table is
  born empty; F4 is the post-deploy behavioral check.)

**What failed during the spike:** nothing, after two environment detours worth recording —
the checked-in binding name `yamp` does not exist remotely (use `grocery-mcp`), and the
worktree's `~/.local/bin` shims pointed at another session's worktree (bypassed by invoking
the npx-cached wrangler through `mise exec node --`).

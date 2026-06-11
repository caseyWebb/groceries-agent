## Why

Produce goes bad in the fridge because people store it wrong, and the agent — which talks to the member exactly when they're putting groceries away — says nothing useful about it. The original Change 12 tried to solve waste with an `ingredients.toml` shelf-life table feeding a freshness *hint*, but that artifact encoded **facts the LLM already has** (basil lasts a week; olive oil doesn't spoil) and Change 08 already accepted run-to-run non-determinism as the right failure mode for soft freshness nudges — so the table's only real offer, consistency, is something we explicitly don't need. What the model *lacks* is not shelf-life facts but a **curated, trusted set of opinionated storage tips** to give consistently instead of improvising. This change supplies that, surfaced at put-away.

## What Changes

- **Add a `storage_guidance/` content tree** at the data-repo root — hand-maintained, opinionated curated config keyed by **storage behavior class** (`tender-herbs.md`, `hardy-herbs.md`, `leafy-greens.md`, `alliums.md`, …), with a few **singletons** (`basil.md`, `tomatoes.md`, `avocados.md`) that break their class's rule, and a `_ethylene.md` file for the **relational** "don't store together" rules. Keyed by class, not per-ingredient, so one tip covers a whole family without duplication.
- **Add two read-only tools** — `list_storage_guidance` (returns class slugs + optional one-line descriptions) and `read_storage_guidance(slugs)` (returns the named entries) — following the `list_recipes`/`read_recipe` pattern. The agent maps a just-bought item to a class via its own world knowledge over the semantic filenames; intentionally non-deterministic, no manifest or alias table.
- **No write tool.** `storage_guidance/` is curated config (edit-when-directed), not an agent-mutated side-effect file. The Worker surface for it is purely read-side.
- **Add a put-away behavior rule** (AGENT_INSTRUCTIONS): when new perishables enter the kitchen — on **both** the `received` restock flow (order placement) **and** the farmers-market `update_pantry` haul — surface 2–3 *relevant, non-obvious* tips for what was just bought. Don't nag the same tip every trip. **No matching class file → no tip** (silence over invention); contested tips are pre-hedged in the prose so the agent never asserts folklore as settled fact.
- **BREAKING (internal, pre-data): remove `ingredients.toml` entirely.** It was reserved/empty in v1 and is now cut — drop its reserved block from `docs/SCHEMAS.md` and remove it from the shared-corpus, repo-structure, and data-validation specs. `read_pantry(stale_only)` continues to return a structured `unsupported` error, but the rationale changes: freshness is an LLM-judged, prompt-resolved concern (per Change 08), not something awaiting a shelf-life table that is no longer coming.

## Capabilities

### New Capabilities
- `storage-guidance`: the curated `storage_guidance/` class-keyed content tree, the two read-only tools over it, and the put-away behavior (relevance + don't-nag, no-improvise/no-folklore guarantee, confidence-in-prose).

### Modified Capabilities
- `shared-corpus`: remove `ingredients.toml` from the shared reference data; add the `storage_guidance/` tree as shared, read-by-all-tenants corpus content.
- `repo-structure`: remove the `ingredients.toml` root stub; add `storage_guidance/` to the root layout.
- `data-validation`: remove `ingredients.toml` from the parse-checked file enumeration (the `storage_guidance/*.md` files are prose, validated only for existence like other markdown).
- `data-read-tools`: update the `read_pantry(stale_only)` requirement — it still returns `unsupported`, but the explanation no longer references a forthcoming `ingredients.toml` (freshness stays LLM-judged).

## Impact

- **Data repo:** new `storage_guidance/*.md` tree at root; `ingredients.toml` removed.
- **Worker (`src/`):** two new read tools (`list_storage_guidance`, `read_storage_guidance`); `docs/TOOLS.md` updated; no write path.
- **`docs/SCHEMAS.md`:** add the `storage_guidance/` entry; remove the reserved `ingredients.toml` block. **`CLAUDE.md`:** add `storage_guidance/` to the curated-config list.
- **`AGENT_INSTRUCTIONS.md`:** put-away behavior rule (received + market-haul triggers).
- **Seed material:** `docs/notes/2026-06-11-storage-guidance-research.md` (ATK/Serious-Eats-weighted, contested/solid filter, sourcing caveats) seeds the tree content.
- **Dependencies** (order-placement, git-write-tools/`update_pantry`) are already built and archived — this is applicable now.

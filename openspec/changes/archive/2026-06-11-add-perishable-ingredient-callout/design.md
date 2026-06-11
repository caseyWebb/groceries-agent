## Context

The BUY-moment half of the perishability reframe (2026-06-11 explore). The original Change 12 bundled a menu-gen waste observation with the dead `ingredients.toml` shelf-life table; this change keeps the waste idea, drops the table, and grounds the signal in a new recipe field. The STORE-moment storage guidance is the separate `add-storage-guidance` change. Dependencies (menu-generation, recipe-import, the index/validation pipeline) are built and archived. This change closely mirrors the archived `side-dish-pairings` change, which added the `pairs_with` recipe field the same way (shared-corpus + data-validation + menu-generation deltas).

## Goals / Non-Goals

**Goals:**
- Flag single-use perishables at menu-gen and offer a use-it-up or swap.
- Make cross-recipe perishable overlap **deterministic** via a normalized recipe field.
- Keep the field near-zero maintenance (derived at import + one backfill).
- Produce the callout without any Kroger dependency in v1.

**Non-Goals:**
- Storage advice / put-away tips (separate `add-storage-guidance` change).
- SKU/package-size precision ("1 tbsp of a whole bunch") — optional later layer.
- A deterministic perishable-filter recipe selector / one-recipe-at-a-time planning overhaul — deferred until the corpus outgrows whole-index LLM reasoning.
- A shelf-life table or any `ingredients.toml` revival.
- Hand-curated perishable lists (the field is derived recipe content, not config).

## Decisions

**A dedicated `perishable_ingredients` field, not a reuse of existing ingredient data.** `ingredients_key` is the top 5–7 headline ingredients for filtering — and the waste-prone items are precisely the *minor* ones it omits. The body `## Ingredients` lines are freeform and would re-incur the `aliases.toml` matching tax across recipes. A purpose-built normalized field pins the names once. *Alternative rejected:* derive perishability at menu-gen from parsed body lines — non-deterministic across recipes and pays the matching cost every run.

**Derived at import + one-time backfill, normalized via the verify matcher.** Classification is LLM work done once at import (like protein/cuisine), then cached in frontmatter; the corpus is backfilled by the same classifier. Names reuse `src/pantry-verify.ts` normalization so overlap detection aligns with the rest of the system. *Alternative rejected:* hand-maintained lists — high burden, drifts.

**Classification test is "would the leftover rot," not botany.** Fuzzy edges (eggs, potatoes) are fine because a wrong call only costs a dismissed nudge — the same soft-failure tolerance the project applies to freshness prompts.

**Partial-purchase-unit trigger, resolved by LLM reasoning over the index — no search tool, no Kroger.** The waste case is a recipe using *less than a purchase unit* of a perishable (a partial package, leaving leftover) that no other proposed recipe uses. The partial-unit judgment is the agent's own knowledge of the recipe quantity (from the body) vs. how the item is sold ("cilantro ships as a bunch") — distinct from SKU package-size *precision*, which is deferred. Critically, this needs **no dedicated search/filter tool**: `perishable_ingredients` is already in the recipe index (and `list_recipes` results) as clean normalized names, so the agent reasons over data it already holds. *Why the field still earns its place:* it gives the LLM per-recipe normalized perishables to reason over without re-parsing freeform bodies. *Alternative rejected:* "overlap-of-one within the proposed plan" alone — it over-triggers (flags a recipe that uses a whole unit) and under-uses the index. *Alternative deferred:* a deterministic `random_recipe(excluding_cuisine, excluding_protein, uses_perishable_ingredient: Z, …)` selector — only pays off under a one-recipe-at-a-time planning overhaul, worthwhile only once the corpus outgrows whole-index reasoning (big today, but manageable).

**Layer onto existing capabilities, no new capability.** Mirrors the `pairs_with` precedent: the field is recipe content (shared-corpus), validated (data-validation), populated at import (recipe-import), and consumed at menu-gen (menu-generation). The index carries it via the existing objective-frontmatter passthrough — no `data-indexing` delta.

## Risks / Trade-offs

- **Misclassified perishability** → non-fatal by design (dismissed nudge); correctable by a normal recipe edit.
- **Normalization divergence** → mitigated by reusing the verify matcher's normalization rather than inventing a second scheme; if they ever diverge, overlap detection silently weakens — so they must stay shared.
- **Backfill is an LLM pass over the corpus** → idempotent and content-preserving by requirement; run once, re-runnable safely.
- **Nagging on every menu** → the callout fires only on overlap-of-one and offers an action; if it proves noisy, the threshold/phrasing is an AGENT_INSTRUCTIONS tuning, not a schema change.

## Migration Plan

1. Add `perishable_ingredients` to `docs/SCHEMAS.md` (objective shared content; normalized; derived-at-import) and `docs/TOOLS.md` where recipe content is returned.
2. `scripts/build-indexes.mjs`: hard-fail on present-but-non-array; confirm the generic passthrough carries it into `_indexes/recipes.json`; fixture tests.
3. Worker: ensure `create_recipe`/`update_recipe` treat it as objective content (not a subjective/overlay key) and that structural write-time validation accepts it; reuse the verify-matcher normalization for the names.
4. `AGENT_INSTRUCTIONS.md`: at-import classification step + menu-gen overlap-of-one callout; regenerate the plugin.
5. Run the one-time corpus backfill.
6. Rollback: revert the field handling + docs; recipes with the field are harmless if unused (it's optional, warn-free when absent).

## Open Questions

- Backfill execution surface: a guided agent session running the import-time classifier over the corpus vs. a small scripted batch invoking the same classifier — both reuse one classifier; pick at apply time.
- Whether to ever escalate to SKU package-size precision is left for a future change; not scoped here.

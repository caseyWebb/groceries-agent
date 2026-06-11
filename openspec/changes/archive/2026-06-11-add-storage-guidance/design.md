## Context

The original roadmap Change 12 ("Perishability refinement") was to populate an `ingredients.toml` shelf-life table and feed a `past_typical_fresh_life` hint into pantry-verification. Exploring it (2026-06-11) surfaced that the table encodes facts the LLM already has, and that Change 08 already settled freshness as an LLM-judged, prompt-resolved concern with accepted run-to-run non-determinism. The real unmet need is **opinionated, vetted storage advice** given consistently at the moment groceries are put away — guidance the model lacks, not facts it has. This change replaces the shelf-life table with a curated `storage_guidance/` tree. Its dependencies (order-placement's `received` flow, `update_pantry`) are already built and archived. The BUY-moment waste callout (`perishable_ingredients` at menu-gen) is deliberately a **separate** change (`add-perishable-ingredient-callout`).

Seed material lives at `docs/notes/2026-06-11-storage-guidance-research.md` (ATK/Serious-Eats-weighted, with a contested/solid filter and sourcing caveats).

## Goals / Non-Goals

**Goals:**
- Surface 2–3 relevant, trusted, non-obvious storage tips at put-away (order receipt **and** market haul).
- Keep the guidance curated and consistent — no improvised or folklore-as-fact advice.
- Model guidance by storage **class** so one entry serves a whole family without duplication.
- Remove `ingredients.toml` and its reserved schema block cleanly.

**Non-Goals:**
- Computing or gating "staleness" in any tool (`read_pantry(stale_only)` stays `unsupported`).
- Tracking which tips a member has already seen (mild repetition is accepted).
- The menu-gen waste callout / `perishable_ingredients` field (separate change).
- An ingredient→class manifest or alias table (the mapping is intentionally LLM-judged).
- A write/edit tool for the guidance (it is hand-maintained curated config).

## Decisions

**Curated prose tree over a shelf-life table.** The artifact must encode opinions the model lacks, not facts it has. `storage_guidance/` is curated config in the same family as `diet_principles` / `flyer_terms.toml`. *Alternative rejected:* `ingredients.toml` shelf-life table — redundant with model knowledge; consistency benefit not needed for soft nudges.

**Key by storage class, not ingredient.** Files are `tender-herbs.md`, `alliums.md`, etc., with a few singletons (`basil.md`, `tomatoes.md`, `avocados.md`) for items that break their class's rule, and `_ethylene.md` for pairwise "don't store together" rules. *Alternative rejected:* one file per ingredient — duplicates identical guidance across a dozen files and rots out of sync.

**Mapping by world knowledge, not a manifest.** The agent lists the semantic slugs and picks the right file(s) from its own knowledge that, e.g., cilantro is a tender herb. This is intentionally non-deterministic and consistent with the Change 08 ethos; over-fetching a file is harmless. *Alternative rejected:* an ingredient→class lookup table — re-introduces the `aliases.toml` matching tax for no benefit.

**Read-only tool surface.** `list_storage_guidance` + `read_storage_guidance(slugs)`, mirroring `list_recipes`/`read_recipe`. No write tool — the guidance is edit-when-directed config, tended by hand, never an agent side-effect. This is also what distinguishes it from `perishable_ingredients` (agent-derived recipe content).

**Confidence-in-prose.** Solid tips are written plainly; contested ones are pre-hedged in the file text itself ("some cooks rinse berries in vinegar — results vary"), so faithful relaying is honest relaying. Combined with "no matching file → no tip," this preserves the curation guarantee: the agent only ever gives vetted advice.

**Triggers: received AND market haul.** Put-away is "new perishables entering the kitchen," which includes both the order `received` restock and a farmers-market `update_pantry` add — not only the order path.

## Risks / Trade-offs

- **Non-deterministic tip selection** → accepted by design; worst case is an unnecessary tip or a missed one, the right failure mode for a soft nudge (mirrors Change 08).
- **Curated content can go stale or be wrong** → mitigated by the contested/solid filter in the seed note, ATK-verbatim sourcing where possible, and the SE/second-hand caveat flagged for re-check before the file claims authority.
- **Nagging the same tip repeatedly** → mitigated by the agent judging relevance/obviousness; explicitly not solved with seen-tip state (over-engineering for the benefit).
- **Mapping misses an item with no class file** → by design the agent stays silent rather than improvising; coverage grows by hand-editing the tree.

## Migration Plan

1. Remove the reserved `ingredients.toml` block from `docs/SCHEMAS.md`; add the `storage_guidance/` entry; add `storage_guidance/` to `CLAUDE.md`'s curated-config list.
2. Seed `storage_guidance/*.md` from the research note, curated to the opinionated head, contested tips pre-hedged. (Content lands in the data repo; the code repo carries the tools + docs.)
3. Implement `list_storage_guidance` / `read_storage_guidance` in the Worker; update `docs/TOOLS.md`.
4. Add the put-away behavior rule to `AGENT_INSTRUCTIONS.md`.
5. No data migration needed — `ingredients.toml` was empty in v1. Rollback is reverting the tools + docs; the guidance tree is inert if unread.

## Open Questions

- Final file granularity (exact class list and which items become singletons) is a curation call made while seeding from the research note — not fixed here.
- Whether `list_storage_guidance` descriptions are sourced from per-file frontmatter or derived from the slug — a minor implementation choice for the build/read tool.

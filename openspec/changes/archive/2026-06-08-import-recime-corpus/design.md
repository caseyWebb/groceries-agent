## Context

`recipes/` is empty; the agent needs a seed cookbook. Casey's 63-recipe library lives in `recime-export.html` (234 KB, 80 cards across 9 cookbook sections). The export is HTML produced by the [ReciMe Recipe Exporter](https://chromewebstore.google.com/detail/recime-recipe-exporter/nbmmcjlploegpicloeoknlgdblcbmoga) Chrome extension. Each card carries: an `<h3>` title, a meta line (`Servings | Prep | Cook`), an ingredients `<ul>`, and an instructions `<ol>`. It carries **no source URLs** and none of the schema's judgment fields.

Investigation of the export established the constraints this design must handle:
- **80 cards → 63 real recipes.** One card ("All Your Recipes, In One Place - ReciMe") is the exporter's landing card with 0 ingredients / 0 steps. The other 16 collapses are duplicates.
- **16 duplicate slugs are signal.** 15 are the same recipe filed in two cookbooks (e.g. `crispy-baked-pasta` in `pastas` + `comfort-foods`); merging their cookbook tags is desirable. 1 is a true accidental double in `uncategorized`.
- **Near-dups that are NOT dups.** Two distinct `Pasta e Fagioli` (10 ing/4 steps vs 17 ing/9 steps); stovetop `Butter Chicken` vs `Better Pressure Cooker Butter Chicken`. Exact-slug dedup keeps these separate.
- **Validator contract** (`scripts/build-indexes.mjs`): hard-fails only on unparseable frontmatter/TOML, bad `status` enum, duplicate slug, or unresolved component reference; warns on missing `protein` / `time_total` / `ingredients_key`.

## Goals / Non-Goals

**Goals:**
- Get all 63 recipes into conformant `recipes/*.md` with `status: active`.
- Preserve cookbook membership as merged `tags` (excluding the meaningless `uncategorized` section).
- Clean, human-readable titles and plain, globally-unique slugs.
- A re-runnable importer that never clobbers enrichment (refuse-overwrite).
- Fill judgment frontmatter and recover sources where confidently matched.
- Pass `build-indexes.mjs --check` with zero warnings by the end.

**Non-Goals:**
- Changing any validation rule, MCP tool, or Worker behavior.
- Wiring the importer into an agent flow (it is a kept one-shot tool).
- Auto-merging near-duplicate recipes (surface for human review instead).
- Inventing data the export and the web don't confidently support (no guessed source URLs).

## Decisions

**Decision: Four passes (extract → name → beautify → reconcile), not two.**
The original framing was extract + beautify. Grounding in the real titles showed slug naming can't be deterministic for ~8–10 editorial/foreign-gloss titles ("This Spin on Mississippi Pot Roast…"), and slugs are the file identity — they must be globally unique and consistent, which a per-batch beautify agent (seeing only its own 8) cannot guarantee. So naming is pulled into its own whole-corpus pass *before* enrichment, and component wiring (the only cross-recipe frontmatter) is pushed to a final reconcile pass that runs *after* slugs are stable — avoiding rename churn against live `uses_components` references.

```
1. EXTRACT (deterministic script)  → raw-but-safe slugs, content, merged tags, status:active
2. NAME (1 agent, all 63)          → clean unique slug map → rename files
3. BEAUTIFY (~8 agents × ~8)       → judgment fields, ingredients_key, body, source recovery
4. RECONCILE (1 agent, all 63)     → components, near-dup review, validate to 0 warnings
```

**Decision: Node importer using the repo's existing `gray-matter` / `js-yaml`.**
Alternatives: a Python script (also available) or hand-writing YAML strings. Using the same `gray-matter` the validator reads guarantees the emitted frontmatter round-trips byte-identically and avoids YAML-quoting drift. Lives at `scripts/import-recime.mjs`, kept but unwired, with a header comment naming the exporter extension.

**Decision: Importer refuses to overwrite.**
The script is kept ("may come in handy"), but a naive re-run would rewrite all 63 files from the HTML and wipe every judgment field, recovered source, and body edit. To make re-runs safe, the importer skips (or fails loudly on) any target file that already exists. New cards in a future export still import; enriched files are never touched.

**Decision: `status: active`, not `draft`.**
`draft` semantically means unvetted discoveries that menu generation de-prioritizes. These are Casey's real, already-cooked library — de-prioritizing them would defeat the import. `rating` stays null (unrated in our system, not unwanted).

**Decision: Source recovery requires content match, not title match.**
A title search on "Butter Chicken Recipe" returns many confident-looking URLs. The beautify agent writes `source` only when the candidate page's ingredient list and steps line up with the extracted content; otherwise `source: null`. This is the line between "confident" and "found something."

**Decision: Batch beautify ~8 recipes/agent.**
One agent per recipe (63 agents) reloads `taste.md` / `SCHEMAS.md` context 63 times for no benefit. Batching to ~8 amortizes context while keeping each agent's working set small.

## Risks / Trade-offs

- **Slug naming agent picks an awkward or wrong dish name** → the rename map is surfaced for Casey to approve/tweak before files are renamed; renames happen before component wiring so nothing downstream breaks.
- **Source recovery hallucinates a plausible-but-wrong URL** → content-match gate (ingredients + steps), default to null on any doubt.
- **A true near-dup pair is actually one recipe** → reconcile pass reports pairs for human decision rather than guessing; keeping both is the safe default (no data loss).
- **HTML parsing edge cases (entities, nested lists, missing prep)** → extraction handles entity decoding and null prep explicitly; `--check` after extract catches structural misses before enrichment begins.
- **Importer drift if ReciMe changes its export format** → script is one-shot and version-pinned to this export; not part of any runtime path, so drift has no production impact.

## Migration Plan

1. Run the extractor; verify 63 files and a clean `--check` (warnings only).
2. Run the naming pass; review the slug rename map; apply renames.
3. Run beautify batches; spot-check a sample for field accuracy and source correctness.
4. Run reconcile; confirm `--check` reports 0 warnings; review the near-dup report.
5. Commit corpus + script + regenerated indexes in one batched commit.

Rollback is trivial: the entire change is additive to a previously-empty `recipes/`, so reverting the commit restores the empty state.

## Open Questions

- None blocking. Near-duplicate disposition (merge vs keep-both) is deferred to Casey during the reconcile review rather than decided up front.

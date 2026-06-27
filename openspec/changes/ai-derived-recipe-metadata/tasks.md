# Tasks

> Ordering note: groups 1–3 are additive (the description is generated and stored
> alongside the still-authored frontmatter field, dual-read). Group 4 (drop it from the
> contract + write tools) is **after** the corpus is backfilled, so reads never regress.

## 1. Derived storage + generation
- [ ] 1.1 Migration: co-locate the derived description with the embedding — add `description` + `content_hash` to the embedding table (rename `recipe_embeddings` → `recipe_derived`) or add a sibling `recipe_descriptions(slug, description, content_hash)`. Keep it reconcile-owned; the build never writes it.
- [ ] 1.2 Add an `env.AI` text-generation helper beside `src/embedding.ts` (instruct/chat call; model id from config). Return a trimmed ~60-token description from a recipe's human-authored content.
- [ ] 1.3 Define `content_hash` over the **human-authored input only** (body + authored frontmatter the description derives from; exclude all derived fields). Unit-test that a derived-field write does not flip the hash.

## 2. Reconcile pass
- [ ] 2.1 Extend the scheduled reconcile (`src/recipe-embeddings.ts` → a `recipe-derived` reconcile): before the embed pass, regenerate descriptions whose `content_hash` is new/changed; bound per tick (reuse `RECONCILE_MAX_PER_TICK`); the regenerated description flows into the existing embed gate.
- [ ] 2.2 Health/summary: extend the `health:job:*` record with description counts (generated/pending); keep it tenant-data-free; rethrow on failure (unchanged cron-status posture).
- [ ] 2.3 Unit-test the pass with injected deps (in-memory fakes), mirroring the existing reconcile tests: generate-on-content-change, no-op on steady corpus, partial-tick resumes.

## 3. Read merge + provisional seed
- [ ] 3.1 `read_recipe` (and any recipe read that returns a description) merges the D1 description; an absent description reads as empty, never an error.
- [ ] 3.2 (Optional, per design Open Question) `create_recipe` seeds a provisional description so a new recipe reads well before the first reconcile tick; the reconcile remains the authority and overwrites on content change.

## 4. Retire the frontmatter field (after backfill)
- [ ] 4.1 `src/recipe-contract.js` + `src/validate.ts`: remove `description` from the required set and the non-empty group (it is no longer a frontmatter field).
- [ ] 4.2 `src/serialize.ts`: stop writing `description` to frontmatter on `create_recipe`/`update_recipe`; reject/ignore a passed description arg per the tool contract.
- [ ] 4.3 `scripts/build-indexes.mjs`: stop projecting `description` from frontmatter into `recipes`; `scripts/build-site.mjs`: read the description from the derived table.
- [ ] 4.4 (Optional, cosmetic) one-time pass stripping the dead `description:` line from existing frontmatter.

## 5. Docs (lockstep)
- [ ] 5.1 `docs/SCHEMAS.md`: move `description` out of the recipe-frontmatter block into the derived-D1 section; document `content_hash` and the `recipe_derived` shape.
- [ ] 5.2 `docs/ARCHITECTURE.md`: record the frontmatter-vs-D1 placement rule and the reconcile's description-then-embed pass.
- [ ] 5.3 `docs/TOOLS.md`: update `create_recipe`/`update_recipe` (no description arg) and `read_recipe` (returns derived description).

## 6. Quality eval
- [ ] 6.1 Held-out eval: compare candidate Workers AI models' descriptions against current human descriptions (a small rubric + spot embedding-recall check). **Start from the spike's conclusion** (design Run 1–3): lead candidate `mistral-small-3.1-24b-instruct`, the anti-cliché + 3-shot prompt, temp ≈ 0.3, with the two guardrails (low-signal → stay general; overloaded → one distinctive trait). **Include deliberately sparse recipes** — that is where the smaller models hallucinate (the 8B invented vegetables under near-zero signal). Pick the model; record the choice. Cheap to re-run on a model upgrade.

## 7. Verify
- [ ] 7.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` green.
- [ ] 7.2 Local: seed a recipe, run the reconcile, confirm the description appears in D1 and `read_recipe`; edit the body, confirm regeneration + re-embed; confirm a derived-field write does not regenerate.
- [ ] 7.3 `openspec validate ai-derived-recipe-metadata --strict` passes.

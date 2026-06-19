## Context

The grocery agent runs in Claude.ai and writes recipe content to a private data repo through the `grocery-mcp` Worker. The write path is:

```
 create_recipe / update_recipe / commit_changes
   → commit engine (src/commit.ts)  →  validateFile() per staged file (src/validate.ts)
   → commit to data repo `main`
   ───────────────────────────────────────── post-push ─────────────────────────────────────────
   → build-indexes.mjs (regen _indexes/, commit back)   and   build-site.mjs (deploy GitHub Pages)
```

`src/validate.ts` deliberately reimplements only a **structural subset** of the full Node validator (`scripts/build-indexes.mjs`) — it can't run the Node corpus validator on workerd, and cross-reference checks (slug resolution) genuinely need the whole corpus. For recipe frontmatter it checks *shape* (`pairs_with` is an array, `course` is string|array, etc.) but **not** the `protein`/`cuisine`/`requires_equipment` vocabularies. Those live only in `build-indexes.mjs`. The data-validation spec encodes the rationale on the `requires_equipment` requirement: *"the makeability gate reads only `_indexes/recipes.json`, which only the build regenerates — so an off-vocabulary slug cannot reach the gate without the build, which fails first."* Call this **D2: the build is the gate for recipe content.**

The incident shows D2's cost. The build *does* fail first — but "first" is post-push, on `main`, downstream of a public Pages deploy and the index regen, and after the agent has already reported success. The gate fails **loud, late, and in the wrong place**: a stale public website, an un-regenerated index (the recipe is invisible to `list_recipes`), and no signal to the only actor that could fix it.

Notably, the same spec already validates `ready_to_eat` and `kitchen` vocab/enums in **both** the Node validator and `src/validate.ts`. `protein`/`cuisine`/`requires_equipment` are the only controlled fields that opted out. This change makes them consistent.

## Goals / Non-Goals

**Goals:**
- An off-vocabulary `protein`/`cuisine`/`requires_equipment` on a recipe write is rejected **at the Worker write boundary**, with a structured `validation_failed` error the agent can act on in the same turn — never reaching `main`.
- The Worker validator and the build validator draw the vocabularies from a **single shared definition**, so they cannot disagree (the disagreement *is* this bug class).
- A no-protein-focus dish writes cleanly (no error) by normalizing `none`/empty `protein`/`cuisine` to **absent**.
- The agent is shown the controlled sets where it chooses values (tool descriptions + `AGENT_INSTRUCTIONS.md`).

**Non-Goals:**
- Widening the vocabularies to admit `shrimp`/`none`. The buckets are deliberately coarse (`fish` not `salmon`) so variety reasoning stays reliable — `shrimp` → `shellfish`, no-protein → omit.
- Retroactively fixing existing off-vocab corpus data (handled by the companion data-repo fix; this change prevents recurrence).
- Cross-reference validation in the Worker (slug resolution for `pairs_with` / `cooking_log` stays the build's job — it needs the whole corpus).
- Re-routing recipe writes through a PR/branch gate (the agent commits autonomously on behalf of a non-technical member; that's the design).

## Decisions

### Single shared vocabulary module (eliminate drift structurally), not a parity test

Extract `PROTEIN_VOCAB`, `CUISINE_VOCAB`, and `EQUIPMENT_VOCAB` into one module both validators import. `src/validate.ts` imports it directly; `scripts/build-indexes.mjs` imports it instead of defining its own copies; `src/kitchen.ts` re-exports `EQUIPMENT_VOCAB` from it (removing today's mirror). A single definition means the Worker and the build **cannot** drift — strictly better than mirroring plus a test that detects drift after the fact.

Mechanics: the module must be importable by both a plain Node ESM script (`build-indexes.mjs`, run un-compiled) and the TypeScript Worker (bundled by wrangler/esbuild for workerd). The simplest shape that satisfies both is a **plain-JS ESM module** (e.g. `src/vocab.js`) exporting frozen arrays/sets; `build-indexes.mjs` imports it by relative path, and the TS sources import it (TS allows importing `.js`). No build step is introduced for the Node script.

**Alternative considered — keep the mirror, add a parity test** that asserts the `src/` sets equal the `build-indexes.mjs` sets. Rejected as the primary approach: it still permits a window where the two disagree (until CI runs) and adds a test to maintain. Acceptable only as a fallback if a shared import proves impractical for the bundler — in which case the parity test becomes a required guard.

### Enforce at `validateFile` (the existing chokepoint), not per-tool

`create_recipe`, `update_recipe`, and `commit_changes`' recipe updates all persist through the commit engine, which runs `validateFile(path, content)` on every staged file before committing. Adding the vocab check to `validateFile`'s `recipes/*.md` branch covers all three write paths in one place and guarantees no recipe write bypasses it. The check uses the shared vocab and fails via the existing `fail()` → `ToolError("validation_failed")`, so no commit is made.

### Normalize `none`/empty to absent in the write path (forgive the common mistake)

Two of the three incident failures were `protein: none` — the agent reaching for "this dish has no protein focus," which the vocab has no slot for and the schema expresses as **absence** (warn-only). Rather than reject `none` and force a retry, the recipe write path (`create_recipe` / `buildRecipeUpdate`) strips a `protein`/`cuisine` whose value is the literal `none` or empty string, so the field is simply not written. Off-vocab values that aren't `none` (e.g. `shrimp`) still hard-fail with a corrective error — those are genuine miscategorizations the agent should fix (`shrimp` → `shellfish`), not silently drop.

Scope: `none`-normalization applies to the warn-only variety dimensions (`protein`, `cuisine`). It does **not** apply to `requires_equipment` (an array — an empty array already means "no special equipment"; there's no `none` idiom to normalize).

### Reverse D2 uniformly for recipe content — include `requires_equipment`

`requires_equipment` is the same bug class: `requires_equipment: ["air-fryer"]` would break the build post-push exactly like `protein: shrimp`. Enforcing only `protein`/`cuisine` would just relocate the next incident. So the Worker enforces **all three** recipe controlled vocabularies, and the data-validation spec's `requires_equipment` requirement is updated to drop the "loose array, no Worker enforcement" carve-out. The D2 reasoning is explicitly reversed *for recipe controlled-vocabulary fields* and recorded here; cross-reference checks remain build-only (they need the corpus, which workerd doesn't have).

### Surface the vocab to the agent (steer + enforce, not enforce alone)

Enforcement stops bad data; it doesn't teach the agent the right value. The controlled sets are currently in `docs/SCHEMAS.md` (a dev doc not loaded into Claude.ai) and `build-indexes.mjs` — never where the agent picks the value. So `create_recipe`/`update_recipe` descriptions enumerate the protein & cuisine sets (mirroring how the equipment list is already inlined in `create_recipe`), and `AGENT_INSTRUCTIONS.md` gets a one-line classification rule. The agent thus gets the right value most of the time *and* is caught with a fixable error when it doesn't.

## Risks / Trade-offs

- **Reintroducing a second copy of the vocab (drift) →** mitigated by the single shared module: there is exactly one definition. If the bundler forces a mirror, a parity test becomes the required guard.
- **`none`-normalization could mask a real miscategorization →** low: `none` has no valid meaning for these fields, and a no-protein dish is genuinely field-absent. Non-`none` off-vocab values still error, so true miscategorizations (`shrimp`) are surfaced, not swallowed.
- **A stricter write path could reject a recipe the agent can't immediately re-classify →** the structured error names the offending field/value and (via the enumerated description) the legal set, so the agent has what it needs to fix it in the same turn. This is a net improvement over today's silent success + broken CI.
- **Worker/build still validate different *scopes* (structural vs. cross-reference) →** intentional and unchanged. This change only unifies the *vocabulary* subset, which doesn't need the corpus.

## Future / Out of scope

- **`build-site` resilience (defense-in-depth).** Even with write-time enforcement, a direct git edit to the data repo (bypassing the Worker) or legacy data could still carry an off-vocab value. Making `build-site` skip-and-deploy an invalid recipe (warn, exclude from the site, still publish the rest) would cap the blast radius at "one recipe missing from the cookbook" instead of "cookbook frozen." Kept out of this change because (a) write-time enforcement removes the dominant path to bad data, and (b) `build-indexes` should stay strict (it's the source-of-truth index; silently dropping recipes there is worse than failing). Worth a follow-up if direct-edit incidents recur.

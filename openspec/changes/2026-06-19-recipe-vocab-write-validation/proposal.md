## Why

A batch of draft-recipe imports broke the data repo's `build-indexes` **and** `build-site` (the public cookbook deploy): three recipes carried `protein` values outside the controlled vocabulary — `shrimp` (the bucket is `shellfish`) and two `none`. The build validator caught them, but only **post-push, on `main`**, where the damage is maximal:

- the **public website deploy froze** (stale until a human notices a red ✗ in the Actions tab),
- the **`_indexes/` regen failed**, so the new recipes are invisible to the agent's own `list_recipes` (which reads the index),
- and the member's agent in Claude.ai got a **successful** `create_recipe` and moved on — the one actor with the recipe in hand never learned it had written invalid data.

The root cause is a seam in the determinism boundary. The controlled vocabularies for `protein`/`cuisine` live **only** in `scripts/build-indexes.mjs` (the post-push build). The Worker's write-time validator (`src/validate.ts`) checks recipe frontmatter for **shape only** — `protein: z.string()` accepts any string — by a deliberate decision ("the build is the gate for recipe content", encoded in the data-validation spec's `requires_equipment` requirement). The build-as-gate backstop assumed a build failure was benign; it isn't, because the build sits downstream of a public deploy, the index regen, and a broken feedback loop.

The fix is to move the gate **upstream of the commit**, where the same pattern already exists: `ready_to_eat` and `kitchen` vocab/enums are validated in **both** the Node build validator and the Worker's `src/validate.ts`. `protein`/`cuisine`/`requires_equipment` are the outliers — this change brings them in line.

## What Changes

- **Single source of truth for controlled vocabularies.** Extract `PROTEIN_VOCAB`, `CUISINE_VOCAB`, and `EQUIPMENT_VOCAB` into one shared module imported by **both** `src/validate.ts` (Worker) and `scripts/build-indexes.mjs` (build), so the two validators cannot drift. (Today `EQUIPMENT_VOCAB` is *mirrored* with a "keep in sync" comment; `protein`/`cuisine` aren't mirrored into `src/` at all.)
- **Write-time vocabulary enforcement.** `src/validate.ts` validates recipe `protein`, `cuisine`, and `requires_equipment` against the shared vocab. Because `create_recipe` / `update_recipe` / `commit_changes` all persist through the commit engine's `validateFile`, an off-vocabulary value is rejected with a structured `validation_failed` error **before any commit** — the agent self-corrects in the same turn and the bad data never reaches `main`.
- **Forgiving `none` normalization.** The recipe write path normalizes a `protein`/`cuisine` of the literal `none` (or empty string) to **absent** before persisting. "No protein focus" (a vegetable side, a plain noodle dish, a condiment) is a legitimate state, and absence is already warn-only — so the common case just works instead of erroring.
- **Surface the vocab where the value is chosen.** `create_recipe` / `update_recipe` descriptions enumerate the protein & cuisine sets (equipment is already listed), and `AGENT_INSTRUCTIONS.md` gains a one-line rule: classify `protein`/`cuisine` to the coarse bucket; omit `protein` when there's no protein focus — never write `none`. (Plugin rebuilt from the source doc.)
- **Docs.** `docs/SCHEMAS.md` and `docs/TOOLS.md` updated to record that the recipe vocabularies are now enforced at write time, not only at build time.

Out of scope (captured in design as a fast-follow): making `build-site` *resilient* to a single invalid recipe (skip-and-deploy) as defense-in-depth. With write-time enforcement in place, invalid recipes can no longer reach `main` via the Worker, so this is secondary.

## Capabilities

### New Capabilities

_(none — this hardens existing capabilities)_

### Modified Capabilities

- `data-validation`: `protein`/`cuisine`/`requires_equipment` controlled vocabularies are enforced in **both** the Node build validator and the Worker write-time subset, from a single shared definition; the recipe write path normalizes `none`/empty to absent.
- `data-write-tools`: `create_recipe`/`update_recipe`/`commit_changes` reject off-vocabulary recipe frontmatter with a structured error and normalize `none`/empty `protein`/`cuisine` to absent; their descriptions enumerate the vocab.
- `recipe-import`: the import/enrichment path classifies `protein`/`cuisine` to the coarse controlled bucket and omits `protein` for no-protein-focus dishes rather than inventing an off-vocabulary value.

## Impact

- **New** shared vocab module (e.g. `src/vocab.js`) — the single definition of `PROTEIN_VOCAB` / `CUISINE_VOCAB` / `EQUIPMENT_VOCAB`.
- `src/validate.ts` — vocab checks for recipe `protein`/`cuisine`/`requires_equipment`; import the shared module.
- `src/kitchen.ts` — re-export `EQUIPMENT_VOCAB` from the shared module (remove the local copy).
- `scripts/build-indexes.mjs` — import the shared vocab; drop the local `PROTEIN_VOCAB`/`CUISINE_VOCAB`/`EQUIPMENT_VOCAB` definitions.
- `src/discovery-tools.ts` (`create_recipe`) and `src/write-tools.ts` (`update_recipe` / `splitRecipeUpdate`) — `none`/empty normalization; description strings enumerate the protein/cuisine vocab.
- `AGENT_INSTRUCTIONS.md` + regenerated `plugin/` (`npm run build:plugin`) — the classification one-liner (guarded by the CI "plugin skills current" check).
- `docs/SCHEMAS.md`, `docs/TOOLS.md` — write-time enforcement note.
- `test/validate.test.ts` (and tooling tests) — off-vocab rejection, `none`-normalization, and a guard that the shared vocab is the only definition.
- No data-file schema changes; no breaking changes to tool callers (off-vocab inputs were already destined to fail — now they fail earlier and louder, with a fixable error).

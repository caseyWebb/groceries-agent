## Context

The recipe corpus classifies recipes along several objective dimensions (`protein`, `cuisine`, `dietary`, `season`, `requires_equipment`, `perishable_ingredients`) but has no "what kind of dish is this?" facet. Sides are modeled only indirectly: `standalone: true` marks a main that needs no side, and `pairs_with: [slug]` is a learned main→side plating edge. A "side" is therefore inferable only from being referenced in some main's `pairs_with` — there is no way to ask `list_recipes` for sides. As a result the menu flow sources sides in a **separate sequenced phase** (`menu-generation`'s "Plate-rounding" + "Side pairing bootstrap" requirements) that runs after mains are chosen, guessing plate fit over the whole active corpus.

This change is squarely within the [ADR-0001 determinism-boundary shift](../../../docs/adr) that just retired the substitution engine and `verify_pantry`: push judgment to the agent reasoning over loaded context, keep the persisted-state surface small. Two precedents are load-bearing here:
- **`domain`** on `grocery_list.toml` — a free-string, open-vocabulary, shape-only-validated field with a read-time default. The model for `course`.
- **`cooking_log`'s `type = ad_hoc`** entries — a non-slug `name` + optional inline dims. Proof that non-corpus items already coexist with slug-keyed records.

Pantry rows carry `added_at` / `category` / `quantity` / `prepared_from` but **no expiry date**, so "expiry-matching" is necessarily agent judgment, not a sort key.

## Goals / Non-Goals

**Goals:**
- A `course` facet that is cheap to author, trivially extensible without code changes, and filterable in `list_recipes`.
- Collapse side-sourcing into the main meal-plan reasoning pass via a single faceted load.
- Keep open-world sides (trivial preparations that don't warrant a recipe file) while routing them into both `meal_plan.toml` and the cart.
- Shrink the persisted-state surface by removing the now-vestigial `standalone`.

**Non-Goals:**
- A grouped/faceted `list_recipes` return shape — the return stays flat.
- A controlled `course` vocabulary, a course registry, or an add-category tool.
- Remembering open-world sides across plans (they are re-proposed by reasoning).
- Backfilling `course` across the existing corpus (operator action; out of scope).
- Adding expiry/shelf-life data to the pantry.

## Decisions

### D1 — `course` is open-vocabulary, shape-validated only

Unlike `protein`/`cuisine` (controlled sets with a build hard-fail on off-vocab values, because a typo silently corrupts variety stats), `course` is validated for **shape only** (a string, or an array of strings) — never for membership in a set. Rationale: the same agent both classifies (at import) and reads (at plan time), so drift is self-correcting; future categories (`sauce`, `baked_good`) need zero code change; and the corpus is self-describing (the distinct course values are visible right in `list_recipes` results).

- **Alternative — controlled `COURSE_VOCAB` like protein/cuisine:** rejected. It re-imposes the deliberate-edit ceremony the user explicitly wants to avoid and buys little, since course doesn't feed a statistical aggregation the way protein/cuisine feed the retrospective.
- **Alternative — an add-category *tool*:** rejected. A tool only earns its place if there is a registry to add to; with open vocab there is none. A category exists the moment a recipe is tagged with it.

**Drift guard:** normalize on write — lowercase + trim — the same normalize-at-write move `perishable_ingredients` uses, so `Main`/`main`/`"main "` don't fork the facet. Deliberately **not** singularization (it would mangle `baked_good`/`baked_goods`); a one-line documented convention (`main, side, dessert, breakfast`, extend freely) handles plural drift instead.

### D2 — `course` is a list, normalized to an array

Stored as `string | string[]`, normalized to a lowercased string **array** in the index. A list expresses dual-use dishes (`course: [main, side]`) directly and generalizes to any future "this is both X and Y"; it is also the idiom already used by `dietary`/`season`/`tags`/`pairs_with`.

- **Alternative — a discrete `main_or_side` token:** rejected. It is a special case that doesn't generalize (what about a `[side, sauce]`?) and adds a value the agent must special-case.

The `list_recipes` filter param stays **scalar** — `{ course: "side" }` — with **containment** semantics (match when the recipe's course array includes the value). This is simpler than the AND-narrowing `dietary`/`season` filters and matches the "I want one course at a time" usage. Implementation is a one-liner beside the `protein`/`cuisine` equality checks in `filterRecipes`.

### D3 — Drop `standalone`, keep `pairs_with`

The rework moves the *"does this main want a side?"* judgment into the holistic main-reasoning pass (D5), so a persisted `standalone` flag would only cache an inference the new flow recomputes anyway — it is **vestigial in the reworked flow**, not merely cheap. Removing it deletes a build hard-fail, a Worker shape-check, an index projection, a warn-only default, a `menu-generation` requirement, and a flow step.

`pairs_with` is kept because it encodes something `course` cannot reconstruct: a **specific learned affinity** (this side with this main). `course: side` returns *all* sides, not the one the member liked here.

The principled line: **drop the recomputable cache, keep the learned edge.**

- **Risk** → existing recipes carrying `standalone: true` in the data repo: removing the shape-check makes the field inert (an unknown frontmatter key, ignored). No migration required; an operator may strip them lazily. (We may optionally add `standalone` to the index strip-list for cleanliness, but a lingering field is harmless since nothing reads it.)

### D4 — Open-world sides ride on their main's `[[planned]]` row

`meal_plan.toml` `[[planned]]` rows are slug-only (`recipe` required; the reconcile and cooked flows resolve it via `list_recipes`/`read_recipe`). An open-world side ("roasted broccoli") has no slug. We add an optional **`sides: string[]`** to the planned row so open-world sides ride on the accompanying main's row as free text. The `recipe` slug invariant is untouched, so the reconcile and cooked flows do not change — `sides` is advisory text the cook flow reads.

- **Alternative — mint a draft recipe for every accepted side:** rejected. That is the closed-world status quo the "open-world sides" requirement explicitly moves away from; trivial preparations shouldn't litter the corpus.
- **Alternative — give the open-world side its own `[[planned]]` row with a non-slug `recipe` + `ad_hoc` flag:** rejected. It breaks the slug invariant and forces the reconcile/cooked/validation paths to special-case non-resolving rows.

Corpus sides (`course: side` recipes) are unaffected — they keep their **own** `[[planned]]` slug row, so they remain fully first-class (cookable, ratable, reconcilable). The result is a clean two-tier model: corpus sides as slug rows, open-world sides as `sides[]` annotations.

`MealPlanOp` and `PlannedItem` (`src/meal-plan.ts`) gain an optional `sides` array; `applyMealPlanOps` upserts it on `add`. `commit_changes` `meal_plan_ops` carries it through.

### D5 — Open-world side ingredients: `for_recipes: []` + `note` (option A)

The agent enumerates an open-world side's ingredients from world knowledge ("roasted broccoli → broccoli, olive oil, garlic") and adds the absent ones to `grocery_list.toml` with `source = menu`, **`for_recipes = []`**, and a `note` ("for the broccoli side"). No `grocery_list.toml` schema change — `for_recipes` is not even shape-validated and empty is already normal for ad-hoc items.

- **Alternative — loosen `for_recipes` to accept a free-text side label:** rejected. It muddies the "slugs only" contract every other consumer (the partials aggregation, dedup) assumes, to buy traceability that already lives in the planned row's `sides` field.

Consequence: the partials flow at order time can't tie these rows to a recipe's required amount, so they fall to `assumed_quantity: true` (default 1 package). The agent sets an explicit count from world knowledge at capture when produce-by-the-each is involved — the same judgment it already applies to ad-hoc produce.

### D6 — One faceted load, flat return, holistic reasoning, then cost/confirm

Because `course` rides every `list_recipes` entry's frontmatter for free (the index emits all objective frontmatter), a single `list_recipes({ status: "active" })` already returns mains and sides with full metadata — the agent **buckets by `course` client-side**. No grouped return envelope (every other caller depends on the flat shape). This load joins the existing parallel context batch (`read_pantry`, `read_preferences`, `read_taste`, `ready_to_eat_available`, `kroger_flyer`). The agent then reasons holistically over the loaded set + pantry — menu, sides (corpus + open-world), expiry-matching (judgment over `added_at`/`category`), inventory subs — **before** the `kroger_prices` costing call, which still runs last on the final to-buy set (mains + corpus-side + open-world-side ingredients), then confirm, then one capture commit.

## Risks / Trade-offs

- **Open-vocab facet fragmentation** (`main` vs `mains` vs `entree`) → write-time lowercase+trim normalization + a documented convention + a self-describing corpus the agent can read its own prior values from. Accepted residual: a determined typo splits a bucket, costing at most an un-bucketed recipe (degrades like an absent `course`).
- **Lost "never re-prompt" guarantee from dropping `standalone`** → re-inferring "this chili is a complete plate" with the body loaded is reliable, and a miss costs only a declined side or a side the user asks for. Low cost, and the rework recomputes it anyway.
- **Open-world sides are un-remembered** → acceptable; trivial sides don't need memory. A future nicety could promote a frequently-chosen open-world side to a corpus recipe (and thus into `pairs_with`); deferred.
- **Open-world side grocery rows have no recipe attribution** → assumed-quantity-1 at order time, corrected by the agent's explicit count at capture. Traceability lives in the planned row's `sides` field, not `for_recipes`.
- **`course` absence on the existing corpus** → faceting degrades gracefully (an un-coursed recipe is simply un-bucketed; warn-only, never a build failure). Backfill is an operator action, deliberately not shipped here — a known inconsistency with the system-provided `perishable_ingredients` backfill, accepted per the agreed scope.

## Migration Plan

1. Ship the code changes together (they are mutually consistent): `build-indexes.mjs`, `validate.ts`, `recipes.ts`, `meal-plan.ts`. Regenerate `_indexes/recipes.json`.
2. Regenerate the `plugin/` bundle from `AGENT_INSTRUCTIONS.md`; update `docs/SCHEMAS.md` and `docs/TOOLS.md` in the same pass.
3. Operator deploys the Worker from the private data repo (`gh workflow run deploy.yml`). Existing `standalone` fields become inert; `course` populates going forward at import; existing recipes are un-coursed until an operator backfill (out of scope).
- **Rollback:** revert the commits. Forward-compatible both ways — old code ignores unknown frontmatter (`course`) and unknown planned-row fields (`sides`); grocery rows with `for_recipes: []` are already valid. No data cleanup required to roll back.

## Open Questions

- Convention enforcement: documented-only (chosen), or a soft build *warning* for off-convention `course` values? Leaning documented-only to honor "no validated set," but a warn-only lint is a cheap future add if drift shows up.
- Should the meal-plan faceted load trim to `course` in {main, side} (ignoring dessert/breakfast), or load all active and bucket? Leaning load-all-and-bucket (simplest, and dessert/breakfast are just ignored for a dinner plan) — a flow-guidance detail, not a contract.

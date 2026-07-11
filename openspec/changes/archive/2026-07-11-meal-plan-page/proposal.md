## Why

Band 1 shipped the whole meal-dimension backend — per-slot row identity (D26-final), the
`add`/`remove`/`set` op contract with slug-fanout and coalesce, `duplicate: true` as the one
duplication spelling, project rows (`meal='project'`), and `from_vibe` provenance — but the
member Meal plan page still renders the pre-dimension design: two flat groups (Scheduled /
Unscheduled) with no meal labels, no empty-slots grid, no projects surface, and no provenance.
The design mockup (pages/03, DECISIONS D26-final, design-requests #2) specifies the redesign,
and the row-op contract it needs already exists. This change is the member UI over that
contract — no new ops, tools, D1 schema, or migration.

## What Changes

- **Rebuild the Meal plan page over the meal dimension.** Scheduled rows render day-grouped
  with BREAKFAST/LUNCH/DINNER labels, meal-ordered within a day; a "Show empty meal slots"
  switch swaps the scheduled list for a 7-day × 3-meal empty-slots grid; the Unscheduled
  section groups by meal (all three headings always shown, each with its own "+ Add Recipe"
  picker); a new **"Baking, treats & drinks"** Projects section renders `meal='project'` rows.
- **Wire the D26-final interaction semantics** by composing the EXISTING ops through the
  ordered-array ops route: picking an already-planned recipe into a slot MOVES it (a plain
  `add` coalesce, sides preserved) with an inline "Add again instead" affordance as the ONLY
  path that sets `duplicate: true`; picking into an occupied slot MOVES the occupant to
  Unscheduled (a `set planned_for: null`) with a toast — never a silent delete; rows scheduled
  beyond the 7-day horizon stay visible in a "Later" strip. Sibling slots of one recipe carry a
  `×N` badge. Every side surface uses the open-world side combobox (never a `window.prompt`).
- **Render `from_vibe` provenance** as a muted "from {vibe}" chip, resolving the id to its
  phrase through the existing vibes read (falling back to the raw id), reusing the shared
  facet/chip styling.
- **One additive backend field.** `CookbookHit` (and the app's `Hit`) gain `course: string[]`
  (lowercased, `[]` default) so the Projects picker can offer only project-eligible recipes
  (a non-meal course) and label each by its course-derived kind (Baking / Dessert / Beverage /
  title-cased). The `RecipeIndex` entry already holds `course`; this only widens the compact
  hit projection the member `/api/cookbook/recipes` response already serves.

## Capabilities

### Modified Capabilities

- `member-app-core`: the "Meal plan page over row-level ops" requirement gains the redesign's
  presentation obligations — day-grouped meal-labeled rows, the toggleable 7×3 empty-slots
  grid, Unscheduled grouped by meal, the Projects section over `meal='project'` (course-filtered
  add + course-derived kind), and `from_vibe` provenance rendering — plus scenarios for the
  D26-final move/add-again, occupied-slot move-to-unscheduled, beyond-horizon visibility, and
  the side combobox.

## No delta to `meal-planning`

The `meal-planning` capability needs **no** spec change: band 1 shipped the complete row-op
contract this page consumes (per-slot identity, add-coalesce/duplicate, remove split
idempotency, set unique-or-candidates, project constraints, `from_vibe` preservation, the flat
ordered read). This change only builds a UI over it — it re-implements none of the op semantics.

## Impact

- **Worker (`src/`)** — `cookbook-search.ts`: add `course: string[]` to `CookbookHit` and
  `toHit` (lowercased, `[]` default). No route, tool, D1, or migration change — the browse
  index endpoint already maps through `toHit`, so the field flows to `/api/cookbook/recipes`
  for free.
- **Member app (`packages/app`)** — `lib/data.ts`: add `course?: string[]` to `Hit`.
  `routes/_app.plan.tsx`: the full redesign (grid, later strip, unscheduled-by-meal, projects,
  provenance, move/add-again/occupied-slot resolutions) composed over the existing
  `usePlanOps`. `packages/ui/src/cookbook.css`: the ported plan classes and `--meal-*` tokens.
- **No docs obligation.** `course` widens an internal `/api/cookbook/recipes` response field,
  not a documented MCP tool contract — no `docs/TOOLS.md` or `docs/SCHEMAS.md` change. The
  `meal-planning` contract docs are unchanged.
- **Tests** — the member Playwright plan page objects/specs gain the redesign coverage
  (empty-slots grid move/add-again/occupied-slot, Later strip, projects, provenance); the
  shared seed gains the redesign fixtures (an unscheduled non-dinner, a beyond-horizon row, a
  `from_vibe` row, a project row, and a course-tagged corpus recipe). `cookbook-search` unit
  tests assert the new `course` projection.

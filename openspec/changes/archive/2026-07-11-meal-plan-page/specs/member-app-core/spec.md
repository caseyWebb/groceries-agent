## MODIFIED Requirements

### Requirement: Meal plan page over row-level ops

The meal plan page SHALL read the tenant's planned rows and mutate them through the existing
row-level ops keyed by the **plan-row id** (client-mintable ULID; the class (b) replay key), with
slug-addressed ops keeping their defined fan-out (remove-by-slug drops all matching rows;
set-by-slug requires a unique match or returns candidates — the `meal-planning` capability): add
(id-keyed, preserving the new-for-me watermark stamp on add exactly as the MCP tool does),
remove, schedule and **unschedule** a slot, and add and **remove** open-world sides (via the
`set` op). Slot provenance (`from_vibe`) and the row's `meal` SHALL be preserved across page
edits unless explicitly changed.

The page SHALL render the meal dimension:

- **Scheduled rows** SHALL render day-grouped with a per-day heading and a `breakfast | lunch |
  dinner` meal label, ordered by date then meal (breakfast < lunch < dinner) within a day.
- A **"Show empty meal slots" switch** (transient per-mount state, not URL-persisted) SHALL swap
  the scheduled list for a fixed **7-day × {breakfast, lunch, dinner} empty-slots grid** over the
  member's **local** calendar days (today..+6) whose cell position IS the date: an empty cell
  offers a "+ Add Recipe" combobox; a cell SHALL show **every** row on that night and meal (two
  recipes, or duplicate siblings, stack — no row is ever hidden), each with the recipe (click to
  change), its sides, provenance, a remove control, and a `×N` badge when the recipe occupies
  more than one **meal** slot (project rows do not count toward the badge).
- The **Unscheduled section** SHALL group rows by meal; a meal's group renders only when it has
  unscheduled rows (a fully empty plan shows no bare meal headers), each shown group carrying its
  own "+ Add Recipe" picker; setting a row's date schedules it.
- A **"Baking, treats & drinks" Projects section** SHALL always be reachable (both modes, even on
  an empty plan) and render `meal='project'` rows as title + a course-derived kind label (Baking /
  Dessert / Beverage / else title-cased) + remove, with an "+ Add a project" picker offering only
  **project-eligible** corpus recipes — those carrying a course facet outside the meal set
  (`main`/`side`/`breakfast`/`component`). A project add SHALL be an **explicit duplication** so a
  project-eligible recipe already planned as a meal row is never moved by it.
- A row carrying **`from_vibe`** SHALL render a muted provenance chip resolving the id to its vibe
  phrase through the existing vibes read; an id that no longer resolves renders **no** chip (never
  a raw id).
- An op-layer conflict (an ambiguous coalesce over a slug with 2+ rows, a project-constraint
  refusal) SHALL be surfaced to the member as a failure, never swallowed as a silent no-op or a
  false success; an occupied-slot replacement SHALL be refused up front when the incoming recipe
  already occupies 2+ slots, so the occupant is never moved and the slot never emptied.

The page SHALL compose the D26-final interaction semantics from the existing ops — the ops route
accepts an ordered array, so a multi-step resolution rides one call, and the UI always holds the
row id:

- Picking an already-planned recipe into a slot SHALL default to a **MOVE** (a plain `add` that
  coalesces onto the existing row, relocating it with sides preserved); an explicit **"Add again
  instead"** affordance SHALL be the ONLY path that mints a second slot (the `duplicate: true`
  spelling), issued as a two-op array that restores the moved row and inserts the duplicate.
- Picking a recipe into a slot already holding a **different** recipe SHALL MOVE the occupant to
  Unscheduled (a `set planned_for: null`) with a confirming toast — never a silent remove of the
  occupant.
- Rows scheduled beyond the grid's 7-day horizon SHALL remain visible in a "Later" strip with an
  editable date, never hidden.
- Every side surface SHALL use the open-world side combobox (never a `window.prompt`).

#### Scenario: Page edits preserve provenance and the watermark

- **WHEN** a member reschedules a vibe-proposed row or edits its sides from the plan page
- **THEN** the edit addresses the row by its id, the row's `from_vibe` and `meal` are unchanged,
  and when a member adds a recipe the new-for-me watermark advances exactly as an agent-side
  `update_meal_plan` add would

#### Scenario: Picking an already-planned recipe moves it, sides kept

- **WHEN** a member picks an already-planned recipe (with sides) into an empty grid slot
- **THEN** the existing row is relocated to that slot with its sides preserved and no second row
  is created — a plain `add` coalesce, not a duplicate

#### Scenario: "Add again" is the only duplication path

- **WHEN** a member, after a move, chooses "Add again instead"
- **THEN** one ordered call restores the moved row to its previous slot and inserts a second row
  with `duplicate: true`, and the two sibling slots render a `×2` badge

#### Scenario: An occupied slot moves its occupant to Unscheduled, never deletes it

- **WHEN** a member picks a recipe into a slot already holding a different recipe
- **THEN** the occupant is set to `planned_for: null` (moved to Unscheduled) with a "Moved … to
  Unscheduled" toast, the new recipe takes the slot, and no `remove` of the occupant is issued

#### Scenario: A beyond-horizon row stays visible in Later

- **WHEN** the empty-slots grid is shown and a scheduled row is dated beyond the 7-day horizon
- **THEN** that row renders in the "Later" strip with an editable date, and editing the date into
  the window pulls it into the grid

#### Scenario: Projects are course-filtered rows with a course-derived kind

- **WHEN** the Projects section renders and its "+ Add a project" picker is opened
- **THEN** the picker offers only recipes with a non-meal course facet, each project row shows a
  kind label derived from its course (e.g. `dessert` → "Dessert"), and project rows are excluded
  from the meal-plan sidebar badge

#### Scenario: Sides are added through the open-world combobox

- **WHEN** a member adds a side to any plan row or filled slot
- **THEN** the side is entered through the open-world side combobox (free-text allowed) and
  persisted via the `set` op — never through a `window.prompt`

#### Scenario: An ambiguous add surfaces a conflict, not a false success

- **WHEN** a member picks a recipe that already occupies 2+ slots into a grid slot
- **THEN** a failure notice is shown and no row is created — never a silent no-op or a success
  toast

#### Scenario: An unresolved provenance id renders no chip

- **WHEN** a plan row carries a `from_vibe` id that no longer matches any vibe in the palette
- **THEN** the row renders no provenance chip (the raw id is never shown)

// Meal plan (member-app-core, meal-plan-page): the meal-dimension redesign over the
// D26-final row-level ops. Rows carry a `meal` (breakfast|lunch|dinner|project) and an
// opaque `id` — THE address every edit uses. The page composes the EXISTING add/set/remove
// ops (usePlanOps) into the D26-final interaction semantics: a plain `add` coalesces onto an
// already-planned recipe (a MOVE, sides preserved); `duplicate: true` is the ONLY path that
// mints a second slot ("add again", and every project add); an occupied slot's occupant is
// MOVED to Unscheduled (a `set planned_for: null`), never silently deleted. The ops route
// takes an ORDERED array (one call per resolution) and returns `{applied, conflicts}`, so a
// swallowed op-layer conflict surfaces as a failure toast rather than a false success.
// "Plan my week" opens propose (member-app-propose).
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Combobox,
  EmptyState,
  GroupHeading,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconPlus,
  IconSparkle,
  IconTrash,
  IconX,
  PageHead,
  toast,
} from "@yamp/ui";
import { useIndex, usePlan, useVibes, mintRowId, type Hit, type PlanOp, type PlannedRow } from "../lib/data";
import { usePlanOps } from "../lib/mutations";
import { fmtDay, localDay, localToday } from "../lib/format";

export const Route = createFileRoute("/_app/plan")({
  component: PlanPage,
});

/** The three schedulable meals, in their canonical order. */
const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];

/** Courses that are NOT a project (mains/sides/breakfasts/building-blocks stay in the plan
 *  proper). A recipe is project-eligible when it carries at least one course OUTSIDE this set. */
const NON_PROJECT_COURSES = new Set(["main", "side", "breakfast", "component"]);

/** The ambiguous-add copy: a plain add against a slug with 2+ rows can't coalesce. */
const AMBIGUOUS_MSG = "That recipe is already in more than one slot — couldn't add it here";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The Projects "kind" label from a recipe's course facets (D26 course-derived label). */
function projectKind(course: string[] | undefined): string {
  const cs = course ?? [];
  for (const c of cs) {
    if (c === "baked_good" || c === "baking") return "Baking";
    if (c === "dessert") return "Dessert";
    if (c === "drink" || c === "beverage") return "Beverage";
  }
  // Else the first project-eligible facet, title-cased; fall back to a generic label.
  const eligible = cs.find((c) => !NON_PROJECT_COURSES.has(c));
  return eligible ? cap(eligible) : "Project";
}

/** A recipe qualifies for the Projects picker when it has a non-meal course facet. */
function isProjectEligible(hit: Hit): boolean {
  return (hit.course ?? []).some((c) => !NON_PROJECT_COURSES.has(c));
}

/** "Today" / "Tomorrow" / "Wed Jul 8" for a grid day header (local calendar days). */
function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() + 1);
  if (date === localDay(t)) return "Tomorrow";
  return fmtDay(date);
}

/** A compact "Meal · Wed Jul 8" (or just the meal for an undated slot) — the resolve banner's
 *  "moved from" reference. */
function slotLabel(row: PlannedRow): string {
  const m = cap(row.meal);
  return row.planned_for ? `${m} · ${fmtDay(row.planned_for)}` : m;
}

interface SlotResolve {
  recipe: string;
  date: string;
  meal: Meal;
  survivorId: string;
  prevDate: string | null;
  prevMeal: PlannedRow["meal"];
  fromLabel: string;
}

function PlanPage() {
  const plan = usePlan();
  const index = useIndex();
  const vibes = useVibes();
  const planOps = usePlanOps();

  const [showEmptySlots, setShowEmptySlots] = React.useState(false);
  // The custom bottom toast — success feedback ("Moved …") AND op-layer conflict failures.
  const [planToast, setPlanToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = React.useCallback((msg: string) => {
    setPlanToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setPlanToast(null), 6000);
  }, []);
  React.useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);

  const items = plan.data?.planned ?? [];
  const recipes = index.data?.recipes ?? [];

  const bySlug = React.useMemo(
    () => new Map(recipes.map((r) => [r.slug.toLowerCase(), r])),
    [recipes],
  );
  const titleOf = React.useCallback(
    (slug: string) => bySlug.get(slug.toLowerCase())?.title ?? slug,
    [bySlug],
  );
  /** Resolve a `from_vibe` id to its phrase, or null when the vibe no longer exists — an
   *  unresolved id renders NO provenance chip (never a raw id like "cozy-noodles"). */
  const vibePhraseOf = React.useCallback(
    (id: string): string | null => vibes.data?.vibes.find((v) => v.id === id)?.vibe ?? null,
    [vibes.data],
  );

  // ×N sibling counts — a recipe occupying more than one MEAL slot (project rows are a
  // separate surface and never count toward a meal row's sibling badge).
  const countByRecipe = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of items) {
      if (r.meal === "project") continue;
      m.set(r.recipe.toLowerCase(), (m.get(r.recipe.toLowerCase()) ?? 0) + 1);
    }
    return m;
  }, [items]);
  const dupOf = React.useCallback(
    (slug: string) => countByRecipe.get(slug.toLowerCase()) ?? 0,
    [countByRecipe],
  );

  // Local-calendar horizon: today..+6. The plan's `planned_for` dates come from the native
  // (local) date picker, so a UTC window would misplace evening west-of-UTC users' rows.
  const today = localToday();
  const horizon = React.useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      out.push(localDay(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [today]);
  const horizonSet = React.useMemo(() => new Set(horizon), [horizon]);

  const mealRows = items.filter((r) => r.meal !== "project");
  const projectRows = items.filter((r) => r.meal === "project");
  const scheduled = mealRows
    .filter((r) => r.planned_for)
    .sort(
      (a, b) =>
        String(a.planned_for).localeCompare(String(b.planned_for)) ||
        MEALS.indexOf(a.meal as Meal) - MEALS.indexOf(b.meal as Meal),
    );
  const unscheduled = mealRows.filter((r) => !r.planned_for);
  // Beyond-horizon (or past-dated) scheduled rows — the grid can only show its 7 days, so
  // these live in the "Later" strip and NEVER vanish.
  const laterRows = scheduled.filter((r) => !horizonSet.has(String(r.planned_for)));

  // Combobox option sets. The slot/unscheduled pickers offer the WHOLE index (picking an
  // already-planned recipe MOVES it); Projects offers only project-eligible recipes.
  const recipeOptions = recipes.map((r) => ({
    value: r.slug,
    label: r.title,
    sub: [r.protein, r.cuisine].filter(Boolean).join(" · "),
  }));
  const projectedSlugs = new Set(projectRows.map((r) => r.recipe.toLowerCase()));
  const projectOptions = recipes
    .filter((r) => isProjectEligible(r) && !projectedSlugs.has(r.slug.toLowerCase()))
    .map((r) => ({ value: r.slug, label: r.title, sub: projectKind(r.course) }));

  // --- op helpers (every edit is the row id, per D26-final) --------------------------
  // Gate feedback on the op-layer result: a `conflicts[]` entry means the op was NOT applied
  // (a coalesce over an ambiguous slug, a project-constraint refusal, …) and must read as a
  // failure, never a silent success.
  const dispatch = (ops: PlanOp[], opts?: { onOk?: () => void; conflictMsg?: string }) =>
    planOps.mutate(
      { ops },
      {
        onSuccess: (res) => {
          if (res.conflicts.length > 0) {
            if (opts?.conflictMsg) showToast(opts.conflictMsg);
          } else {
            opts?.onOk?.();
          }
        },
      },
    );

  // Header add: a plain, meal-agnostic add (dinner default at the op layer).
  function addRecipe(slug: string) {
    dispatch([{ op: "add", id: mintRowId(), recipe: slug }], {
      onOk: () => toast("Added to meal plan"),
      conflictMsg: AMBIGUOUS_MSG,
    });
  }

  const actions = (
    <div className="field-inline plan-add-inline">
      <Combobox
        options={recipeOptions}
        placeholder="Add a recipe…"
        ariaLabel="Add a recipe to the plan"
        emptyText="No recipes match"
        onSelect={addRecipe}
      />
      <Button asChild variant="outline" data-testid="plan-my-week">
        <Link to="/propose">
          <IconSparkle /> Plan my week
        </Link>
      </Button>
    </div>
  );

  const planEmpty = items.length === 0;

  return (
    <div data-testid="plan-page">
      <PageHead
        title="Meal plan"
        sub="What you're cooking next. Schedule a night, add sides, or pull a recipe in."
        actions={actions}
      />

      <div className="plan-slots-toggle">
        <button
          type="button"
          role="switch"
          aria-checked={showEmptySlots}
          className="mp-switch"
          data-on={showEmptySlots}
          data-testid="empty-slots-switch"
          onClick={() => setShowEmptySlots((v) => !v)}
        >
          <span className="mp-switch-knob" />
        </button>
        <span className="plan-slots-toggle-label">Show empty meal slots</span>
      </div>

      {planEmpty && !showEmptySlots ? (
        <EmptyState
          title="Nothing planned"
          sub="Add a recipe from here or hit “Add to meal plan” on any recipe."
          icon={<IconCalendar />}
        />
      ) : null}

      {showEmptySlots ? (
        <EmptySlotsGrid
          horizon={horizon}
          today={today}
          scheduled={scheduled}
          titleOf={titleOf}
          dupOf={dupOf}
          recipeOptions={recipeOptions}
          vibePhraseOf={vibePhraseOf}
          onMove={addToSlot}
          onAddAgain={addAgain}
          onReplace={replaceInSlot}
          onRemove={removeRow}
          onSetSides={setSides}
        />
      ) : null}

      {showEmptySlots && laterRows.length ? (
        <div className="plan-group" data-testid="plan-later">
          <GroupHeading>Later</GroupHeading>
          <p className="plan-note">
            Scheduled beyond the next 7 days. Change a date to pull one up into the grid.
          </p>
          {laterRows.map((r) => (
            <PlanRow
              key={r.id}
              row={r}
              titleOf={titleOf}
              dup={dupOf(r.recipe)}
              vibePhrase={r.from_vibe ? vibePhraseOf(r.from_vibe) : null}
              testId="later-row"
            />
          ))}
        </div>
      ) : null}

      {!showEmptySlots && scheduled.length ? (
        <div className="plan-group" data-testid="plan-scheduled">
          <GroupHeading>Scheduled</GroupHeading>
          {scheduled.map((r, i) => {
            const newDay = i === 0 || scheduled[i - 1].planned_for !== r.planned_for;
            return (
              <React.Fragment key={r.id}>
                {newDay ? (
                  <div className="plan-day-h">{dayLabel(String(r.planned_for), today)}</div>
                ) : null}
                <PlanRow
                  row={r}
                  titleOf={titleOf}
                  dup={dupOf(r.recipe)}
                  vibePhrase={r.from_vibe ? vibePhraseOf(r.from_vibe) : null}
                />
              </React.Fragment>
            );
          })}
        </div>
      ) : null}

      {/* Unscheduled renders only the meals that actually have rows — an empty plan shows no
          bare meal headers (just the empty state), and each shown group carries its own add. */}
      {unscheduled.length ? (
        <div className="plan-group" data-testid="plan-unscheduled">
          <GroupHeading>Unscheduled</GroupHeading>
          {MEALS.filter((meal) => unscheduled.some((r) => r.meal === meal)).map((meal) => (
            <UnscheduledMeal
              key={meal}
              meal={meal}
              rows={unscheduled.filter((r) => r.meal === meal)}
              titleOf={titleOf}
              dupOf={dupOf}
              vibePhraseOf={vibePhraseOf}
              recipeOptions={recipeOptions}
              onAdd={(slug) => addUnscheduled(meal, slug)}
            />
          ))}
        </div>
      ) : null}

      {/* Projects always renders (both modes, even on an empty plan) so "+ Add a project"
          is always reachable. */}
      <div className="plan-group" data-testid="plan-projects">
        <GroupHeading>Baking, treats &amp; drinks</GroupHeading>
        <p className="plan-note">
          A catch-all for anything outside the big-three daily meals — bakes, desserts,
          drinks, and whatever else you want to shop for and keep on deck.
        </p>
        {projectRows.map((r) => (
          <ProjectRow
            key={r.id}
            row={r}
            title={titleOf(r.recipe)}
            kind={projectKind(bySlug.get(r.recipe.toLowerCase())?.course)}
            onRemove={() => removeRow(r.id)}
          />
        ))}
        <ProjectAdd options={projectOptions} onAdd={addProject} />
      </div>

      {planToast ? (
        <div className="plan-toast" role="status" data-testid="plan-toast">
          <IconCheck />
          <span>{planToast}</span>
          <button type="button" className="toast-undo" onClick={() => setPlanToast(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );

  // --- interaction semantics (declared after render; hoisted function declarations) ---

  /** Pick a recipe into an EMPTY grid slot. Default = MOVE (a plain add coalesces onto the
   *  one existing row, relocating it, sides kept). A recipe that already occupies 2+ slots
   *  can't coalesce — surface the ambiguity, change nothing. Returns the resolve context when
   *  a move happened, so the caller can surface the "Add again instead" banner. */
  function addToSlot(date: string, meal: Meal, slug: string): SlotResolve | null {
    const existing = mealRows.filter((r) => r.recipe.toLowerCase() === slug.toLowerCase());
    if (existing.length >= 2) {
      showToast(AMBIGUOUS_MSG);
      return null;
    }
    dispatch([{ op: "add", id: mintRowId(), recipe: slug, meal, planned_for: date }], {
      conflictMsg: AMBIGUOUS_MSG,
    });
    if (existing.length === 1) {
      const prev = existing[0];
      return {
        recipe: slug,
        date,
        meal,
        survivorId: prev.id,
        prevDate: prev.planned_for ?? null,
        prevMeal: prev.meal,
        fromLabel: slotLabel(prev),
      };
    }
    return null;
  }

  /** "Add again instead": restore the moved row to its previous slot AND mint a second slot
   *  (the ONE `duplicate: true` path) — one ordered two-op call. */
  function addAgain(r: SlotResolve) {
    dispatch(
      [
        { op: "set", id: r.survivorId, planned_for: r.prevDate, meal: r.prevMeal },
        { op: "add", id: mintRowId(), recipe: r.recipe, meal: r.meal, planned_for: r.date, duplicate: true },
      ],
      { conflictMsg: "Couldn't add it again — nothing changed" },
    );
  }

  /** Pick a DIFFERENT recipe into a FILLED slot: the occupant MOVES to Unscheduled (never a
   *  silent delete), then the new recipe takes the slot. Refuse when the incoming recipe
   *  already occupies 2+ slots — its add would conflict and leave the slot empty after the
   *  occupant already moved. Guard first: change nothing. */
  function replaceInSlot(date: string, meal: Meal, occupant: PlannedRow, slug: string) {
    if (occupant.recipe.toLowerCase() === slug.toLowerCase()) return;
    const incoming = mealRows.filter((r) => r.recipe.toLowerCase() === slug.toLowerCase());
    if (incoming.length >= 2) {
      showToast(AMBIGUOUS_MSG);
      return;
    }
    dispatch(
      [
        { op: "set", id: occupant.id, planned_for: null },
        { op: "add", id: mintRowId(), recipe: slug, meal, planned_for: date },
      ],
      {
        onOk: () => showToast(`Moved ${titleOf(occupant.recipe)} to Unscheduled`),
        conflictMsg: "Couldn't place that recipe — nothing changed",
      },
    );
  }

  function addUnscheduled(meal: Meal, slug: string) {
    dispatch([{ op: "add", id: mintRowId(), recipe: slug, meal }], { conflictMsg: AMBIGUOUS_MSG });
  }

  /** A project is ALWAYS an explicit add (`duplicate: true`) — never a coalesce — so adding a
   *  project-eligible recipe that's also planned as a meal never moves the meal row. */
  function addProject(slug: string) {
    dispatch([{ op: "add", id: mintRowId(), recipe: slug, meal: "project", duplicate: true }], {
      conflictMsg: "Couldn't add that project",
    });
  }

  function removeRow(id: string) {
    dispatch([{ op: "remove", id }]);
  }

  function setSides(id: string, sides: string[]) {
    dispatch([{ op: "set", id, sides }]);
  }
}

/** The meal-colored mono label (its `--meal-color` token is set by `data-meal`). */
function MealLabel({ meal }: { meal: string }) {
  return (
    <span className="plan-meal" data-meal={meal}>
      {cap(meal)}
    </span>
  );
}

/** The ×N sibling badge — rendered only when the recipe occupies more than one slot. */
function DupBadge({ count }: { count: number }) {
  if (count <= 1) return null;
  return (
    <span className="dup-badge" title="This recipe is planned in more than one slot">
      ×{count}
    </span>
  );
}

/** The provenance chip ("from {vibe}") reusing the shared facet styling — hidden entirely
 *  when the vibe id no longer resolves (never leaks a raw id). */
function VibeChip({ phrase }: { phrase: string | null }) {
  if (!phrase) return null;
  return (
    <span className="facet plan-vibe" data-testid="vibe-chip">
      from {phrase}
    </span>
  );
}

/** The open-world sides editor (chips + remove + the allowCustom combobox adder) — shared by
 *  every row surface. A supplied `sides` array replaces the row's sides wholesale (D26 `set`). */
function SidesEditor({ sides, onChange }: { sides: string[]; onChange: (next: string[]) => void }) {
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="plan-sides">
      {sides.map((s) => (
        <span className="side-chip" key={s} data-testid="side-chip">
          {s}
          <button
            type="button"
            className="side-x"
            title="Remove side"
            aria-label={`Remove side ${s}`}
            onClick={() => onChange(sides.filter((x) => x !== s))}
          >
            <IconX />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="side-input-wrap side-combo">
          <Combobox
            options={[]}
            placeholder="add a side…"
            ariaLabel="Add a side"
            allowCustom
            autoFocus
            emptyText="Type a side and press Enter"
            onSelect={(v) => {
              const side = v.trim().toLowerCase();
              if (side && !sides.includes(side)) onChange([...sides, side]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </span>
      ) : (
        <button
          type="button"
          className="side-add"
          title="Add a side"
          data-testid="side-add"
          onClick={() => setAdding(true)}
        >
          <IconPlus /> side
        </button>
      )}
    </div>
  );
}

/** A scheduled / unscheduled / later row: date input (set/clear schedules), meal label, title,
 *  sides, provenance, remove — all addressed by the row id. Keeps `plan-row`/`data-recipe`. */
function PlanRow({
  row,
  titleOf,
  dup,
  vibePhrase,
  testId = "plan-row",
}: {
  row: PlannedRow;
  titleOf: (slug: string) => string;
  dup: number;
  vibePhrase: string | null;
  testId?: string;
}) {
  const planOps = usePlanOps();
  const sides = row.sides ?? [];
  const set = (patch: { planned_for?: string | null; sides?: string[] }) =>
    planOps.mutate({ ops: [{ op: "set", id: row.id, ...patch }] });

  return (
    <div className="plan-row" data-testid={testId} data-recipe={row.recipe}>
      <div className="plan-when">
        <input
          type="date"
          className="input plan-date"
          value={row.planned_for ?? ""}
          aria-label="Planned date"
          data-testid="plan-date"
          onChange={(e) => set({ planned_for: e.target.value || null })}
        />
      </div>
      <MealLabel meal={row.meal} />
      <div className="plan-main">
        <div className="plan-title-row">
          <Link className="plan-title" to="/recipe/$slug" params={{ slug: row.recipe }}>
            {titleOf(row.recipe)}
          </Link>
          <DupBadge count={dup} />
        </div>
        <SidesEditor sides={sides} onChange={(next) => set({ sides: next })} />
        <VibeChip phrase={vibePhrase} />
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Remove from plan"
        data-testid="plan-remove"
        onClick={() => planOps.mutate({ ops: [{ op: "remove", id: row.id }] })}
      >
        <IconTrash />
      </button>
    </div>
  );
}

/** The empty-slots grid — 7 local days × 3 meals. A cell shows EVERY row on that night+meal
 *  (siblings or two different recipes stack — nothing is ever hidden); a zero-row cell offers
 *  the "+ Add Recipe" combobox. Filled rows carry the change-recipe title, ×N badge, sides,
 *  provenance, and remove; a just-moved cell also shows the move-resolve banner. */
function EmptySlotsGrid({
  horizon,
  today,
  scheduled,
  titleOf,
  dupOf,
  recipeOptions,
  vibePhraseOf,
  onMove,
  onAddAgain,
  onReplace,
  onRemove,
  onSetSides,
}: {
  horizon: string[];
  today: string;
  scheduled: PlannedRow[];
  titleOf: (slug: string) => string;
  dupOf: (slug: string) => number;
  recipeOptions: { value: string; label: string; sub: string }[];
  vibePhraseOf: (id: string) => string | null;
  onMove: (date: string, meal: Meal, slug: string) => SlotResolve | null;
  onAddAgain: (r: SlotResolve) => void;
  onReplace: (date: string, meal: Meal, occupant: PlannedRow, slug: string) => void;
  onRemove: (id: string) => void;
  onSetSides: (id: string, sides: string[]) => void;
}) {
  // Transient local UI state (NOT reset by refetch — cleared explicitly on select/cancel):
  // which cell/row is picking, and the last move's resolve banner (keyed `${date}|${meal}`).
  const [pick, setPick] = React.useState<
    { type: "add"; key: string } | { type: "change"; rowId: string } | null
  >(null);
  const [resolve, setResolve] = React.useState<{ key: string; r: SlotResolve } | null>(null);

  const rowsOf = (date: string, meal: Meal) =>
    scheduled.filter((r) => r.planned_for === date && r.meal === meal);

  return (
    <div className="plan-group plan-week" data-testid="plan-week">
      {horizon.map((date) => (
        <div className="plan-day-slots" key={date}>
          {MEALS.map((meal, mi) => {
            const key = `${date}|${meal}`;
            const rows = rowsOf(date, meal);
            const addPicking = pick?.type === "add" && pick.key === key;
            const banner = resolve?.key === key ? resolve.r : null;
            return (
              <div
                className="plan-slot"
                data-testid="plan-slot"
                data-date={date}
                data-meal={meal}
                data-recipe={rows[0]?.recipe}
                key={meal}
              >
                <div className="plan-slot-day">{mi === 0 ? dayLabel(date, today) : ""}</div>
                <MealLabel meal={meal} />
                <div className="plan-slot-body">
                  {addPicking ? (
                    <span className="mp-recipe-combo">
                      <Combobox
                        options={recipeOptions}
                        autoFocus
                        placeholder="Search recipes…"
                        ariaLabel="Choose a recipe"
                        emptyText="No match"
                        onSelect={(slug) => {
                          const res = onMove(date, meal, slug);
                          setResolve(res ? { key, r: res } : null);
                          setPick(null);
                        }}
                        onCancel={() => setPick(null)}
                      />
                    </span>
                  ) : rows.length ? (
                    <>
                      {rows.map((row) =>
                        pick?.type === "change" && pick.rowId === row.id ? (
                          <span className="mp-recipe-combo" key={row.id}>
                            <Combobox
                              options={recipeOptions}
                              autoFocus
                              placeholder="Search recipes…"
                              ariaLabel="Choose a recipe"
                              emptyText="No match"
                              onSelect={(slug) => {
                                onReplace(date, meal, row, slug);
                                setPick(null);
                              }}
                              onCancel={() => setPick(null)}
                            />
                          </span>
                        ) : (
                          <div className="plan-slot-filled" data-testid="plan-row" data-recipe={row.recipe} key={row.id}>
                            <div className="plan-slot-line">
                              <button
                                type="button"
                                className="plan-title plain-link"
                                title="Change recipe"
                                onClick={() => setPick({ type: "change", rowId: row.id })}
                              >
                                {titleOf(row.recipe)}
                              </button>
                              <DupBadge count={dupOf(row.recipe)} />
                              <button
                                type="button"
                                className="icon-btn plan-slot-remove"
                                title="Remove from plan"
                                onClick={() => onRemove(row.id)}
                              >
                                <IconTrash />
                              </button>
                            </div>
                            <SidesEditor sides={row.sides ?? []} onChange={(next) => onSetSides(row.id, next)} />
                            <VibeChip phrase={row.from_vibe ? vibePhraseOf(row.from_vibe) : null} />
                          </div>
                        ),
                      )}
                      {banner ? (
                        <div className="slot-resolve">
                          <IconChevronRight />
                          <span>
                            Moved from <strong>{banner.fromLabel}</strong> — sides kept.
                          </span>
                          <button
                            type="button"
                            className="slot-resolve-btn"
                            onClick={() => {
                              onAddAgain(banner);
                              setResolve(null);
                            }}
                          >
                            Add again instead
                          </button>
                          <button
                            type="button"
                            className="slot-resolve-x"
                            title="Keep as moved"
                            onClick={() => setResolve(null)}
                          >
                            <IconX />
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="plan-add-slot"
                      onClick={() => setPick({ type: "add", key })}
                    >
                      <IconPlus /> Add Recipe
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** One meal heading in the Unscheduled section: its rows (dating them schedules) + a per-meal
 *  "+ Add Recipe" picker. Only meals that have rows render (an empty plan shows none). */
function UnscheduledMeal({
  meal,
  rows,
  titleOf,
  dupOf,
  vibePhraseOf,
  recipeOptions,
  onAdd,
}: {
  meal: Meal;
  rows: PlannedRow[];
  titleOf: (slug: string) => string;
  dupOf: (slug: string) => number;
  vibePhraseOf: (id: string) => string | null;
  recipeOptions: { value: string; label: string; sub: string }[];
  onAdd: (slug: string) => void;
}) {
  const [picking, setPicking] = React.useState(false);
  return (
    <div className="unsched-group">
      <div className="unsched-meal-head">
        <MealLabel meal={meal} />
      </div>
      {rows.map((r) => (
        <PlanRow
          key={r.id}
          row={r}
          titleOf={titleOf}
          dup={dupOf(r.recipe)}
          vibePhrase={r.from_vibe ? vibePhraseOf(r.from_vibe) : null}
        />
      ))}
      {picking ? (
        <span className="mp-recipe-combo">
          <Combobox
            options={recipeOptions}
            autoFocus
            placeholder="Search recipes…"
            ariaLabel={`Add a ${meal} recipe`}
            emptyText="No match"
            onSelect={(slug) => {
              onAdd(slug);
              setPicking(false);
            }}
            onCancel={() => setPicking(false)}
          />
        </span>
      ) : (
        <button
          type="button"
          className="plan-add-slot"
          data-testid={`add-unscheduled-${meal}`}
          onClick={() => setPicking(true)}
        >
          <IconPlus /> Add Recipe
        </button>
      )}
    </div>
  );
}

/** A project row: title + course-derived kind label + remove (no date, no meal, no sides). */
function ProjectRow({
  row,
  title,
  kind,
  onRemove,
}: {
  row: PlannedRow;
  title: string;
  kind: string;
  onRemove: () => void;
}) {
  return (
    <div className="plan-row project-row" data-testid="project-row" data-recipe={row.recipe}>
      <div className="project-main">
        <span className="project-title">{title}</span>
        <span className="project-kind" data-testid="project-kind">
          {kind}
        </span>
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        aria-label="Remove project"
        data-testid="plan-remove"
        onClick={onRemove}
      >
        <IconTrash />
      </button>
    </div>
  );
}

/** The "+ Add a project" picker over the project-eligible index. */
function ProjectAdd({
  options,
  onAdd,
}: {
  options: { value: string; label: string; sub: string }[];
  onAdd: (slug: string) => void;
}) {
  const [picking, setPicking] = React.useState(false);
  return (
    <div className="project-add">
      {picking ? (
        <span className="mp-recipe-combo">
          <Combobox
            options={options}
            autoFocus
            placeholder="Search bakes, desserts, drinks…"
            ariaLabel="Add a project"
            emptyText="No match"
            onSelect={(slug) => {
              onAdd(slug);
              setPicking(false);
            }}
            onCancel={() => setPicking(false)}
          />
        </span>
      ) : (
        <button
          type="button"
          className="plan-add-slot"
          data-testid="add-project"
          onClick={() => setPicking(true)}
        >
          <IconPlus /> Add a project
        </button>
      )}
    </div>
  );
}

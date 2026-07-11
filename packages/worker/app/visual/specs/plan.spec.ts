// Meal plan (member-app-core 7.6, meal-plan-page): the set-op interactions the union-only
// add could never express — removing a side chip and clearing a planned date — plus the
// meal-dimension redesign over the D26-final row ops: the 7×3 empty-slots grid with its MOVE
// / explicit "add again" / occupied-slot resolutions, the beyond-horizon "Later" strip, and
// projects with course-derived kind labels. The interaction specs SELF-PROVISION their rows
// through the ops endpoint (workers:1, shared local D1 — never rely on seed-row survival).
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";
import { isoInDays } from "../pages/plan.page";

const RECIPE = SEED.recipe.slug;

test.beforeEach(async ({ asMember, planPage }) => {
  await asMember();
  await planPage.goto();
  await planPage.landmark();
});

test("side add + REMOVE ride the set op (replace-wholesale sides)", async ({ planPage }) => {
  await planPage.ensureRow(RECIPE, SEED.recipe.title);
  await planPage.addSide(RECIPE, "garlic bread");
  await planPage.expectSides(RECIPE, ["garlic bread"]);
  await planPage.addSide(RECIPE, "house salad");
  await planPage.expectSides(RECIPE, ["garlic bread", "house salad"]);
  await planPage.removeSide(RECIPE, "garlic bread");
  await planPage.expectSides(RECIPE, ["house salad"]);
  await planPage.captureForReview("plan-sides");
});

test("setting a date schedules the night; clearing it unschedules (explicit null)", async ({
  planPage,
}) => {
  await planPage.ensureRow(RECIPE, SEED.recipe.title);
  await planPage.setDate(RECIPE, "2027-01-15");
  await planPage.expectInGroup(RECIPE, "scheduled");
  await planPage.clearDate(RECIPE);
  await planPage.expectInGroup(RECIPE, "unscheduled");
  // The clear survives a reload — it was persisted, not just local state.
  await planPage.goto();
  await planPage.expectInGroup(RECIPE, "unscheduled");
  await planPage.expectDate(RECIPE, "");
});

test("removing the last row empties the plan", async ({ planPage }) => {
  await planPage.ensureRow(RECIPE, SEED.recipe.title);
  // Clear every OTHER row (seed extras + shared-DB leftovers) so removing this one is the
  // last removal and the empty state is reached deterministically.
  await planPage.keepOnly(RECIPE);
  await planPage.goto();
  await planPage.removeRow(RECIPE);
  await planPage.expectEmpty();
});

test("add-again mints a second slot — two ×2 siblings that persist across reload", async ({
  planPage,
}) => {
  const R = "viz-fish-tacos";
  const TITLE = "Charred Fish Tacos";
  // One unscheduled row, so picking the recipe into a slot MOVES it (the default).
  await planPage.clearRecipe(R);
  await planPage.writePlanOps([{ op: "add", id: "pw-t1-fish", recipe: R, meal: "dinner" }]);
  await planPage.goto();
  await planPage.toggleEmptySlots();

  const day = isoInDays(1);
  await planPage.addToSlot(day, "dinner", TITLE);
  // The move is legible (banner) and offers the explicit duplication opt-in.
  await expect(planPage.resolveBanner(day, "dinner")).toBeVisible();
  await planPage.clickAddAgain(day, "dinner");
  // Two sibling rows now — the ×2 badge marks them.
  await planPage.expectDupBadge(day, "dinner", 2);

  // Persisted, not just local: reload, re-open the grid, still ×2.
  await planPage.goto();
  await planPage.toggleEmptySlots();
  await planPage.expectDupBadge(day, "dinner", 2);
  await planPage.captureForReview("plan-add-again");

  await planPage.clearRecipe(R);
});

test("picking an already-planned recipe MOVES it with sides kept, no duplicate", async ({
  planPage,
}) => {
  const R = "viz-cacio-pepe";
  const TITLE = "Cacio e Pepe";
  await planPage.clearRecipe(R);
  await planPage.writePlanOps([{ op: "add", id: "pw-t2-cacio", recipe: R, meal: "lunch", sides: ["garlic bread"] }]);
  await planPage.goto();
  await planPage.toggleEmptySlots();

  const day = isoInDays(3);
  await planPage.addToSlot(day, "lunch", TITLE);
  // Moved into the slot, its side preserved, and NOT duplicated (no ×2 badge).
  await planPage.expectSlotSide(day, "lunch", "garlic bread");
  await planPage.expectNoDupBadge(day, "lunch");
  await planPage.captureForReview("plan-move-preserves-sides");

  await planPage.clearRecipe(R);
});

test("picking into an occupied slot moves the occupant to Unscheduled — never deletes it", async ({
  planPage,
}) => {
  const O = "viz-spinach-curry";
  const OTITLE = "Spinach Coconut Curry";
  const R = "viz-beef-ragu";
  const RTITLE = "Sunday Beef Ragu";
  await planPage.clearRecipe(O);
  await planPage.clearRecipe(R);
  const day = isoInDays(4);
  await planPage.writePlanOps([{ op: "add", id: "pw-plan-occupant", recipe: O, meal: "dinner", planned_for: day }]);
  await planPage.goto();
  await planPage.toggleEmptySlots();

  await planPage.changeSlotRecipe(day, "dinner", RTITLE);
  await planPage.expectToast(`Moved ${OTITLE} to Unscheduled`);
  // The occupant is NOT deleted — it lands in Unscheduled…
  await planPage.expectInGroup(O, "unscheduled");
  // …and the new recipe takes the slot.
  await expect(planPage.slot(day, "dinner")).toHaveAttribute("data-recipe", R);
  await planPage.captureForReview("plan-occupied-slot");

  await planPage.clearRecipe(O);
  await planPage.clearRecipe(R);
});

test("a beyond-horizon row stays visible in Later; editing its date pulls it into the grid", async ({
  planPage,
}) => {
  const R = "viz-beef-ragu";
  await planPage.clearRecipe(R);
  await planPage.writePlanOps([{ op: "add", id: "pw-plan-later-row", recipe: R, meal: "dinner", planned_for: isoInDays(12) }]);
  await planPage.goto();
  await planPage.toggleEmptySlots();

  await planPage.expectInLater(R);
  // Editing the date into the 7-day window pulls it up into the grid.
  const pull = isoInDays(5);
  await planPage.setLaterDate(R, pull);
  await planPage.expectNotInLater(R);
  await expect(planPage.slot(pull, "dinner")).toHaveAttribute("data-recipe", R);
  await planPage.captureForReview("plan-later-horizon");

  await planPage.clearRecipe(R);
});

test("a from_vibe row renders its vibe phrase (id resolved through the palette)", async ({
  planPage,
}) => {
  const R = "viz-cacio-pepe";
  const PHRASE = "a bright citrus night";
  let vibeId = "";
  try {
    vibeId = await planPage.addVibe(PHRASE);
    await planPage.clearRecipe(R);
    await planPage.writePlanOps([{ op: "add", id: "pw-plan-fromvibe", recipe: R, meal: "dinner", from_vibe: vibeId }]);
    await planPage.goto();
    await planPage.expectVibeProvenance(R, PHRASE);
    await planPage.captureForReview("plan-from-vibe");
  } finally {
    // Leave the shared palette EMPTY again (a later spec asserts the empty palette).
    await planPage.clearRecipe(R);
    if (vibeId) await planPage.removeVibe(vibeId);
  }
});

test("adding a project surfaces a course-kinded row that stays out of the plan badge", async ({
  planPage,
}) => {
  const PICK = SEED.app.plan.project.pick;
  await planPage.clearRecipe(PICK.slug); // free the picker option (not already a project)
  await planPage.goto();

  const before = await planPage.planBadgeCount();
  await planPage.addProject(PICK.title);
  await expect(planPage.projectRow(PICK.title)).toBeVisible();
  await planPage.expectProjectKind(PICK.title, PICK.kind);
  // Projects ride the meal column but are not schedulable — the badge is unchanged.
  expect(await planPage.planBadgeCount()).toBe(before);
  await planPage.captureForReview("plan-projects");

  await planPage.clearRecipe(PICK.slug);
});

test("an ambiguous add (recipe already in 2 slots) surfaces a conflict toast, changing nothing", async ({
  planPage,
}) => {
  const R = "viz-fish-tacos";
  const TITLE = "Charred Fish Tacos";
  await planPage.clearRecipe(R);
  // Two rows for the recipe → a plain add can't coalesce (D26: >1 match is a conflict).
  await planPage.writePlanOps([
    { op: "add", id: "pw-plan-ambig-a", recipe: R, meal: "dinner", planned_for: isoInDays(1) },
    { op: "add", id: "pw-plan-ambig-b", recipe: R, meal: "dinner", planned_for: isoInDays(2), duplicate: true },
  ]);
  await planPage.goto();
  await planPage.toggleEmptySlots();

  const day = isoInDays(4);
  await planPage.addToSlot(day, "lunch", TITLE);
  await planPage.expectToast("more than one slot"); // a failure toast, not a silent no-op
  await expect(planPage.slot(day, "lunch").locator('[data-testid="plan-row"]')).toHaveCount(0);
  await planPage.captureForReview("plan-ambiguous-add");

  await planPage.clearRecipe(R);
});

test("adding a project does NOT move an already-planned dinner (explicit duplicate)", async ({
  planPage,
}) => {
  const PICK = SEED.app.plan.project.pick;
  await planPage.clearRecipe(PICK.slug);
  // The project-eligible recipe is ALSO scheduled as a dinner.
  await planPage.writePlanOps([
    { op: "add", id: "pw-plan-galette-dinner", recipe: PICK.slug, meal: "dinner", planned_for: isoInDays(2) },
  ]);
  await planPage.goto();

  await planPage.addProject(PICK.title);
  // A distinct project row appears…
  await planPage.expectProjectKind(PICK.title, PICK.kind);
  // …and the dinner row survives (the add was an explicit duplicate, not a coalesce/move).
  await planPage.expectInGroup(PICK.slug, "scheduled");
  await planPage.captureForReview("plan-project-no-move");

  await planPage.clearRecipe(PICK.slug);
});

test("the grid stacks two recipes on the same night and meal — neither is hidden", async ({
  planPage,
}) => {
  const A = "viz-fish-tacos";
  const B = "viz-cacio-pepe";
  await planPage.clearRecipe(A);
  await planPage.clearRecipe(B);
  const day = isoInDays(5);
  await planPage.writePlanOps([
    { op: "add", id: "pw-plan-stack-a", recipe: A, meal: "dinner", planned_for: day },
    { op: "add", id: "pw-plan-stack-b", recipe: B, meal: "dinner", planned_for: day },
  ]);
  await planPage.goto();
  await planPage.toggleEmptySlots();

  await planPage.expectSlotRecipe(day, "dinner", A);
  await planPage.expectSlotRecipe(day, "dinner", B);
  await planPage.captureForReview("plan-stacked-slot");

  await planPage.clearRecipe(A);
  await planPage.clearRecipe(B);
});

test("an unresolved from_vibe id renders no provenance chip", async ({ planPage }) => {
  const R = "viz-fish-tacos";
  await planPage.clearRecipe(R);
  await planPage.writePlanOps([
    { op: "add", id: "pw-plan-noresolve", recipe: R, meal: "dinner", from_vibe: "pw-nonexistent-vibe" },
  ]);
  await planPage.goto();

  await planPage.expectNoVibeChip(R);
  await planPage.captureForReview("plan-unresolved-vibe");

  await planPage.clearRecipe(R);
});

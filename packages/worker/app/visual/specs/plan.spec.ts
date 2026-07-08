// Meal plan (member-app-core 7.6, D3): the set-op interactions the union-only add
// could never express — removing a side chip and clearing a planned date — plus
// group movement and row removal. Self-provisioning: each test ensures its row
// exists via the add-recipe combobox (an earlier spec's log-a-cook legitimately
// clears the seeded planned row — the transactional clear is product behavior).
import { test } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

const RECIPE = SEED.recipe.slug;

test.beforeEach(async ({ asMember, planPage }) => {
  await asMember();
  await planPage.goto();
  await planPage.landmark();
  await planPage.ensureRow(RECIPE, SEED.recipe.title);
});

test("side add + REMOVE ride the set op (replace-wholesale sides)", async ({ planPage }) => {
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
  await planPage.setDate(RECIPE, "2027-01-15");
  await planPage.expectInGroup(RECIPE, "scheduled");
  await planPage.clearDate(RECIPE);
  await planPage.expectInGroup(RECIPE, "unscheduled");
  // The clear survives a reload — it was persisted, not just local state.
  await planPage.goto();
  await planPage.expectInGroup(RECIPE, "unscheduled");
  await planPage.expectDate(RECIPE, "");
});

test("removing the row empties the plan", async ({ planPage }) => {
  await planPage.removeRow(RECIPE);
  await planPage.expectEmpty();
});

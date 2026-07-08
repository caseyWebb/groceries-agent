// Cooking log (member-app-core 7.9, D4): the near-empty production posture, logging
// a cook through the dedupe-guarded POST, and the delete-by-id member correction.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember, logPage }) => {
  await asMember();
  await logPage.goto();
  await logPage.landmark();
});

test("logging a cook prepends today's row; removing it heals the list", async ({ logPage }) => {
  await logPage.rows().first().waitFor(); // the seeded history has rendered
  const before = await logPage.rows().count(); // the seed's near-empty history
  await logPage.logCook(SEED.recipe.title);
  await expect(logPage.rows()).toHaveCount(before + 1);
  await logPage.captureForReview("log-after-cook");
  await logPage.removeFirst();
  await expect(logPage.rows()).toHaveCount(before);
});

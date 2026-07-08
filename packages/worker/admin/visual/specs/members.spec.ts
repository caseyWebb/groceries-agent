// Members interactions: the invite dialog (the shared Radix Dialog, located by its
// accessible name) and the pending-member detail state.
import { test, expect } from "../fixtures";
import { SEED } from "../seed.mjs";

test("invite opens as a dialog", async ({ membersPage }) => {
  await membersPage.goto();
  const dialog = await membersPage.openInviteDialog();
  await expect(dialog.title("Invite member")).toBeVisible();
  await membersPage.captureForReview("members-dialog");
});

test("pending member detail shows the not-yet-connected state", async ({ membersPage }) => {
  const detail = membersPage.memberDetail(SEED.members.pending);
  await detail.goto();
  await detail.landmark();
  await detail.expectPendingEmptyState();
});

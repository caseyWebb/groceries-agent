// Pantry (member-app-core 7.8): the client-derived needs-verification section and
// the verify flow that clears the nudge (mark_pantry_verified stamps today).
import { test } from "../fixtures";

test.beforeEach(async ({ asMember, pantryPage }) => {
  await asMember();
  await pantryPage.goto();
  await pantryPage.landmark();
});

test("a stale perishable sits in needs-verification; verifying clears the nudge", async ({
  pantryPage,
}) => {
  await pantryPage.expectNeedsVerification("Baby spinach"); // seeded 10d unchecked produce
  await pantryPage.captureForReview("pantry-needs-verification");
  await pantryPage.verify("Baby spinach");
  await pantryPage.expectVerified("Baby spinach");
});

test("the add form lands an item in its category group", async ({ pantryPage }) => {
  await pantryPage.addItem("Greek yogurt", "dairy", "1 tub");
  await pantryPage.item("Greek yogurt").waitFor();
});

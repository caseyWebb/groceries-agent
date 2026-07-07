// Cookbook browse/search + recipe detail (member-app-core 7.3/7.4): the browse
// sections render seeded data, keyword search narrows in place, the detail page
// serves the corpus body + the Cook-with-Claude deep link, favorites are an
// explicit set that lands on the favorites page, and the D14 notes flow works.
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test.beforeEach(async ({ asMember }) => {
  await asMember();
});

test("browse renders the all-recipes list; search narrows and clears", async ({ cookbookPage }) => {
  await cookbookPage.landmark();
  await expect(cookbookPage.row(SEED.recipe.slug)).toBeVisible();
  await cookbookPage.search("salmon");
  await cookbookPage.expectResultCount(1);
  await cookbookPage.search("zebra stew");
  await cookbookPage.expectNoMatches();
});

test("the detail page renders the corpus body, facets, and the deep link", async ({ cookbookPage, recipePage }) => {
  await cookbookPage.openRecipe(SEED.recipe.slug);
  await recipePage.landmark();
  await recipePage.expectTitle(SEED.recipe.title);
  await recipePage.expectBodyContains("Whisk the miso glaze");
  await recipePage.expectCookDeepLink(SEED.recipe.slug);
  await recipePage.expectCommunityNote(SEED.app.note.body);
  await recipePage.captureForReview("recipe-detail-full");
});

test("notes: add an own note (client-minted identity), then delete it", async ({ recipePage }) => {
  await recipePage.goto();
  await recipePage.addNote("Sear hotter next time.", { tag: "tweak" });
  await recipePage.expectOwnNote("Sear hotter next time.");
  await recipePage.deleteFirstOwnNote();
  await recipePage.expectNoOwnNotes();
});

test("favorite is an explicit set that shows up on the favorites page", async ({
  cookbookPage,
  favoritesPage,
}) => {
  // Explicit-set semantics: drive OFF then ON regardless of the seeded state —
  // each click sends the computed target, so the sequence converges either way.
  await cookbookPage.ensureFavorite(SEED.recipe.slug, false);
  await cookbookPage.ensureFavorite(SEED.recipe.slug, true);
  await favoritesPage.goto();
  await favoritesPage.expectRecipe(SEED.recipe.slug);
  await favoritesPage.captureForReview("favorites-populated");
});

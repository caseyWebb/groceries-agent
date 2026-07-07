// Grocery (member-app-core 7.7, D9/W3): category groups, the explicit in-cart set in
// both directions, Clear purchased (terminal removal), the bottom add-row, and the
// status guard — the member surface can NEVER mint `ordered` (structured rejection).
import { test, expect } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

const G = SEED.app.grocery;

test.beforeEach(async ({ asMember, groceryPage }) => {
  await asMember();
  await groceryPage.goto();
  await groceryPage.landmark();
});

test("items group by category; household goods sit apart from groceries", async ({ groceryPage }) => {
  await groceryPage.expectInCategoryGroup(G.active[0], "grocery");
  await groceryPage.expectInCategoryGroup(G.household, "household");
  await groceryPage.expectInCartGroup(G.inCart); // the seeded in_cart row
});

test("the in-cart control is an explicit set, both directions", async ({ groceryPage }) => {
  await groceryPage.toggleCart(G.active[1]);
  await groceryPage.expectInCartGroup(G.active[1]);
  await groceryPage.toggleCart(G.active[1]); // back to the list
  await groceryPage.expectInCategoryGroup(G.active[1], "grocery");
});

test("Clear purchased removes each in_cart row (received is terminal removal)", async ({
  groceryPage,
}) => {
  await groceryPage.clearPurchased();
  await expect(groceryPage.item(G.inCart)).toHaveCount(0);
});

test("the bottom add-row appends an item into its category group", async ({ groceryPage }) => {
  await groceryPage.addItem("halloumi", "2 blocks");
  await groceryPage.expectInCategoryGroup("halloumi", "grocery");
  await groceryPage.captureForReview("grocery-after-add");
});

test("W3: no interaction can mint ordered — a forced write is refused structurally", async ({
  groceryPage,
}) => {
  // Straight to ordered from active: the member boundary rejects it.
  const fromActive = await groceryPage.attemptOrderedWrite(G.active[0]);
  expect(fromActive.status).toBe(400);
  expect(fromActive.error).toBe("validation_failed");
  // Even from in_cart, the member surface refuses (ordered belongs to the order flow).
  await groceryPage.toggleCart(G.active[0]);
  const fromInCart = await groceryPage.attemptOrderedWrite(G.active[0]);
  expect(fromInCart.status).toBe(400);
  expect(fromInCart.error).toBe("validation_failed");
});

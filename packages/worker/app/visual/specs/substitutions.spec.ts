import { test, expect } from "../fixtures";
import type { GroceryListData } from "../../../../contract/src/grocery";

const original: GroceryListData = {
  contract_version: 1, snapshot_version: "sub-v1", as_of: "2026-07-12T12:00:00Z",
  lines: [{ key: "halloumi", name: "Halloumi", quantity: 1, kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 1, updated_at: null, for_recipes: [], substitutes: [{ id: "paneer", label: "Paneer" }] }],
  to_buy: ["halloumi"], pantry_covered: [], in_cart_groups: [], underived: [], location: null, flyer_as_of: null,
  counts: { to_buy: 1, checked: 0, in_carts: 0, recipes: 0 },
};
const swapped: GroceryListData = {
  ...original, snapshot_version: "sub-v2", to_buy: ["paneer"],
  lines: [{ ...original.lines[0], key: "paneer", name: "Paneer", row_version: 2, substitutes: [] }],
};

test("substitution confirmation exposes a durable Undo action", async ({ asMember, groceryPage, page }) => {
  await asMember();
  let current = original;
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: current }));
  let undone = false;
  await page.route("**/api/grocery/substitution", async (route) => {
    const body = route.request().postDataJSON() as { undo?: boolean };
    undone = body.undo === true;
    current = undone ? { ...original, snapshot_version: "sub-v3" } : swapped;
    await route.fulfill({ json: { snapshot: current } });
  });
  await groceryPage.goto(); await groceryPage.landmark();
  await groceryPage.item("halloumi").getByRole("button", { name: "Swap in" }).click();
  await expect(groceryPage.item("paneer")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => undone).toBe(true);
  await expect(groceryPage.item("halloumi")).toBeVisible();
});

test("pantry actions show freshness and Buy-anyway Undo", async ({ asMember, groceryPage, page }) => {
  await asMember();
  const pantry: GroceryListData = { ...original, lines: [], to_buy: [], pantry_covered: [{ key: "onion", name: "Onion", for_recipes: [], freshness: "worth_a_look", freshness_reason: "last verified 8 days ago", on_hand: {}, buy_anyway: false }] };
  let current = pantry;
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: current }));
  await page.route("**/api/grocery/coverage", async (route) => {
    const body = route.request().postDataJSON() as { enabled: boolean };
    current = body.enabled ? { ...pantry, snapshot_version: "pantry-v2", pantry_covered: [], lines: [{ ...original.lines[0], key: "onion", name: "Onion" }], to_buy: ["onion"] } : { ...pantry, snapshot_version: "pantry-v3" };
    await route.fulfill({ json: { snapshot: current } });
  });
  await groceryPage.goto(); await groceryPage.landmark();
  await expect(groceryPage.coveredItem("onion")).toContainText("last verified 8 days ago");
  await groceryPage.coveredItem("onion").getByRole("button", { name: "Buy anyway" }).click();
  await expect(groceryPage.item("onion")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(groceryPage.coveredItem("onion")).toBeVisible();
});

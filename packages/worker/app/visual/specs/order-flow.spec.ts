import { test, expect } from "../fixtures";
import type { GroceryListData } from "../../../../contract/src/grocery";

const base: GroceryListData = {
  contract_version: 1, snapshot_version: "orders-v1", as_of: "2026-07-12T12:00:00Z",
  lines: [], to_buy: [], pantry_covered: [], underived: [], location: null, flyer_as_of: null,
  counts: { to_buy: 0, checked: 0, in_carts: 2, recipes: 0 },
  in_cart_groups: [{
    send_id: "send-1", store: "Kroger", location_id: "1", fulfillment: "kroger_online",
    sent_at: "2026-07-10T12:00:00Z", placed_at: null, awaiting_confirmation: true,
    estimated_total: 8, flyer_savings: 1, can_mark_placed: true,
    lines: [
      { key: "milk", name: "Milk", quantity: 1, row_version: 2, unit_price: 4, savings: 1 },
      { key: "eggs", name: "Eggs", quantity: 1, row_version: 3, unit_price: 4, savings: 0 },
    ],
  }],
};

test.beforeEach(async ({ asMember }) => { await asMember(); });

test("Back to list removes only the selected send line", async ({ groceryPage, page }) => {
  let current = base;
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: current }));
  await page.route("**/api/grocery/relist", (route) => {
    current = {
    ...base, snapshot_version: "orders-v2",
    lines: [{ key: "milk", name: "Milk", quantity: 1, kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 3, updated_at: "2026-07-12T12:01:00Z", for_recipes: [] }],
    to_buy: ["milk"], counts: { ...base.counts, to_buy: 1, in_carts: 1 },
    in_cart_groups: [{ ...base.in_cart_groups[0], lines: [base.in_cart_groups[0].lines[1]] }],
    };
    return route.fulfill({ json: { snapshot: current } });
  });
  await groceryPage.goto(); await groceryPage.landmark();
  await groceryPage.cartItem("milk").getByRole("button", { name: "Back to list" }).click();
  await expect(groceryPage.item("milk")).toBeVisible();
  await expect(groceryPage.cartItem("eggs")).toBeVisible();
});

test("exact mark-placed conflicts replace the stale snapshot and stay honest", async ({ groceryPage, page }) => {
  await page.route("**/api/grocery/view", (route) => route.fulfill({ json: base }));
  await page.route("**/api/grocery/mark-placed", (route) => route.fulfill({
    status: 409, contentType: "application/json",
    body: JSON.stringify({ error: "conflict", message: "Send membership changed", snapshot: { ...base, snapshot_version: "orders-current", in_cart_groups: [{ ...base.in_cart_groups[0], lines: [base.in_cart_groups[0].lines[1]] }], counts: { ...base.counts, in_carts: 1 } } }),
  }));
  await groceryPage.goto(); await groceryPage.landmark();
  await page.getByRole("button", { name: "Mark order placed" }).click();
  await expect(page.getByRole("alert")).toContainText("Send membership changed");
  await expect(groceryPage.cartItem("milk")).toHaveCount(0);
  await expect(groceryPage.cartItem("eggs")).toBeVisible();
});

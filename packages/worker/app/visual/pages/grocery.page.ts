// Grocery list (member-app-core 7.7, D9): category groups, the bottom add-row, the
// explicit in-cart set, remove, and Clear purchased (removal — received is terminal).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class GroceryPage extends AppPage {
  readonly path = "/grocery";
  readonly area = "grocery";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("grocery-page")).toBeVisible();
  }

  item(name: string): Locator {
    return this.page.locator(`[data-testid="grocery-item"][data-name="${name}"]`);
  }

  async toggleCart(name: string): Promise<void> {
    await this.item(name).getByTestId("cart-toggle").click();
  }

  async expectInCartGroup(name: string): Promise<void> {
    await expect(
      this.page.getByTestId("grocery-in-cart").locator(`[data-testid="grocery-item"][data-name="${name}"]`),
    ).toBeVisible();
  }

  async expectInCategoryGroup(name: string, kind: "grocery" | "household" | "other"): Promise<void> {
    await expect(
      this.page.getByTestId(`grocery-group-${kind}`).locator(`[data-testid="grocery-item"][data-name="${name}"]`),
    ).toBeVisible();
  }

  async addItem(name: string, qty?: string): Promise<void> {
    await this.page.getByLabel("Item name").fill(name);
    if (qty) await this.page.getByLabel("Quantity").fill(qty);
    await this.page.getByLabel("Item name").press("Enter");
  }

  async clearPurchased(): Promise<void> {
    await this.page.getByTestId("clear-purchased").click();
  }

  /** The W3 boundary check, through the BROWSER's session-authenticated fetch
   *  (the __Host- session cookie only rides browser requests — Playwright's
   *  request context refuses Secure cookies over http): a write of status
   *  "ordered" is refused with the structured error. */
  async attemptOrderedWrite(name: string): Promise<{ status: number; error: string }> {
    return this.page.evaluate(async (itemName: string) => {
      const res = await fetch(`/api/grocery/items/${encodeURIComponent(itemName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ status: "ordered" }),
      });
      const body = (await res.json()) as { error?: string };
      return { status: res.status, error: body.error ?? "" };
    }, name);
  }
}

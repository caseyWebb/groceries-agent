// Pantry (member-app-core 7.8): the needs-verification section (client-derived from
// perishable category + staleness), category groups, add form, verify, remove.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class PantryPage extends AppPage {
  readonly path = "/pantry";
  readonly area = "pantry";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("pantry-page")).toBeVisible();
  }

  item(name: string): Locator {
    return this.page.locator(`[data-testid="pantry-item"][data-name="${name}"]`);
  }

  async expectNeedsVerification(name: string): Promise<void> {
    await expect(
      this.page.getByTestId("verify-section").locator(`[data-testid="pantry-item"][data-name="${name}"]`),
    ).toBeVisible();
  }

  async verify(name: string): Promise<void> {
    await this.item(name).getByTestId("pantry-verify").click();
  }

  /** Verifying stamps today — the item leaves the nudge section on the next render. */
  async expectVerified(name: string): Promise<void> {
    const inSection = this.page.getByTestId("verify-section").locator(`[data-testid="pantry-item"][data-name="${name}"]`);
    await expect(inSection).toHaveCount(0);
    await expect(this.item(name)).toBeVisible(); // still in the pantry, in its category group
  }

  async addItem(name: string, category: string, qty?: string): Promise<void> {
    await this.page.getByTestId("pantry-add").getByLabel("Item").fill(name);
    await this.page.getByTestId("pantry-add").getByLabel("Category").fill(category);
    if (qty) await this.page.getByTestId("pantry-add").getByLabel("Quantity").fill(qty);
    await this.page.getByTestId("pantry-add").getByRole("button", { name: "Add" }).click();
  }
}

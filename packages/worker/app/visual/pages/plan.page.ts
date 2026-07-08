// Meal plan (member-app-core 7.6): scheduled/unscheduled groups, the set-op edits —
// date set/CLEAR, side add/REMOVE — row removal, and the add-recipe combobox.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class PlanPage extends AppPage {
  readonly path = "/plan";
  readonly area = "plan";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("plan-page")).toBeVisible();
  }

  row(recipe: string): Locator {
    return this.page.locator(`[data-testid="plan-row"][data-recipe="${recipe}"]`);
  }

  /** Make sure the recipe is planned (add it through the combobox when absent). */
  async ensureRow(recipe: string, title: string): Promise<void> {
    const row = this.row(recipe);
    const input = this.page.locator(".plan-add-inline").getByRole("combobox");
    await input.fill(title);
    // Wait for whichever renders first: the existing plan row (the plan query was
    // still loading when we checked) or the combobox option (index loaded, recipe
    // not planned). An immediate count()/Enter races both queries.
    const option = this.page.locator(".cb-option", { hasText: title }).first();
    await row.or(option).first().waitFor();
    if ((await row.count()) === 0) {
      await option.click();
      await row.waitFor();
    } else {
      await input.press("Escape");
    }
  }

  async setDate(recipe: string, isoDay: string): Promise<void> {
    await this.row(recipe).getByTestId("plan-date").fill(isoDay);
  }

  async addSide(recipe: string, side: string): Promise<void> {
    await this.row(recipe).getByTestId("side-add").click();
    const input = this.row(recipe).getByRole("combobox");
    await input.fill(side);
    await input.press("Enter");
  }

  async removeSide(recipe: string, side: string): Promise<void> {
    await this.row(recipe).getByLabel(`Remove side ${side}`).click();
  }

  async expectSides(recipe: string, sides: string[]): Promise<void> {
    await expect(this.row(recipe).getByTestId("side-chip")).toHaveCount(sides.length);
    for (const s of sides) await expect(this.row(recipe).getByTestId("side-chip").filter({ hasText: s })).toBeVisible();
  }

  async clearDate(recipe: string): Promise<void> {
    await this.row(recipe).getByTestId("plan-date").fill("");
  }

  async expectDate(recipe: string, value: string): Promise<void> {
    await expect(this.row(recipe).getByTestId("plan-date")).toHaveValue(value);
  }

  /** The row's group — Scheduled vs Unscheduled. */
  async expectInGroup(recipe: string, group: "scheduled" | "unscheduled"): Promise<void> {
    await expect(
      this.page.getByTestId(`plan-${group}`).locator(`[data-testid="plan-row"][data-recipe="${recipe}"]`),
    ).toBeVisible();
  }

  async removeRow(recipe: string): Promise<void> {
    await this.row(recipe).getByTestId("plan-remove").click();
  }

  async expectEmpty(): Promise<void> {
    await expect(this.page.locator(".empty")).toContainText("Nothing planned");
  }
}

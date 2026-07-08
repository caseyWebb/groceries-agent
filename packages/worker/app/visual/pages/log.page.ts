// Cooking log (member-app-core 7.9): most-recent-first rows, the log-a-cook select,
// per-row remove — near-empty in production, so the seed keeps it small.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class LogPage extends AppPage {
  readonly path = "/log";
  readonly area = "log";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("log-page")).toBeVisible();
  }

  rows(): Locator {
    return this.page.getByTestId("log-row");
  }

  async logCook(title: string): Promise<void> {
    await this.page.getByLabel("Recipe cooked").selectOption({ label: title });
    await this.page.getByRole("button", { name: "Log" }).click();
  }

  async removeFirst(): Promise<void> {
    await this.rows().first().getByTestId("log-remove").click();
  }
}

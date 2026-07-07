// The authenticated app shell (member-app-core 7.1): sidebar nav + account menu.
// Reaching its landmark proves the whoami boot check resolved a session; the nav
// helpers are how specs move between areas without addressing URLs.
import { expect } from "@playwright/test";
import { AppPage } from "./base.page";

export class ShellPage extends AppPage {
  readonly path = "/";
  readonly area = "shell";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("app-shell")).toBeVisible();
  }

  /** The sidebar shows the signed-in member in the account button. */
  async expectSignedInAs(id: string): Promise<void> {
    await expect(this.page.getByTestId("account-menu")).toContainText(`@${id}`);
  }

  async openAccountMenu(): Promise<void> {
    await this.page.getByTestId("account-menu").click();
    await expect(this.page.getByTestId("account-menu-panel")).toBeVisible();
  }

  /** The account menu carries the member's Kroger link badge. */
  async expectKrogerBadge(linked: boolean): Promise<void> {
    await expect(this.page.getByTestId("kroger-badge")).toContainText(linked ? "kroger" : "kroger unlinked");
  }

  async logout(): Promise<void> {
    await this.openAccountMenu();
    await this.page.getByTestId("logout").click();
  }

  async navTo(label: string): Promise<void> {
    await this.page.locator(".sb-link", { hasText: label }).click();
  }
}

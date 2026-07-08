// A modal dialog (the shared Radix Dialog/AlertDialog from @grocery-agent/ui — role="dialog"
// with an accessible name from its title). Construct with the dialog's root locator, e.g.
// `page.getByRole("dialog", { name: "Invite member" })`. Hydration is one-shot at app boot
// (not per-island), and triggers only render once their screen's query has resolved, so a
// plain click + visibility assertion replaces the old native-<dialog> open-retry.
import { expect, type Locator } from "@playwright/test";

export class DialogComponent {
  constructor(readonly root: Locator) {}

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible();
  }

  /** Click `trigger` and assert the dialog opened. */
  async openVia(trigger: Locator): Promise<void> {
    await trigger.click();
    await this.expectOpen();
  }

  title(text: string): Locator {
    return this.root.getByRole("heading", { name: text });
  }
}

// Pantry (member-app-core / page 06): the needs-verification section (client-derived from
// perishable category + staleness), the multi-item add grid with UX-only category/location
// autofill, the group-by Category|Location toggle, and disposition-based removal (Used /
// Mark-as-waste through the waste modal). Regular rows carry no bare trash — every removal
// is a disposition.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

/** One draft row to type into the add grid. `category`/`location` accept the Title-Case
 *  labels the datalists offer; omitting them leaves the field to recognition/blank. */
export interface DraftSpec {
  name: string;
  quantity?: string;
  category?: string;
  location?: string;
}

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
    await expect(this.item(name)).toBeVisible(); // still in the pantry, in its group
  }

  async expectRemoved(name: string): Promise<void> {
    await expect(this.item(name)).toHaveCount(0);
  }

  // --- group-by toggle ----------------------------------------------------------------

  /** Switch the group-by dimension ("Category" | "Location"). */
  async groupBy(dimension: "Category" | "Location"): Promise<void> {
    await this.page.getByTestId(`pantry-groupby-${dimension.toLowerCase()}`).click();
  }

  group(label: string): Locator {
    return this.page.locator('[data-testid="pantry-group"]', { has: this.page.locator('.group-h', { hasText: label }) });
  }

  async expectGroup(label: string): Promise<void> {
    await expect(this.group(label)).toBeVisible();
  }

  /** The rendered group headings, in DOM order (for the fixed-order location assertion). */
  async groupLabels(): Promise<string[]> {
    return this.page.locator('[data-testid="pantry-group"] .group-h').allInnerTexts();
  }

  // --- multi-item add grid ------------------------------------------------------------

  draftRow(index: number): Locator {
    return this.page.getByTestId("pantry-add").getByTestId("pantry-draft-row").nth(index);
  }

  /** Fill the add grid, one draft row per spec (a fresh row appends as each name lands, so
   *  the next index exists for the following spec). Filling the name first lets recognition
   *  pre-fill category/location before any typed override lands. */
  async addRows(specs: DraftSpec[]): Promise<void> {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const row = this.draftRow(i);
      await row.getByLabel("Item").fill(s.name);
      if (s.quantity) await row.getByLabel("Quantity").fill(s.quantity);
      if (s.category) await row.getByLabel("Category").fill(s.category);
      if (s.location) await row.getByLabel("Location").fill(s.location);
    }
  }

  async commitAdd(): Promise<void> {
    await this.page.getByTestId("pantry-add-commit").click();
  }

  /** The single-row add path (kept for the category-group smoke), routed through the grid. */
  async addItem(name: string, category: string, qty?: string): Promise<void> {
    await this.addRows([{ name, category, quantity: qty }]);
    await this.commitAdd();
  }

  // --- dispositions -------------------------------------------------------------------

  /** Primary Used = consumed → an idempotent delete (no modal). */
  async markUsed(name: string): Promise<void> {
    await this.item(name).getByTestId("pantry-used").click();
  }

  /** Menu → Mark as waste → single-tap reason (by its friendly label). */
  async markWaste(name: string, reasonLabel: string): Promise<void> {
    await this.item(name).getByTestId("pantry-menu-toggle").click();
    await this.item(name).getByTestId("pantry-waste").click();
    await expect(this.page.getByTestId("waste-modal")).toBeVisible();
    await this.page.getByTestId("waste-modal").getByTestId("waste-reason").filter({ hasText: reasonLabel }).click();
  }
}

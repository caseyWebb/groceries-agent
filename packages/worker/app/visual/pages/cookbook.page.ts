// Cookbook browse + search (member-app-core 7.3): the landing page — New-for-you +
// all-recipes sections, the debounced keyword searchbar, and the shared recipe rows
// (plan-toggle + favorite actions).
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class CookbookPage extends AppPage {
  readonly path = "/";
  readonly area = "cookbook";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("cookbook-page")).toBeVisible();
    await expect(this.page.getByLabel("Search recipes")).toBeVisible();
  }

  row(slug: string): Locator {
    return this.page.locator(`[data-testid="recipe-row"][data-slug="${slug}"]`).first();
  }

  async search(q: string): Promise<void> {
    await this.page.getByLabel("Search recipes").fill(q);
  }

  async expectResultCount(n: number): Promise<void> {
    await expect(this.page.getByTestId("search-results").getByTestId("recipe-row")).toHaveCount(n);
  }

  async expectNoMatches(): Promise<void> {
    await expect(this.page.getByTestId("search-results")).toContainText("No matches");
  }

  async openRecipe(slug: string): Promise<void> {
    await this.row(slug).locator(".rrow-link").click();
  }

  async favorite(slug: string): Promise<void> {
    await this.row(slug).getByTestId("row-fav").click();
  }

  async expectFavorited(slug: string, on: boolean): Promise<void> {
    await expect(this.row(slug).getByTestId("row-fav")).toHaveAttribute("aria-pressed", String(on));
  }

  /** Drive the favorite to an explicit target state regardless of the seed's. */
  async ensureFavorite(slug: string, target: boolean): Promise<void> {
    const btn = this.row(slug).getByTestId("row-fav");
    await btn.waitFor();
    if ((await btn.getAttribute("aria-pressed")) !== String(target)) await btn.click();
    await this.expectFavorited(slug, target);
  }
}

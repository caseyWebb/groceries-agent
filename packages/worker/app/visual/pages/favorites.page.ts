// Favorites (member-app-core 7.5): overlay ∩ index, with the empty state.
import { expect } from "@playwright/test";
import { AppPage } from "./base.page";

export class FavoritesPage extends AppPage {
  readonly path = "/favorites";
  readonly area = "favorites";

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("favorites-page")).toBeVisible();
  }

  async expectRecipe(slug: string): Promise<void> {
    await expect(this.page.locator(`[data-testid="recipe-row"][data-slug="${slug}"]`)).toBeVisible();
  }

  async expectCount(n: number): Promise<void> {
    await expect(this.page.getByTestId("recipe-row")).toHaveCount(n);
  }
}

// Recipe detail (member-app-core 7.4): title/facets/body, the Cook-with-Claude deep
// link, action row, the D14 notes split (own editable / community read-only), and
// the Similar section (absent when nothing is embedded — the seed's posture).
import { expect } from "@playwright/test";
import { AppPage, type Page } from "./base.page";

export class RecipePage extends AppPage {
  readonly path: string;
  readonly area = "recipe-detail";

  constructor(page: Page, slug = "") {
    super(page);
    this.path = `/recipe/${slug}`;
  }

  async landmark(): Promise<void> {
    await expect(this.page.getByTestId("recipe-detail")).toBeVisible();
    await expect(this.page.getByTestId("recipe-title")).toBeVisible();
  }

  async expectTitle(title: string): Promise<void> {
    await expect(this.page.getByTestId("recipe-title")).toHaveText(title);
  }

  async expectBodyContains(text: string): Promise<void> {
    await expect(this.page.getByTestId("recipe-body")).toContainText(text);
  }

  /** The deep link opens claude.ai with the /cook command — never an in-app model call. */
  async expectCookDeepLink(slug: string): Promise<void> {
    const href = await this.page.getByTestId("cook-with-claude").getAttribute("href");
    if (href !== `https://claude.ai/new?q=${encodeURIComponent(`/cook ${slug}`)}`) {
      throw new Error(`unexpected deep link: ${href}`);
    }
  }

  async addNote(body: string, opts: { tag?: string; priv?: boolean } = {}): Promise<void> {
    await this.page.getByLabel("Note body").fill(body);
    if (opts.tag) await this.page.getByLabel("Tag").fill(opts.tag);
    if (opts.priv) await this.page.locator(".note-priv input").check();
    await this.page.getByRole("button", { name: "Add note" }).click();
  }

  async expectOwnNote(body: string): Promise<void> {
    await expect(this.page.getByTestId("own-notes")).toContainText(body);
  }

  async expectCommunityNote(body: string): Promise<void> {
    await expect(this.page.getByTestId("community-notes")).toContainText(body);
  }

  async deleteFirstOwnNote(): Promise<void> {
    await this.page.getByTestId("note-delete").first().click();
  }

  async expectNoOwnNotes(): Promise<void> {
    await expect(this.page.getByTestId("own-notes")).toHaveCount(0);
  }

  async logAsCooked(): Promise<void> {
    await this.page.getByTestId("detail-log").click();
  }
}

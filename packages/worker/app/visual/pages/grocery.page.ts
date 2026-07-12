import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

export class GroceryPage extends AppPage {
  readonly path = "/grocery";
  readonly area = "grocery";
  async landmark(): Promise<void> { await expect(this.page.getByTestId("grocery-page")).toBeVisible(); }
  launcher(): Locator { return this.page.getByTestId("store-launcher"); }
  launcherEntry(id: string): Locator { return this.launcher().locator(`[data-testid="store-launcher-entry"][data-launcher-id="${id}"]`); }
  async launch(id: string): Promise<void> { await this.launcherEntry(id).getByRole("button").click(); }

  item(keyOrName: string): Locator { return this.page.locator(`[data-testid="grocery-line"][data-key="${keyOrName}"], [data-testid="grocery-line"][data-name="${keyOrName}"]`).first(); }
  anyItem(keyOrName: string): Locator { return this.page.locator(`[data-testid="grocery-line"][data-key="${keyOrName}"], [data-testid="grocery-line"][data-name="${keyOrName}"], [data-testid="grocery-cart-line"][data-key="${keyOrName}"]`); }
  cartItem(key: string): Locator { return this.page.locator(`[data-testid="grocery-cart-line"][data-key="${key}"]`); }
  coveredItem(key: string): Locator { return this.page.locator(`[data-testid="grocery-pantry-line"][data-key="${key}"]`); }
  async toggleChecked(keyOrName: string): Promise<void> { await this.item(keyOrName).getByRole("checkbox").click(); }
  async setGroupMode(mode: "Department" | "Recipe"): Promise<void> { await this.page.getByRole("group", { name: "Group grocery list" }).getByRole("button", { name: mode }).click(); }
  group(label: string): Locator { return this.page.locator(`[data-testid="grocery-group"][data-group="${label}"]`); }
  cartGroups(): Locator { return this.page.getByTestId("grocery-cart-group"); }
  async addItem(name: string): Promise<void> { await this.page.getByLabel("Add grocery item").fill(name); await this.page.getByLabel("Add grocery item").press("Enter"); }

  async addRow(name: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.page.evaluate(async (input) => { await fetch("/api/grocery/items", { method: "POST", headers: { "content-type": "application/json", "X-App-Csrf": "1" }, body: JSON.stringify(input) }); }, { name, ...extra });
  }
  async setPlan(recipes: string[]): Promise<void> { await this.page.evaluate(async (want) => { const { planned } = await (await fetch("/api/plan")).json() as { planned: { id: string; recipe: string }[] }; const ops: unknown[] = planned.filter((row) => !want.includes(row.recipe)).map((row) => ({ op: "remove", id: row.id })); for (const recipe of want) if (!planned.some((row) => row.recipe === recipe)) ops.push({ op: "add", recipe }); if (ops.length) await fetch("/api/plan/ops", { method: "POST", headers: { "content-type": "application/json", "X-App-Csrf": "1" }, body: JSON.stringify({ ops }) }); }, recipes); }
  async removeRow(name: string): Promise<void> { await this.page.evaluate(async (n) => { await fetch(`/api/grocery/items/${encodeURIComponent(n)}`, { method: "DELETE", headers: { "X-App-Csrf": "1" } }); }, name); }
  async setRowStatus(name: string, status: "active" | "in_cart"): Promise<void> { await this.page.evaluate(async ([n, s]) => { await fetch(`/api/grocery/items/${encodeURIComponent(n)}`, { method: "PATCH", headers: { "content-type": "application/json", "X-App-Csrf": "1" }, body: JSON.stringify({ status: s }) }); }, [name, status]); }
  async row(name: string): Promise<Record<string, unknown> | undefined> { return this.page.evaluate(async (n) => { const { items } = await (await fetch("/api/grocery")).json() as { items: Record<string, unknown>[] }; return items.find((item) => String(item.name).toLowerCase() === n.toLowerCase() || String(item.normalized_name).toLowerCase() === n.toLowerCase()); }, name); }
  async rowStatus(name: string): Promise<string | undefined> { return (await this.row(name))?.status as string | undefined; }
  async rowChecked(name: string): Promise<boolean | undefined> { const row = await this.row(name); return row ? row.checked_at != null : undefined; }
  async setStores(stores: Record<string, unknown>): Promise<void> { await this.page.evaluate(async (s) => { const res = await fetch("/api/profile/preferences"); const etag = res.headers.get("etag") ?? ""; await fetch("/api/profile/preferences", { method: "PATCH", headers: { "content-type": "application/json", "X-App-Csrf": "1", "If-Match": etag }, body: JSON.stringify({ patch: { stores: s } }) }); }, stores); }
}

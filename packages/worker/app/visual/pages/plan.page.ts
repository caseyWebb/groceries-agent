// Meal plan (member-app-core 7.6, meal-plan-page): scheduled/unscheduled groups, the
// set-op edits — date set/CLEAR, side add/REMOVE — row removal, and the add-recipe
// combobox, PLUS the meal-dimension redesign: the 7×3 empty-slots grid (move / add-again /
// occupied-slot resolution), the "Later" strip, unscheduled-by-meal add, projects, and
// from_vibe provenance. Interaction-heavy specs self-provision their rows through the ops
// endpoint (writePlanOps) so they never depend on shared-DB seed survival.
import { expect } from "@playwright/test";
import { AppPage, type Locator } from "./base.page";

/** A LOCAL calendar day `n` days from today (YYYY-MM-DD), matching the page's `localDay`
 *  horizon and the native date picker (both local, not UTC). */
export function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
    // Gate on the plan query being LOADED before deciding whether to add. The plan-page
    // landmark renders during the loading state too, so reading row.count() early races the
    // plan query: it can report 0 (still loading), commit us to clicking a combobox option,
    // then resolve with the recipe already planned — which filters that option out from under
    // the click ("element was detached from the DOM", the 30s timeout). Once the query has
    // loaded the page shows either at least one plan row or the empty state.
    await this.page.locator('[data-testid="plan-row"], .empty').first().waitFor();
    if ((await row.count()) > 0) return; // already planned — nothing to add
    // Plan is loaded and this recipe isn't in it, so its option is stable (the plan query
    // won't drop it mid-click).
    const input = this.page.locator(".plan-add-inline").getByRole("combobox");
    await input.fill(title);
    await this.page.locator(".cb-option", { hasText: title }).first().click();
    await row.waitFor();
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

  // --- meal-dimension redesign helpers (meal-plan-page) --------------------------------

  /** Toggle the "Show empty meal slots" switch (transient per-mount state). */
  async toggleEmptySlots(): Promise<void> {
    await this.page.getByTestId("empty-slots-switch").click();
  }

  /** One grid cell, addressed by its date and meal (the position IS the date). */
  slot(date: string, meal: string): Locator {
    return this.page.locator(`[data-testid="plan-slot"][data-date="${date}"][data-meal="${meal}"]`);
  }

  /** Pick a recipe into a cell through its combobox (empty slot → "+ Add Recipe"). */
  async addToSlot(date: string, meal: string, title: string): Promise<void> {
    const s = this.slot(date, meal);
    await s.locator(".plan-add-slot").click();
    await s.getByRole("combobox").fill(title);
    await this.page.locator(".cb-option", { hasText: title }).first().click();
  }

  /** Change a FILLED cell's recipe (the title button → change-recipe combobox). */
  async changeSlotRecipe(date: string, meal: string, title: string): Promise<void> {
    const s = this.slot(date, meal);
    await s.locator(".plan-title").click();
    await s.getByRole("combobox").fill(title);
    await this.page.locator(".cb-option", { hasText: title }).first().click();
  }

  async expectDupBadge(date: string, meal: string, n: number): Promise<void> {
    await expect(this.slot(date, meal).locator(".dup-badge")).toHaveText(`×${n}`);
  }

  async expectNoDupBadge(date: string, meal: string): Promise<void> {
    await expect(this.slot(date, meal).locator(".dup-badge")).toHaveCount(0);
  }

  resolveBanner(date: string, meal: string): Locator {
    return this.slot(date, meal).locator(".slot-resolve");
  }

  async clickAddAgain(date: string, meal: string): Promise<void> {
    await this.slot(date, meal).locator(".slot-resolve-btn").click();
  }

  async expectSlotSide(date: string, meal: string, side: string): Promise<void> {
    await expect(this.slot(date, meal).getByTestId("side-chip").filter({ hasText: side })).toBeVisible();
  }

  async expectToast(text: string): Promise<void> {
    await expect(this.page.getByTestId("plan-toast")).toContainText(text);
  }

  laterRow(recipe: string): Locator {
    return this.page.locator(`[data-testid="later-row"][data-recipe="${recipe}"]`);
  }

  async expectInLater(recipe: string): Promise<void> {
    await expect(this.laterRow(recipe)).toBeVisible();
  }

  async expectNotInLater(recipe: string): Promise<void> {
    await expect(this.laterRow(recipe)).toHaveCount(0);
  }

  async setLaterDate(recipe: string, isoDay: string): Promise<void> {
    await this.laterRow(recipe).getByTestId("plan-date").fill(isoDay);
  }

  /** Add a recipe under one Unscheduled meal heading (its "+ Add Recipe" picker). */
  async addUnscheduled(meal: string, title: string): Promise<void> {
    await this.page.getByTestId(`add-unscheduled-${meal}`).click();
    const combo = this.page.getByTestId("plan-unscheduled").getByRole("combobox");
    await combo.fill(title);
    await this.page.locator(".cb-option", { hasText: title }).first().click();
  }

  projectRow(title: string): Locator {
    return this.page.getByTestId("project-row").filter({ hasText: title });
  }

  async addProject(title: string): Promise<void> {
    await this.page.getByTestId("add-project").click();
    const combo = this.page.getByTestId("plan-projects").getByRole("combobox");
    await combo.fill(title);
    await this.page.locator(".cb-option", { hasText: title }).first().click();
  }

  async expectProjectKind(title: string, kind: string): Promise<void> {
    await expect(this.projectRow(title).getByTestId("project-kind")).toHaveText(kind);
  }

  async expectVibeProvenance(recipe: string, phrase: string): Promise<void> {
    await expect(this.row(recipe).getByTestId("vibe-chip")).toHaveText(`from ${phrase}`);
  }

  /** The row exists but shows NO provenance chip (an unresolved `from_vibe` id). */
  async expectNoVibeChip(recipe: string): Promise<void> {
    await expect(this.row(recipe).first()).toBeVisible();
    await expect(this.row(recipe).getByTestId("vibe-chip")).toHaveCount(0);
  }

  /** A filled grid cell contains a plan-row for the given recipe (cells stack siblings and
   *  distinct recipes — nothing is hidden). */
  async expectSlotRecipe(date: string, meal: string, recipe: string): Promise<void> {
    await expect(
      this.slot(date, meal).locator(`[data-testid="plan-row"][data-recipe="${recipe}"]`),
    ).toBeVisible();
  }

  // --- self-provisioning over the real ops endpoints (order-independent specs) ---------

  /** POST an ordered plan-ops array directly (bypasses the UI — test setup only). */
  async writePlanOps(ops: unknown[]): Promise<void> {
    await this.page.evaluate(async (body) => {
      await fetch("/api/plan/ops", {
        method: "POST",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ ops: body }),
      });
    }, ops);
  }

  /** Drop every plan row for a slug (idempotent slug-fanout remove). */
  async clearRecipe(slug: string): Promise<void> {
    await this.writePlanOps([{ op: "remove", recipe: slug }]);
  }

  /** Remove every plan row EXCEPT the named recipe (clears shared-DB leftovers so an
   *  "empties the plan" assertion is order-independent). */
  async keepOnly(recipe: string): Promise<void> {
    await this.page.evaluate(async (keep) => {
      const { planned } = (await (await fetch("/api/plan")).json()) as { planned: { id: string; recipe: string }[] };
      const ops = planned.filter((p) => p.recipe !== keep).map((p) => ({ op: "remove", id: p.id }));
      if (ops.length) {
        await fetch("/api/plan/ops", {
          method: "POST",
          headers: { "content-type": "application/json", "X-App-Csrf": "1" },
          body: JSON.stringify({ ops }),
        });
      }
    }, recipe);
  }

  /** Create a night vibe and return its slugified id (from_vibe provenance setup). */
  async addVibe(phrase: string): Promise<string> {
    return this.page.evaluate(async (vibe) => {
      const res = await fetch("/api/vibes", {
        method: "POST",
        headers: { "content-type": "application/json", "X-App-Csrf": "1" },
        body: JSON.stringify({ vibe }),
      });
      return ((await res.json()) as { id: string }).id;
    }, phrase);
  }

  async removeVibe(id: string): Promise<void> {
    await this.page.evaluate(async (vid) => {
      await fetch(`/api/vibes/${encodeURIComponent(vid)}`, { method: "DELETE", headers: { "X-App-Csrf": "1" } });
    }, id);
  }

  /** The sidebar Meal-plan badge as a number (absent badge = 0). */
  async planBadgeCount(): Promise<number> {
    const badge = this.page.locator(".sb-link", { hasText: "Meal plan" }).locator(".sb-count");
    if ((await badge.count()) === 0) return 0;
    return Number((await badge.first().textContent())?.trim() || "0");
  }
}

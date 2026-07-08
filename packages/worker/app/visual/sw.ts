// Service-worker control helper (member-app-offline D11), shared by any spec that needs
// the page CONTROLLED (not merely registered) before relying on the SW's offline
// precache-fallback for a full navigation: `registerType: "prompt"` ships with no
// `clientsClaim`, so the first load of a fresh browser context only REGISTERS the SW —
// control only takes effect on the NEXT navigation.
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Wait for SW activation, then reload once so the page becomes controlled. */
export async function becomeControlled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });
  // domcontentloaded: under SW control page.route can no longer abort the theme's
  // external font import, so never gate on the full load event.
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

// The prompt-to-reload / version-skew UX (member-app-offline D7, D11). Service
// workers are BLOCKED here so `page.route` interception is classical — the harness
// stamps both sides `pw-harness`, and this spec fabricates a DIFFERING `X-App-Build`
// to drive the skew store.
//
// HONEST SPLIT (recorded per D11): a genuinely WAITING second SW build is not
// fabricated in the harness (it would need two full builds swapped mid-test). The
// `needRefresh` trigger is library-provided (vite-plugin-pwa's registerSW contract)
// and drives the SAME banner component and the SAME member-initiated action this spec
// exercises through the skew trigger; the SW-side offline reality (precache serving
// the shell) is asserted for real by offline.spec.ts.
import { test, expect } from "../fixtures";

test.use({ serviceWorkers: "block" });

test("a fabricated build skew renders the reload prompt, and only the member's action reloads", async ({
  page,
  loginPage,
  shellPage,
}) => {
  // The login screen's one-shot GET /api/version answers with a DIFFERENT stamped id.
  await page.route("**/api/version", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "X-App-Build": "pw-other-build" },
      body: JSON.stringify({ build: "pw-other-build" }),
    }),
  );
  await loginPage.goto();
  await loginPage.landmark();
  await expect(shellPage.reloadBanner()).toBeVisible();

  // Nothing auto-reloads: the page is still the same document while the banner shows.
  await page.evaluate(() => {
    (window as { __preReload?: boolean }).__preReload = true;
  });
  await expect(shellPage.reloadBanner()).toBeVisible();
  expect(await page.evaluate(() => (window as { __preReload?: boolean }).__preReload)).toBe(true);

  // Stop fabricating, then act on the banner: the member-initiated action navigates,
  // and the fresh document (equal ids again) shows no banner.
  await page.unroute("**/api/version");
  await shellPage.applyReload();
  await expect
    .poll(() => page.evaluate(() => (window as { __preReload?: boolean }).__preReload ?? null))
    .toBe(null); // a real navigation happened — the marker died with the old document
  await loginPage.landmark();
  await expect(shellPage.reloadBanner()).toHaveCount(0);
});

test("equal stamped ids stay inert — no banner at the harness baseline", async ({ loginPage, shellPage }) => {
  // Both sides carry the one pw-harness id (setup.mjs): the login screen's version
  // check and every later tap must signal nothing.
  await loginPage.goto();
  await loginPage.landmark();
  await expect(shellPage.reloadBanner()).toHaveCount(0);
});

// The all-areas smoke: every registered app area renders its landmark and captures its
// full-page review screenshot (published on app-UI PRs). Session-gated areas reuse the
// worker's cached member session (asMember) — one seam per area (registry + page object).
import { test } from "../fixtures";
import { AREAS } from "../registry";

for (const { area, authed, make } of AREAS) {
  test(`${area} area renders`, async ({ page, asMember }) => {
    if (authed) await asMember();
    const po = make(page);
    await po.goto();
    await po.landmark();
    await po.captureForReview();
  });
}

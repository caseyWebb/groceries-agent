// The Connect-to-Claude guided modal (connect-modal): the sidebar CTA opens two tabs
// of setup steps TEMPLATED from the deployment's operator config (the harness stamps
// fixture MARKETPLACE_REPO/OPERATOR_NAME vars — see setup.mjs), commands copy with
// per-step feedback, and the Claude Code tab's optional Kroger step mints the member's
// personal consent link through the EXISTING /api/profile/kroger-login-url (the
// nonce-bound /oauth/init accepts no static URL).
import { test, expect } from "../fixtures";

/** The harness's stamped marketplace slug (setup.mjs). */
const REPO = "caseyWebb/yet-another-meal-planner-deployment";

test.describe("connect-to-claude modal", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("guided steps are templated and copyable on both tabs", async ({ page, asMember, shellPage }) => {
    await asMember();
    await shellPage.goto();
    await shellPage.landmark();
    await shellPage.openConnectModal();

    // Claude.ai tab (default): five steps, the marketplace slug as the copyable command,
    // auto-sync copy naming the operator, the invite-code connect step, and the footer.
    await expect(shellPage.connectCmd(1)).toHaveText(REPO);
    await expect(shellPage.connectStep(2)).toContainText("updates casey ships");
    await expect(shellPage.connectStep(5)).toContainText("invite code");
    await expect(page.getByTestId("connect-open-claude")).toHaveAttribute("href", "https://claude.ai/new");

    // Copying flips the step's button to "Copied" and lands the command on the clipboard.
    await shellPage.connectCopy(1).click();
    await expect(shellPage.connectCopy(1)).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REPO);
    await shellPage.captureForReview("connect-modal-web");

    // Claude Code tab: templated commands, the /mcp auth step, the optional Kroger step.
    await shellPage.switchConnectTab("code");
    await expect(shellPage.connectCmd(1)).toHaveText(`/plugin marketplace add ${REPO}`);
    await expect(shellPage.connectCmd(2)).toHaveText("/plugin install yamp@yamp");
    await expect(shellPage.connectCmd(3)).toHaveText("/mcp");
    await expect(page.getByTestId("connect-kroger")).toBeVisible();
    await shellPage.captureForReview("connect-modal-code");
  });

  test("the Kroger step mints the personal consent link via the existing endpoint", async ({
    page,
    asMember,
    shellPage,
  }) => {
    await asMember();
    await shellPage.goto();
    await shellPage.landmark();
    await shellPage.openConnectModal();
    await shellPage.switchConnectTab("code");

    // Keep the minted link from opening a popup (it 302s to Kroger — offline here);
    // the assertion is the endpoint response: a session-minted single-use nonce URL,
    // never a static ?tenant= link.
    await page.evaluate(() => {
      window.open = () => null;
    });
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/profile/kroger-login-url")),
      page.getByTestId("connect-kroger").click(),
    ]);
    expect(res.ok()).toBeTruthy();
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain("/oauth/init?nonce=");
  });
});

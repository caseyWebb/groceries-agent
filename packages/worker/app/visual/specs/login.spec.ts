// The login flow (member-session-auth + member-app-core D13): the restyled single
// invite-code card logs into the app shell inside a real browser against a seeded
// local `wrangler dev`; the uniform error and the logout gate hold.
import { test } from "../fixtures";
import { SEED } from "../../../admin/visual/seed.mjs";

test("an invalid code shows the uniform error", async ({ loginPage }) => {
  await loginPage.goto();
  await loginPage.landmark();
  await loginPage.login("not-a-real-code");
  await loginPage.expectUniformError();
  await loginPage.captureForReview("login-error");
});

test("the seeded invite code lands on the authenticated shell, and a reload keeps the session", async ({
  loginPage,
  shellPage,
}) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  await shellPage.landmark();
  await shellPage.expectSignedInAs(SEED.members.active);
  // Cookie session: a reload re-runs the whoami boot check and stays signed in.
  await shellPage.goto();
  await shellPage.expectSignedInAs(SEED.members.active);
});

test("the account menu shows the member's Kroger link badge", async ({ asMember, shellPage }) => {
  await asMember();
  await shellPage.openAccountMenu();
  await shellPage.expectKrogerBadge(true); // the seed links the active member
});

test("logout returns to login, and the gate holds afterward", async ({ loginPage, shellPage }) => {
  await loginPage.goto();
  await loginPage.login(SEED.invite);
  await shellPage.landmark();
  await shellPage.logout();
  await loginPage.landmark();
  // The session is revoked server-side: revisiting / redirects back to login.
  await shellPage.goto();
  await loginPage.landmark();
});

test("an unauthenticated visit to / presents the login screen", async ({ loginPage, shellPage }) => {
  await shellPage.goto();
  await loginPage.landmark();
});

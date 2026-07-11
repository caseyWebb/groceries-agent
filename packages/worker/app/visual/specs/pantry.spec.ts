// Pantry (member-app-core / page 06): the client-derived needs-verification section and
// verify flow, the group-by Category|Location view, the multi-item add grid with UX-only
// autofill (server-authoritative via the D17 funnel), and disposition-based removal — Used
// (idempotent delete) and Mark-as-waste (one canonical reason, a client-minted event id,
// value NEVER asked). Tests share the seeded worker D1 and run in order; disposal tests
// come last so earlier group/add assertions read the intact fixture.
import { test, expect } from "../fixtures";

test.beforeEach(async ({ asMember, pantryPage }) => {
  await asMember();
  await pantryPage.goto();
  await pantryPage.landmark();
});

test("a stale perishable sits in needs-verification; verifying clears the nudge", async ({ pantryPage }) => {
  await pantryPage.expectNeedsVerification("Baby spinach"); // seeded 10d unchecked produce
  await pantryPage.captureForReview("pantry-needs-verification");
  await pantryPage.verify("Baby spinach");
  await pantryPage.expectVerified("Baby spinach");
});

test("group-by Location renders the fixed-order location headers", async ({ pantryPage }) => {
  // Default is Category — the seeded food-taxonomy categories each head a group.
  await pantryPage.expectGroup("Dairy"); // Butter + Parmesan
  await pantryPage.groupBy("Location");
  // Seeded rows span fridge (Butter, Parmesan) and pantry (Jasmine rice, Olive oil).
  await pantryPage.expectGroup("Fridge");
  await pantryPage.expectGroup("Pantry");
  const labels = await pantryPage.groupLabels();
  // The vocabulary's fixed order: Fridge precedes Pantry regardless of insertion order.
  expect(labels.indexOf("Fridge")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("Fridge")).toBeLessThan(labels.indexOf("Pantry"));
});

test("multi-add autofills recognized items, never clobbers a typed override, and commits both verified-now", async ({
  page,
  pantryPage,
}) => {
  await pantryPage.addRows([
    { name: "Milk" }, // recognized → Dairy / Fridge auto-fill
    { name: "Paprika", location: "Pantry" }, // recognized Spices/Spice rack; location overridden
  ]);
  // Recognition filled the untouched fields...
  await expect(pantryPage.draftRow(0).getByLabel("Category")).toHaveValue("Dairy");
  await expect(pantryPage.draftRow(0).getByLabel("Location")).toHaveValue("Fridge");
  await expect(pantryPage.draftRow(1).getByLabel("Category")).toHaveValue("Spices");
  // ...but the typed override wins and is never clobbered back to the recognized value.
  await expect(pantryPage.draftRow(1).getByLabel("Location")).toHaveValue("Pantry");

  const reqP = page.waitForRequest((r) => r.url().includes("/api/pantry/ops") && r.method() === "POST");
  await pantryPage.commitAdd();
  const body = (await reqP).postDataJSON() as { operations: { op: string; item: Record<string, unknown> }[] };
  const byName = Object.fromEntries(body.operations.map((o) => [o.item.name, o.item]));
  expect(body.operations).toHaveLength(2);
  expect(byName.Milk).toMatchObject({ category: "dairy", location: "fridge" });
  expect(byName.Paprika).toMatchObject({ category: "spices", location: "pantry" });

  // Added rows land verified-now (regular rows, not in the needs-verification nudge).
  await expect(pantryPage.item("Milk")).toBeVisible();
  await expect(pantryPage.item("Paprika")).toBeVisible();
  await pantryPage.captureForReview("pantry-multi-add");
});

test("multi-add leaves category blank as auto (no client authority over the funnel)", async ({ page, pantryPage }) => {
  // An unrecognized name with no typed category commits WITHOUT a category — the server's
  // D17 funnel/cron classifies it; the client never fabricates one.
  await pantryPage.addRows([{ name: "Sumac", location: "Spice rack" }]);
  const reqP = page.waitForRequest((r) => r.url().includes("/api/pantry/ops") && r.method() === "POST");
  await pantryPage.commitAdd();
  const body = (await reqP).postDataJSON() as { operations: { item: Record<string, unknown> }[] };
  expect(body.operations[0].item).not.toHaveProperty("category");
  expect(body.operations[0].item).toMatchObject({ name: "Sumac", location: "spice_rack" });
});

test("Used consumes a row as a pure delete — no waste modal, no reason", async ({ page, pantryPage }) => {
  const reqP = page.waitForRequest((r) => r.url().includes("/api/pantry/ops") && r.method() === "POST");
  await pantryPage.markUsed("Olive oil");
  const body = (await reqP).postDataJSON() as { operations: { op: string; disposition?: string; reason?: string }[] };
  expect(body.operations[0]).toMatchObject({ op: "dispose", disposition: "used" });
  expect(body.operations[0]).not.toHaveProperty("reason");
  await expect(page.getByTestId("waste-modal")).toHaveCount(0); // Used never opens the modal
  await pantryPage.expectRemoved("Olive oil");
});

test("Mark-as-waste records one canonical reason with a client-minted event id, and never asks a value", async ({
  page,
  pantryPage,
}) => {
  await pantryPage.item("Butter").getByTestId("pantry-menu-toggle").click();
  await pantryPage.item("Butter").getByTestId("pantry-waste").click();
  const modal = page.getByTestId("waste-modal");
  await expect(modal).toBeVisible();
  // The value is derived later from spend history — the modal NEVER prompts for a price.
  await expect(modal.locator("input")).toHaveCount(0);
  await pantryPage.captureForReview("pantry-waste-modal");

  const reqP = page.waitForRequest((r) => r.url().includes("/api/pantry/ops") && r.method() === "POST");
  await modal.getByTestId("waste-reason").filter({ hasText: "Spoiled" }).click();
  const body = (await reqP).postDataJSON() as {
    operations: { op: string; disposition?: string; reason?: string; event_id?: string; occurred_at?: string }[];
  };
  const op = body.operations[0];
  expect(op).toMatchObject({ op: "dispose", disposition: "waste", reason: "spoiled" });
  expect(["spoiled", "moldy", "over_ripe", "expired", "freezer_burned", "stale", "forgot", "bought_too_much", "never_opened", "other"]).toContain(op.reason);
  expect(op.event_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // a client-minted ULID
  expect(op.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await pantryPage.expectRemoved("Butter");
});

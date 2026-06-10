// Tests for scripts/migrate/manifest.mjs — the three-category recipe split that
// seeds the Model B data repos (multi-tenant-friend-group §5.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitRecipeFrontmatter,
  OBJECTIVE_RECIPE_FIELDS,
  SUBJECTIVE_RECIPE_FIELDS,
  OVERLAY_FIELDS,
  SHARED,
  TENANT,
} from "../scripts/migrate/manifest.mjs";

test("objective output strips every subjective field and keeps content fields", () => {
  const fm = {
    title: "American Chop Suey",
    protein: "beef",
    status: "active",
    rating: 4,
    last_cooked: "2026-05-01",
  };
  const { objective } = splitRecipeFrontmatter(fm);
  assert.equal(objective.title, "American Chop Suey");
  assert.equal(objective.protein, "beef");
  for (const f of SUBJECTIVE_RECIPE_FIELDS) {
    assert.ok(!(f in objective), `${f} must not be in objective content`);
  }
});

test("overlay row captures non-default status and non-null rating", () => {
  const { overlayRow } = splitRecipeFrontmatter({ status: "active", rating: 5 });
  assert.deepEqual(overlayRow, { status: "active", rating: 5 });
});

test("overlay row omits a draft status (absent → draft) and null rating", () => {
  const { overlayRow } = splitRecipeFrontmatter({ status: "draft", rating: null });
  assert.deepEqual(overlayRow, {});
});

test("overlay row keeps a rejected/archived disposition", () => {
  assert.deepEqual(splitRecipeFrontmatter({ status: "rejected" }).overlayRow, { status: "rejected" });
  assert.deepEqual(splitRecipeFrontmatter({ status: "archived" }).overlayRow, { status: "archived" });
});

test("last_cooked is surfaced (for cooking_log coverage check) and never kept in content", () => {
  const { objective, lastCooked } = splitRecipeFrontmatter({ title: "x", last_cooked: "2026-05-01" });
  assert.equal(lastCooked, "2026-05-01");
  assert.ok(!("last_cooked" in objective));
  assert.equal(splitRecipeFrontmatter({ title: "x" }).lastCooked, null);
});

test("manifest field sets are coherent", () => {
  // Overlay fields are a subset of the subjective fields.
  for (const f of OVERLAY_FIELDS) {
    assert.ok(SUBJECTIVE_RECIPE_FIELDS.includes(f), `${f} should be subjective`);
  }
  // Objective and subjective field sets are disjoint.
  for (const f of OBJECTIVE_RECIPE_FIELDS) {
    assert.ok(!SUBJECTIVE_RECIPE_FIELDS.includes(f), `${f} should not be subjective`);
  }
  // last_cooked is subjective but NOT an overlay field (it's cooking_log-derived).
  assert.ok(SUBJECTIVE_RECIPE_FIELDS.includes("last_cooked"));
  assert.ok(!OVERLAY_FIELDS.includes("last_cooked"));
});

test("shared and tenant file sets do not overlap", () => {
  const shared = new Set([...SHARED.files, ...SHARED.dirs, SHARED.recipesDir]);
  for (const f of TENANT.files) {
    assert.ok(!shared.has(f), `${f} must not be both shared and per-tenant`);
  }
});

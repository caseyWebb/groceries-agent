import { describe, it, expect } from "vitest";
import {
  parseOverlay,
  mergeOverlay,
  applyOverlayEdit,
  serializeOverlay,
  DEFAULT_STATUS,
  type Overlay,
} from "../src/overlay.js";

describe("parseOverlay", () => {
  it("parses [overlay.<slug>] tables into a slug→row map", () => {
    const text = `
[overlay.american-chop-suey]
status = "active"
rating = 4

[overlay.beef-stew]
status = "rejected"
`;
    expect(parseOverlay(text)).toEqual({
      "american-chop-suey": { status: "active", rating: 4 },
      "beef-stew": { status: "rejected" },
    });
  });

  it("returns {} for an empty or overlay-less document", () => {
    expect(parseOverlay("")).toEqual({});
    expect(parseOverlay("# just a comment\n")).toEqual({});
  });
});

describe("mergeOverlay", () => {
  const content = { slug: "x", title: "X", protein: "beef" };

  it("prefers overlay rating/status; defaults absent status to draft", () => {
    const merged = mergeOverlay(content, { rating: 5, status: "active" }, undefined);
    expect(merged.status).toBe("active");
    expect(merged.rating).toBe(5);
    expect(merged.last_cooked).toBeNull();
    expect(merged.title).toBe("X"); // objective content preserved
  });

  it("defaults status to draft when there is no overlay row and no frontmatter status", () => {
    expect(mergeOverlay(content, undefined, undefined).status).toBe(DEFAULT_STATUS);
  });

  it("falls back to frontmatter status/rating during the transition (pre-migration index)", () => {
    const legacy = { slug: "x", title: "X", status: "archived", rating: 3, last_cooked: "2026-01-01" };
    const merged = mergeOverlay(legacy, undefined, undefined);
    expect(merged.status).toBe("archived");
    expect(merged.rating).toBe(3);
    expect(merged.last_cooked).toBe("2026-01-01");
  });

  it("derives last_cooked from the cooking log, overriding any frontmatter value", () => {
    const legacy = { slug: "x", title: "X", last_cooked: "2026-01-01" };
    expect(mergeOverlay(legacy, undefined, "2026-05-09").last_cooked).toBe("2026-05-09");
  });

  it("does not mutate the shared frontmatter", () => {
    const fm = { slug: "x", title: "X" };
    mergeOverlay(fm, { status: "active" }, "2026-05-09");
    expect(fm).toEqual({ slug: "x", title: "X" });
  });
});

describe("applyOverlayEdit", () => {
  it("sets rating/status on a fresh slug", () => {
    expect(applyOverlayEdit({}, "x", { rating: 4, status: "active" })).toEqual({
      x: { rating: 4, status: "active" },
    });
  });

  it("merges onto an existing row without disturbing the other field", () => {
    const before: Overlay = { x: { rating: 4, status: "active" } };
    expect(applyOverlayEdit(before, "x", { status: "rejected" })).toEqual({
      x: { rating: 4, status: "rejected" },
    });
  });

  it("clears a field when given null, and drops an emptied row", () => {
    const before: Overlay = { x: { status: "active" } };
    expect(applyOverlayEdit(before, "x", { status: null })).toEqual({});
  });

  it("does not mutate the input overlay", () => {
    const before: Overlay = { x: { status: "active" } };
    applyOverlayEdit(before, "x", { rating: 5 });
    expect(before).toEqual({ x: { status: "active" } });
  });
});

describe("serializeOverlay", () => {
  it("round-trips through parseOverlay with stable, sorted slug order", () => {
    const overlay: Overlay = {
      "beef-stew": { status: "rejected" },
      "american-chop-suey": { status: "active", rating: 4 },
    };
    const text = serializeOverlay(overlay);
    expect(text.indexOf("american-chop-suey")).toBeLessThan(text.indexOf("beef-stew"));
    expect(parseOverlay(text)).toEqual(overlay);
  });

  it("emits a header-only document for an empty overlay", () => {
    expect(parseOverlay(serializeOverlay({}))).toEqual({});
  });
});

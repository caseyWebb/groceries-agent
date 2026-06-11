import { describe, it, expect } from "vitest";
import {
  parseNotes,
  appendNote,
  serializeNotes,
  notesPath,
  aggregateGroupSignal,
  type Note,
  type TenantSignal,
} from "../src/notes.js";

function note(over: Partial<Note> = {}): Note {
  return { created_at: "2026-06-01T00:00:00.000Z", body: "b", tags: [], private: false, ...over };
}

describe("notesPath", () => {
  it("is the per-slug notes file under the tenant prefix", () => {
    expect(notesPath("miso-salmon")).toBe("notes/miso-salmon.toml");
  });
});

describe("parseNotes / serializeNotes round-trip", () => {
  it("round-trips body, tags, and the private flag", () => {
    const notes: Note[] = [
      note({ body: "subbed gochujang for sriracha", tags: ["tweak"] }),
      note({ created_at: "2026-06-02T00:00:00.000Z", body: "too salty", private: true }),
    ];
    const reparsed = parseNotes(serializeNotes(notes));
    expect(reparsed).toEqual(notes);
  });

  it("absent/empty file → no notes; drops a note with no body", () => {
    expect(parseNotes(null)).toEqual([]);
    expect(parseNotes("")).toEqual([]);
    expect(parseNotes('[[notes]]\ncreated_at = "x"\n')).toEqual([]);
  });

  it("defaults a stored note's tags to [] and private to false", () => {
    const parsed = parseNotes('[[notes]]\ncreated_at = "t"\nbody = "hi"\n');
    expect(parsed).toEqual([{ created_at: "t", body: "hi", tags: [], private: false }]);
  });
});

describe("appendNote", () => {
  it("accretes rather than overwriting (append-mostly)", () => {
    const first = note({ body: "first" });
    const out = appendNote([first], note({ body: "second" }));
    expect(out).toHaveLength(2);
    expect(out[0].body).toBe("first");
    expect(out[1].body).toBe("second");
  });
});

describe("aggregateGroupSignal (§8.2)", () => {
  const perTenant: TenantSignal[] = [
    {
      author: "alice",
      notes: [note({ created_at: "2026-06-01T00:00:00.000Z", body: "alice shared" })],
      rating: 5,
      status: "active",
    },
    {
      author: "bob",
      notes: [
        note({ created_at: "2026-06-02T00:00:00.000Z", body: "bob shared" }),
        note({ created_at: "2026-06-03T00:00:00.000Z", body: "bob secret", private: true }),
      ],
      rating: 4,
    },
  ];

  it("shows the group's shared notes attributed to their authors", () => {
    const { notes } = aggregateGroupSignal("alice", perTenant);
    const visible = notes.map((n) => [n.author, n.body]);
    expect(visible).toContainEqual(["alice", "alice shared"]);
    expect(visible).toContainEqual(["bob", "bob shared"]);
  });

  it("excludes another tenant's private note", () => {
    const { notes } = aggregateGroupSignal("alice", perTenant);
    expect(notes.find((n) => n.body === "bob secret")).toBeUndefined();
  });

  it("includes the caller's OWN private note", () => {
    const { notes } = aggregateGroupSignal("bob", perTenant);
    expect(notes.find((n) => n.author === "bob" && n.body === "bob secret")).toBeDefined();
  });

  it("orders notes by timestamp", () => {
    const { notes } = aggregateGroupSignal("bob", perTenant);
    const order = notes.map((n) => n.created_at);
    expect(order).toEqual([...order].sort());
  });

  it("aggregates attributed ratings (never private), sorted by author", () => {
    const { ratings } = aggregateGroupSignal("carol", perTenant);
    expect(ratings).toEqual([
      { author: "alice", rating: 5, status: "active" },
      { author: "bob", rating: 4 },
    ]);
  });

  it("omits a tenant with no rating from the ratings list", () => {
    const signal = aggregateGroupSignal("x", [{ author: "z", notes: [note()] }]);
    expect(signal.ratings).toEqual([]);
  });
});

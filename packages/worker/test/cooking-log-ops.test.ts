// Member cooking-log corrections (cooking-history, member-app-core D4): the bounded
// most-recent-first list read (recipe rows enriched via the LEFT JOIN recipes idiom)
// and the tenant-scoped delete-by-id. Web-only ops — no MCP tool reads these shapes.
import { describe, it, expect } from "vitest";
import {
  readCookingLog,
  deleteCookingLogRow,
  COOKING_LOG_MAX_LIMIT,
} from "../src/cooking-tools.js";
import { readLastCookedMap } from "../src/tools.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";

/** A SQL-routed fake for the JOIN read: captures binds, returns the supplied rows. */
function joinEnv(rows: Record<string, unknown>[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async all<T>() {
        calls.push({ sql, binds });
        // Emulate ORDER BY date DESC, id DESC + LIMIT ?2 over the supplied rows.
        const sorted = [...rows].sort((a, b) => {
          const d = String(b.date).localeCompare(String(a.date));
          return d !== 0 ? d : Number(b.id) - Number(a.id);
        });
        return { results: sorted.slice(0, Number(binds[1])) as T[], success: true as const, meta: { changes: 0 } };
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { success: true as const, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { env: { DB } as unknown as Env, calls };
}

describe("readCookingLog", () => {
  const rows = [
    { id: 1, date: "2026-06-01", type: "recipe", recipe: "tacos", name: null, title: "Tacos", protein: "beef", cuisine: "mexican" },
    { id: 2, date: "2026-06-20", type: "ad_hoc", recipe: null, name: "Fridge pasta", title: null, protein: null, cuisine: null },
    { id: 3, date: "2026-06-20", type: "recipe", recipe: "miso-salmon", name: null, title: "Miso Salmon", protein: "fish", cuisine: "japanese" },
  ];

  it("returns the caller's log most-recent-first (date DESC, id DESC), enriched, with ids", async () => {
    const { env, calls } = joinEnv(rows);
    const out = await readCookingLog(env, "everett");
    expect(out.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(out[0]).toMatchObject({ recipe: "miso-salmon", title: "Miso Salmon", protein: "fish" });
    expect(out[1]).toMatchObject({ type: "ad_hoc", name: "Fridge pasta", title: null });
    // The SQL is the JOIN + COALESCE idiom, tenant-scoped, ordered, bounded.
    expect(calls[0].sql).toMatch(/LEFT JOIN recipes r ON cl\.recipe = r\.slug/);
    expect(calls[0].sql).toMatch(/COALESCE\(cl\.protein, r\.protein\)/);
    expect(calls[0].sql).toMatch(/ORDER BY cl\.date DESC, cl\.id DESC LIMIT \?2/);
    expect(calls[0].binds[0]).toBe("everett");
  });

  it("bounds the read: default limit binds, and the cap clamps an oversized ask", async () => {
    const { env, calls } = joinEnv(rows);
    await readCookingLog(env, "everett");
    expect(calls[0].binds[1]).toBe(50);
    await readCookingLog(env, "everett", { limit: 2 });
    expect(calls[1].binds[1]).toBe(2);
    await readCookingLog(env, "everett", { limit: 99999 });
    expect(calls[2].binds[1]).toBe(COOKING_LOG_MAX_LIMIT);
    await readCookingLog(env, "everett", { limit: 0 });
    expect(calls[3].binds[1]).toBe(1);
  });
});

describe("deleteCookingLogRow", () => {
  const seed = () =>
    fakeD1({
      tables: {
        cooking_log: [
          { tenant: "everett", id: 1, date: "2026-06-01", type: "recipe", recipe: "tacos", name: null },
          { tenant: "everett", id: 2, date: "2026-06-20", type: "recipe", recipe: "tacos", name: null },
          { tenant: "casey", id: 3, date: "2026-06-10", type: "recipe", recipe: "tacos", name: null },
        ],
      },
    });

  it("removes only the caller's row by id", async () => {
    const d1 = seed();
    expect(await deleteCookingLogRow(d1.env, "everett", 2)).toEqual({ found: true });
    expect(d1.tables.cooking_log.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it("cannot delete another tenant's entry — not found, nothing deleted", async () => {
    const d1 = seed();
    expect(await deleteCookingLogRow(d1.env, "everett", 3)).toEqual({ found: false });
    expect(d1.tables.cooking_log).toHaveLength(3);
  });

  it("derived last_cooked (MAX date) reflects a deletion on the next read", async () => {
    const d1 = seed();
    expect((await readLastCookedMap(d1.env, "everett")).get("tacos")).toBe("2026-06-20");
    await deleteCookingLogRow(d1.env, "everett", 2); // the most recent cook was a mis-log
    expect((await readLastCookedMap(d1.env, "everett")).get("tacos")).toBe("2026-06-01");
  });
});

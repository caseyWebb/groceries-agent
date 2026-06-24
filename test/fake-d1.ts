// A small in-memory D1 fake for the session-state tables (pantry, meal_plan,
// grocery_list) plus the recipes resolution SELECT used by log_cooked. It routes by
// SQL: tenant-scoped SELECT/DELETE/INSERT with ON CONFLICT upserts keyed by each
// table's primary key, and the WHERE filters the tools rely on (pantry category /
// prepared_from IS NOT NULL, grocery status, the recipe/normalized_name point keys).
// Enough fidelity to exercise the row writers' SQL/bind contract without a live D1.

import type { Env } from "../src/env.js";

export interface FakeD1 {
  env: Env;
  tables: Record<string, Record<string, unknown>[]>;
  /** Recorded batch invocations (each a list of executed {sql, binds}). */
  batches: { sql: string; binds: unknown[] }[][];
}

const PK: Record<string, string[]> = {
  pantry: ["tenant", "normalized_name"],
  meal_plan: ["tenant", "recipe"],
  grocery_list: ["tenant", "normalized_name"],
};

export function fakeD1(
  init: { tables?: Record<string, Record<string, unknown>[]>; recipes?: string[] } = {},
): FakeD1 {
  const tables: Record<string, Record<string, unknown>[]> = {
    pantry: [],
    meal_plan: [],
    grocery_list: [],
    ...(init.tables ?? {}),
  };
  const known = new Set(init.recipes ?? []);
  const batches: { sql: string; binds: unknown[] }[][] = [];

  const tableOf = (sql: string): string | null => {
    const m = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql);
    return m ? m[1] : null;
  };

  const exec = (sql: string, binds: unknown[]): { rows: Record<string, unknown>[]; changes: number } => {
    const table = tableOf(sql);
    if (/^SELECT/i.test(sql)) {
      if (table === "recipes") {
        const slug = binds[0];
        return { rows: typeof slug === "string" && known.has(slug) ? [{ ok: 1 }] : [], changes: 0 };
      }
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      let rows = tables[table].filter((r) => r.tenant === binds[0]);
      // Positional filters mirror session-db's appended WHERE clauses.
      if (/category = \?2/i.test(sql)) rows = rows.filter((r) => r.category === binds[1]);
      if (/prepared_from IS NOT NULL/i.test(sql)) rows = rows.filter((r) => r.prepared_from != null);
      if (/status = \?2/i.test(sql)) rows = rows.filter((r) => r.status === binds[1]);
      if (/recipe = \?2/i.test(sql)) rows = rows.filter((r) => r.recipe === binds[1]);
      if (/normalized_name = \?2/i.test(sql)) rows = rows.filter((r) => r.normalized_name === binds[1]);
      return { rows: rows.map((r) => ({ ...r })), changes: 0 };
    }
    if (/^DELETE/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const before = tables[table].length;
      tables[table] = tables[table].filter((r) => {
        if (r.tenant !== binds[0]) return true;
        if (/recipe = \?2/i.test(sql)) return r.recipe !== binds[1];
        if (/normalized_name = \?2/i.test(sql)) return r.normalized_name !== binds[1];
        return false; // tenant-wide delete
      });
      return { rows: [], changes: before - tables[table].length };
    }
    if (/^INSERT/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(sql)![1].split(",").map((c) => c.trim());
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = binds[i] ?? null));
      const pk = PK[table] ?? ["tenant", "normalized_name"];
      const idx = tables[table].findIndex((r) => pk.every((k) => r[k] === row[k]));
      if (idx >= 0 && /ON CONFLICT/i.test(sql)) {
        // Apply the DO UPDATE SET col = excluded.col list (every col except the PK
        // that the statement names — for our writers that's everything but PK + the
        // preserved columns, which simply aren't in the SET clause).
        const setCols = [...sql.matchAll(/(\w+) = excluded\.(\w+)/gi)].map((m) => m[1]);
        const merged = { ...tables[table][idx] };
        for (const c of setCols) merged[c] = row[c];
        tables[table][idx] = merged;
      } else {
        tables[table].push(row);
      }
      return { rows: [], changes: 1 };
    }
    return { rows: [], changes: 0 };
  };

  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async first<T>() {
        return (exec(sql, binds).rows[0] ?? null) as T | null;
      },
      async all<T>() {
        return { results: exec(sql, binds).rows as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        return { success: true as const, meta: { changes: exec(sql, binds).changes } };
      },
      __sql: () => sql,
      __binds: () => binds,
      __exec: () => exec(sql, binds),
    };
    return stmt;
  };

  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch(stmts: unknown[]) {
      const recorded: { sql: string; binds: unknown[] }[] = [];
      for (const s of stmts) {
        const stmt = s as { __sql: () => string; __binds: () => unknown[]; __exec: () => void };
        recorded.push({ sql: stmt.__sql(), binds: stmt.__binds() });
        stmt.__exec();
      }
      batches.push(recorded);
      return [];
    },
  } as unknown as D1Database;

  return { env: { DB } as unknown as Env, tables, batches };
}

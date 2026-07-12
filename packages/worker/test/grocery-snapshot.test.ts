import { describe, expect, it } from "vitest";
import { readGrocerySnapshot } from "../src/grocery-snapshot.js";
import { addGroceryRow, updateGroceryRow } from "../src/session-db.js";
import { sqliteEnv } from "./sqlite-d1.js";

const T = "casey";
const NOW = new Date("2026-07-12T12:00:00Z");

describe("readGrocerySnapshot", () => {
  it("groups current send membership while retaining the immutable sent quote", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-10");
    await updateGroceryRow(h.env, T, "milk", { status: "in_cart" });
    h.raw.prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('s1',?,'kroger','kroger_online','2026-07-08T00:00:00Z')").run(T);
    h.raw.prepare("INSERT INTO order_send_lines (send_id,line_key,name,quantity,unit_price,savings,provenance) VALUES ('s1','milk','Milk',2,3.5,1,'planned')").run();
    h.raw.prepare("UPDATE grocery_list SET sent_in='s1' WHERE tenant=? AND normalized_name='milk'").run(T);
    const data = await readGrocerySnapshot(h.env, T, NOW);
    expect(data.counts).toMatchObject({ to_buy: 0, checked: 0, in_carts: 1 });
    expect(data.in_cart_groups[0]).toMatchObject({ send_id: "s1", estimated_total: 7, flyer_savings: 2, awaiting_confirmation: true, can_mark_placed: true });
  });

  it("changes the opaque digest for grocery, plan, pantry, decision, and send membership sources", async () => {
    const h = sqliteEnv([T]);
    const versions: string[] = [];
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    await addGroceryRow(h.env, T, { name: "salt" }, "2026-07-12");
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    h.raw.prepare("INSERT INTO recipes (slug,title,ingredients_full) VALUES ('soup','Soup','[\"onion\"]')").run();
    h.raw.prepare("INSERT INTO meal_plan (tenant,id,recipe,meal,planned_for) VALUES (?,'p1','soup','dinner','2026-07-13')").run(T);
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,added_at,last_verified_at,category) VALUES (?,'Onion','onion','2026-07-12','2026-07-12','produce')").run(T);
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    h.raw.prepare("INSERT INTO grocery_coverage_decisions (tenant,line_key,created_at,updated_at) VALUES (?,'onion','2026-07-12','2026-07-12')").run(T);
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    await updateGroceryRow(h.env, T, "salt", { status: "in_cart" });
    versions.push((await readGrocerySnapshot(h.env, T, NOW)).snapshot_version);
    for (let i = 1; i < versions.length; i++) expect(versions[i]).not.toBe(versions[i - 1]);
  });
});

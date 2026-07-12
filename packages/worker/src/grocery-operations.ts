import type { GroceryListData } from "@yamp/contract";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { readGroceryList, markPantryVerifiedRows } from "./session-db.js";
import { readGrocerySnapshot } from "./grocery-snapshot.js";
import { purchaseAssertionStatements } from "./spend.js";

export interface GroceryMutationResult { status: "ok"; snapshot: GroceryListData; outcome?: string }

function conflict(message: string, snapshot: GroceryListData): never {
  throw new ToolError("conflict", message, { snapshot });
}

async function requireSnapshot(env: Env, tenant: string, expected: string): Promise<GroceryListData> {
  const current = await readGrocerySnapshot(env, tenant);
  if (current.snapshot_version !== expected) conflict("The grocery list changed; review the current snapshot.", current);
  return current;
}

export async function setGroceryChecked(
  env: Env,
  tenant: string,
  input: { key: string; checked: boolean; expected_row_version: number; snapshot_version: string; occurred_at?: string },
): Promise<GroceryMutationResult> {
  const current = await readGrocerySnapshot(env, tenant);
  const rendered = current.lines.find((line) => line.key === input.key);
  const rows = await readGroceryList(env, tenant);
  const existing = rows.find((row) => row.normalized_name === input.key);
  const already = existing ? (existing.checked_at != null) === input.checked : !input.checked;
  if (already) return { status: "ok", snapshot: current };
  if (existing && (existing.row_version ?? 1) !== input.expected_row_version) {
    conflict("This grocery line changed on another device.", current);
  }
  if (!existing && !input.checked) return { status: "ok", snapshot: current };
  if (!existing && (!rendered || rendered.origin !== "plan")) {
    throw new ToolError("not_found", `No grocery line for canonical key: ${input.key}`, { key: input.key });
  }
  const occurred = input.occurred_at ?? new Date().toISOString();
  if (existing) {
    await db(env).run(
      "UPDATE grocery_list SET checked_at = ?1, row_version = row_version + 1, updated_at = ?2 " +
        "WHERE tenant = ?3 AND normalized_name = ?4 AND row_version = ?5",
      input.checked ? occurred : null,
      occurred,
      tenant,
      input.key,
      input.expected_row_version,
    );
  } else {
    await db(env).batch([
      db(env).prepare(
        "INSERT OR IGNORE INTO grocery_list (tenant,name,normalized_name,display_name,quantity,kind,domain,status,source,for_recipes,note,added_at,ordered_at,sent_in,checked_at,row_version,updated_at) " +
          "VALUES (?1,?2,?3,?4,?5,?6,?7,'active','menu',?8,?9,?10,NULL,NULL,?11,1,?11)",
        tenant,
        rendered!.name,
        input.key,
        rendered!.display_name ?? null,
        String(rendered!.quantity),
        rendered!.kind,
        rendered!.domain,
        JSON.stringify(rendered!.for_recipes),
        rendered!.note ?? null,
        occurred.slice(0, 10),
        occurred,
      ),
    ]);
  }
  const snapshot = await readGrocerySnapshot(env, tenant);
  const next = snapshot.lines.find((line) => line.key === input.key);
  if (!next || (next.checked_at != null) !== input.checked) conflict("This grocery line changed while checking it.", snapshot);
  return { status: "ok", snapshot, outcome: input.checked ? "checked" : "unchecked" };
}

export async function acceptGrocerySubstitution(
  env: Env,
  tenant: string,
  input: { original_key: string; replacement_key: string; replacement_name: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  const current = await requireSnapshot(env, tenant, input.snapshot_version);
  const original = current.lines.find((line) => line.key === input.original_key);
  if (!original) throw new ToolError("not_found", "The original grocery line is no longer shopping state.");
  const existing = (await readGroceryList(env, tenant)).find((row) => row.normalized_name === input.replacement_key);
  const now = new Date().toISOString();
  const created = existing ? 0 : 1;
  const statements = [] as D1PreparedStatement[];
  if (!existing) {
    statements.push(db(env).prepare(
      "INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,checked_at,row_version,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'active','menu',?7,NULL,?8,NULL,1,?9)",
      tenant, input.replacement_name, input.replacement_key, String(original.quantity), original.kind, original.domain,
      JSON.stringify(original.for_recipes), now.slice(0, 10), now,
    ));
  }
  statements.push(db(env).prepare(
    "INSERT INTO grocery_substitution_decisions (tenant,original_key,replacement_key,attribution_signature,created_replacement,replacement_version,row_version,created_at,updated_at) " +
      "VALUES (?1,?2,?3,?4,?5,?6,1,?7,?7) ON CONFLICT(tenant,original_key) DO UPDATE SET replacement_key=excluded.replacement_key, attribution_signature=excluded.attribution_signature, created_replacement=excluded.created_replacement, replacement_version=excluded.replacement_version, row_version=grocery_substitution_decisions.row_version+1, updated_at=excluded.updated_at",
    tenant, input.original_key, input.replacement_key, JSON.stringify(original.for_recipes), created, existing?.row_version ?? 1, now,
  ));
  await db(env).batch(statements);
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "substituted" };
}

export async function undoGrocerySubstitution(
  env: Env,
  tenant: string,
  input: { original_key: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  await requireSnapshot(env, tenant, input.snapshot_version);
  const decision = await db(env).first<{ replacement_key: string; created_replacement: number; replacement_version: number | null }>(
    "SELECT replacement_key, created_replacement, replacement_version FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2",
    tenant, input.original_key,
  );
  if (!decision) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant) };
  const stmts = [db(env).prepare("DELETE FROM grocery_substitution_decisions WHERE tenant=?1 AND original_key=?2", tenant, input.original_key)];
  let outcome = "original restored; replacement preserved";
  if (decision.created_replacement && decision.replacement_version != null) {
    stmts.push(db(env).prepare("DELETE FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND row_version=?3", tenant, decision.replacement_key, decision.replacement_version));
    outcome = "original restored; untouched replacement removed";
  }
  await db(env).batch(stmts);
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome };
}

export async function setGroceryBuyAnyway(
  env: Env,
  tenant: string,
  input: { key: string; enabled: boolean; name?: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  const current = await requireSnapshot(env, tenant, input.snapshot_version);
  const covered = current.pantry_covered.find((line) => line.key === input.key);
  const decision = await db(env).first<{ created_row: number; created_row_version: number | null }>(
    "SELECT created_row, created_row_version FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?2", tenant, input.key,
  );
  if (!input.enabled) {
    if (!decision) return { status: "ok", snapshot: current };
    const stmts = [db(env).prepare("DELETE FROM grocery_coverage_decisions WHERE tenant=?1 AND line_key=?2", tenant, input.key)];
    if (decision.created_row && decision.created_row_version != null) stmts.push(db(env).prepare("DELETE FROM grocery_list WHERE tenant=?1 AND normalized_name=?2 AND row_version=?3", tenant, input.key, decision.created_row_version));
    await db(env).batch(stmts);
    return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "buy-anyway undone" };
  }
  if (!covered) throw new ToolError("not_found", "The pantry no longer covers this grocery line.");
  const existing = (await readGroceryList(env, tenant)).find((row) => row.normalized_name === input.key);
  const now = new Date().toISOString();
  const stmts = [] as D1PreparedStatement[];
  if (!existing) stmts.push(db(env).prepare(
    "INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,checked_at,row_version,updated_at) VALUES (?1,?2,?3,'1','grocery','grocery','active','pantry_low',?4,'Bought despite pantry coverage',?5,NULL,1,?6)",
    tenant, input.name ?? covered.name, input.key, JSON.stringify(covered.for_recipes), now.slice(0, 10), now,
  ));
  stmts.push(db(env).prepare(
    "INSERT INTO grocery_coverage_decisions (tenant,line_key,created_row,created_row_version,row_version,created_at,updated_at) VALUES (?1,?2,?3,?4,1,?5,?5) ON CONFLICT(tenant,line_key) DO UPDATE SET row_version=grocery_coverage_decisions.row_version+1,updated_at=excluded.updated_at",
    tenant, input.key, existing ? 0 : 1, existing?.row_version ?? 1, now,
  ));
  await db(env).batch(stmts);
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "buy anyway" };
}

export async function verifyGroceryPantry(
  env: Env, tenant: string, input: { key: string; snapshot_version: string },
): Promise<GroceryMutationResult> {
  await requireSnapshot(env, tenant, input.snapshot_version);
  await markPantryVerifiedRows(env, tenant, [input.key], new Date().toISOString().slice(0, 10));
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "still good" };
}

export async function relistGrocerySendLine(
  env: Env,
  tenant: string,
  input: { send_id: string; line_key: string; expected_row_version: number },
): Promise<GroceryMutationResult> {
  const row = await db(env).first<{ status: string; sent_in: string | null; row_version: number }>(
    "SELECT status,sent_in,row_version FROM grocery_list WHERE tenant=?1 AND normalized_name=?2",
    tenant, input.line_key,
  );
  if (!row) throw new ToolError("not_found", "The grocery line no longer exists.");
  const before = await readGrocerySnapshot(env, tenant);
  if (row.status === "active" && row.sent_in == null) return { status: "ok", snapshot: before, outcome: "already relisted" };
  if (row.status !== "in_cart" || row.sent_in !== input.send_id || row.row_version !== input.expected_row_version) {
    conflict("The send membership changed; review the current cart group.", before);
  }
  const now = new Date().toISOString();
  const result = await db(env).run(
    "UPDATE grocery_list SET status='active', sent_in=NULL, row_version=row_version+1, updated_at=?1 " +
      "WHERE tenant=?2 AND normalized_name=?3 AND status='in_cart' AND sent_in=?4 AND row_version=?5",
    now, tenant, input.line_key, input.send_id, input.expected_row_version,
  );
  if (result.changes !== 1) conflict("The send membership changed while relisting.", await readGrocerySnapshot(env, tenant));
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: "back to list" };
}

export async function markGrocerySendPlaced(
  env: Env,
  tenant: string,
  input: { send_id: string; expected_line_keys: string[]; snapshot_version: string; occurred_at?: string },
): Promise<GroceryMutationResult> {
  const send = await db(env).first<{ placed_at: string | null }>(
    "SELECT placed_at FROM order_sends WHERE tenant=?1 AND id=?2", tenant, input.send_id,
  );
  if (!send) throw new ToolError("not_found", "That send does not belong to this household.");
  if (send.placed_at) return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: `placed ${send.placed_at}` };
  const current = await readGrocerySnapshot(env, tenant);
  if (current.snapshot_version !== input.snapshot_version) conflict("The grocery list changed before placement.", current);
  const members = await db(env).all<{ normalized_name: string }>(
    "SELECT normalized_name FROM grocery_list WHERE tenant=?1 AND status='in_cart' AND sent_in=?2 ORDER BY normalized_name",
    tenant, input.send_id,
  );
  const actual = members.map((row) => row.normalized_name);
  const expected = [...new Set(input.expected_line_keys)].sort();
  if (actual.length === 0) throw new ToolError("validation_failed", "A send with zero current lines cannot be placed.");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) conflict("The send's line membership changed.", current);
  const occurred = input.occurred_at ?? new Date().toISOString();
  const occurredDay = occurred.slice(0, 10);
  const spend = await purchaseAssertionStatements(
    env, tenant, actual.map((lineKey) => ({ sendId: input.send_id, lineKey })), occurredDay,
  );
  const statements = actual.map((key) => db(env).prepare(
    "UPDATE grocery_list SET status='ordered', ordered_at=?1, row_version=row_version+1, updated_at=?2 " +
      "WHERE tenant=?3 AND normalized_name=?4 AND status='in_cart' AND sent_in=?5",
    occurredDay, occurred, tenant, key, input.send_id,
  ));
  statements.push(...spend.statements);
  statements.push(db(env).prepare(
    "UPDATE order_sends SET placed_at=?1 WHERE tenant=?2 AND id=?3 AND placed_at IS NULL",
    occurred, tenant, input.send_id,
  ));
  await db(env).batch(statements);
  return { status: "ok", snapshot: await readGrocerySnapshot(env, tenant), outcome: `placed ${actual.length} lines` };
}

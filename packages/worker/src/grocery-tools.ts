// Grocery-list CRUD tools (grocery-list capability). The buy list accumulates
// SKU-free intent across the week; resolution to a Kroger SKU and the cart write
// are deferred to order placement. Mutations persist as D1 rows (src/session-db.ts).
// Lifecycle: new items start `active`; `active ⇄ in_cart` is freely writable here
// (place_order's resolution also advances resolved lines to `in_cart`); `ordered` is
// reached ONLY by the user-asserted advance from `in_cart` via update_grocery_list
// (which stamps `ordered_at`) or by the satellite receipt flush — the shared update
// op (session-db.ts) guards every other write of `ordered` with a structured
// `validation_failed` (W3).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { ToolError, runTool } from "./errors.js";
import { type GroceryItem, type GroceryAddInput, type GroceryUpdateInput } from "./grocery.js";
import { addGroceryRow, updateGroceryRow, removeGroceryRow } from "./session-db.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const ADD_DESCRIPTION =
  "Add an item to the grocery list (ingredient/product level, no SKU). Supply `name` (the member's surface form) and/or `id` — at least one is required. Re-adding an existing name merges into it (union for_recipes, reconcile quantity) rather than duplicating; a merge keeps the surviving row's existing display. New items start status=active. A PLANNED recipe's ingredient needs NO add — the to-buy set derives them from the meal plan automatically (`read_to_buy`); adding one anyway MATERIALIZES/pins it as an explicit row (do this to carry a quantity annotation or note, e.g. a double-batch scaling) — it upserts under the same canonical id, so the row and the derived need merge into one line, never a duplicate. `id` is an ALREADY-CANONICAL ingredient id (e.g. accepting a graph-sibling swap): when supplied it is treated as a canonical key — validated as a LIVE survivor, NOT re-resolved through the funnel — the row keys and dedups on it directly, and stores a clean human DISPLAY as its `name` (the posted `name` when present, else the identity node's curated label — never the raw id); the key and the display are stored separately, so the row keys on the id while rendering a clean name. An invalid or non-survivor id falls back to resolving `name`. It is food-only (a canonical id implies food). `domain` (default 'grocery') is the kind of store it's bought at (grocery | home-improvement | garden | pharmacy | …) — set it for a non-grocery item (e.g. '2x4 lumber' → 'home-improvement'). `substitutes_for` (optional) is the recipe ingredient this added item STANDS IN FOR when the add is a taste swap you or the member chose (e.g. substitutes_for: 'sour cream') — it only records the swap for later suggestions (best-effort, food items only); it does NOT change the row, its quantity, or the order, and a same-ingredient product/price swap needs none.";

/** One `update_grocery_list` operation — the `update_pantry` ops idiom. `add`/`update`
 *  share most fields (unused ones ignored per op); `remove` needs only `name`. */
const GROCERY_OP_SCHEMA = z.object({
  op: z.enum(["add", "update", "remove"]),
  name: z.string().optional(),
  id: z.string().optional(),
  quantity: z.string().optional(),
  kind: z.enum(["grocery", "household", "other"]).optional(),
  domain: z.string().optional(),
  status: z.enum(["active", "in_cart", "ordered"]).optional(),
  source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
  for_recipes: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  substitutes_for: z.string().optional(),
});

type GroceryOp = z.infer<typeof GROCERY_OP_SCHEMA>;

/** One `applied` entry the ops-form (or its old-form conversion) reports back. */
type GroceryOpApplied =
  | { op: "add"; item: GroceryItem; merged?: true }
  | { op: "update"; item: GroceryItem }
  | { op: "remove"; name: string; removed: boolean };

interface GroceryOpConflict {
  op: "add" | "update" | "remove";
  name?: string;
  reason: string;
  code?: string;
}

/**
 * Apply one grocery-list operation against D1, returning what it did. Never throws a
 * `ToolError` for a per-op semantic failure (an update/remove target that doesn't
 * resolve, an illegal status transition) — the ops-form caller (below) catches those
 * into a `conflicts` entry so one bad op in a multi-op call never sinks the rest; an
 * unexpected (non-ToolError) failure still propagates.
 */
async function applyOneGroceryOp(env: Env, username: string, op: GroceryOp): Promise<GroceryOpApplied> {
  if (op.op === "add") {
    const result = await addGroceryRow(env, username, op as GroceryAddInput, today());
    return result.merged ? { op: "add", item: result.item, merged: true } : { op: "add", item: result.item };
  }
  if (op.op === "remove") {
    if (!op.name) throw new ToolError("validation_failed", "a remove operation requires a name");
    const { found } = await removeGroceryRow(env, username, op.name);
    return { op: "remove", name: op.name, removed: found };
  }
  // "update"
  if (!op.name) throw new ToolError("validation_failed", "an update operation requires a name");
  const { name, op: _op, id: _id, substitutes_for: _sf, ...patch } = op;
  const item = await updateGroceryRow(env, username, name, patch as GroceryUpdateInput, today());
  return { op: "update", item };
}

export function registerGroceryListTools(
  server: McpServer,
  env: Env,
  username: string,
): void {
  // There is no read_grocery_list successor tool (grocery-list): read_to_buy is the
  // reasoning read, display_grocery_list the member-facing verb, read_grocery_snapshot
  // the app-plane boot read — one list surface per plane. The former add_to_grocery_list/
  // remove_from_grocery_list dispatch aliases are closed (operator waiver,
  // close-cull-windows): capture goes through ops-form update_grocery_list only; a stale
  // call to either retired name gets the generic unknown-tool rejection.
  server.registerTool(
    "update_grocery_list",
    {
      description:
        "Apply grocery-list operations — `{ op: \"add\"|\"update\"|\"remove\", … }` (the update_pantry ops idiom), one call per turn's worth of writes, with per-op applied/conflicts reporting so one bad op never sinks the rest. `add` carries the FULL former add_to_grocery_list contract: " +
        ADD_DESCRIPTION +
        " `update` patches an existing item by `name` — every mutation advances row_version/updated_at and preserves checked_at unless the narrow checked tool changes it; status is orthogonal to checked; `status: \"ordered\"` is accepted only as the compatible per-row in_cart purchase assertion (when a send id is available prefer mark_grocery_send_placed for an exact atomic whole-send assertion); an illegal transition is reported as a conflict, not a thrown error. `remove` deletes by `name` and never records spend. The retired single-patch call form — `{ name, ...patch }` with no `operations` — is rejected as `malformed_data` naming this ops form; nothing is written.",
      inputSchema: {
        operations: z.array(GROCERY_OP_SCHEMA).optional(),
        // The retired single-patch fields (closed by operator waiver; recognized when
        // `operations` is absent). Kept typed here — rather than dropped from the shape —
        // so a badly-typed old-form call (e.g. quantity as a number) still fails zod's
        // normal input validation instead of being silently stripped into indistinguishable
        // garbage; the handler below rejects any non-ops-form call as `malformed_data`.
        name: z.string().optional(),
        quantity: z.string().optional(),
        kind: z.enum(["grocery", "household", "other"]).optional(),
        domain: z.string().optional(),
        status: z.enum(["active", "in_cart", "ordered"]).optional(),
        source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
        for_recipes: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        if (Array.isArray(input.operations)) {
          const applied: GroceryOpApplied[] = [];
          const conflicts: GroceryOpConflict[] = [];
          for (const op of input.operations) {
            try {
              applied.push(await applyOneGroceryOp(env, username, op));
            } catch (e) {
              if (e instanceof ToolError) {
                conflicts.push({ op: op.op, name: op.name, reason: e.message, code: e.code });
              } else {
                throw e;
              }
            }
          }
          return { applied, conflicts };
        }
        // The retired single-patch form — `{ name, ...patch }` with no `operations` — is
        // closed (operator waiver): reject naming the ops form; nothing is written.
        throw new ToolError(
          "malformed_data",
          "update_grocery_list requires the ops form: { operations: [{ op: \"add\"|\"update\"|\"remove\", … }] } — the single-item { name, ...patch } form is retired",
        );
      }),
  );
}

// Exported for use by order-tools.ts (place_order reads the full list).
export { type GroceryItem, type GroceryAddInput };

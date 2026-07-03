// D1 layer for the satellite order-fill issued-set record (satellite-order-cart-fill): the
// `order_lists` table's mint / lookup / mark-received / prune helpers. All access goes through
// src/db.ts so a D1 failure surfaces as a structured storage_error, never a raw throw (D4).
//
// Order-fill has no pull-channel task, so its authoritative record is the ISSUED order-list — a
// Worker-created row naming exactly which canonical ids the Worker handed this tenant (the
// `item_ids` set the receipt is validated against). The pull-list mints one row per Refresh; the
// receipt references it by id and advances only ids in `item_ids`. `received` rows are retained as
// the audit trail; orphaned `issued` rows (Refreshed then abandoned) are reaped on the cron.

import { db } from "./db.js";
import type { Env } from "./env.js";

/** Retention for an orphaned `issued` order-list (Refreshed but never received) before the cron reaps it. */
export const ORDER_LIST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** A raw `order_lists` row (`item_ids` still a JSON string; parse with `parseItemIds`). */
export interface OrderListRow {
  id: string;
  tenant: string;
  store: string;
  location_id: string | null;
  item_ids: string;
  status: string; // 'issued' | 'received'
  created_at: number;
  received_at: number | null;
}

/** Random hex of `bytes` length (2 hex chars per byte) — the opaque order-list id suffix. */
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The issued set carried on a new order-list (the canonical ids handed to the tenant). */
export interface NewOrderList {
  tenant: string;
  store: string;
  locationId: string | null;
  itemIds: string[];
}

/**
 * Mint one `order_lists` row for a Refresh, recording the AUTHORITATIVE issued set (`itemIds`,
 * serialized to JSON). Returns the new opaque id (the receipt correlation key). Status starts
 * `issued`; a receipt moves it to `received`.
 */
export async function insertOrderList(env: Env, list: NewOrderList, now: number = Date.now()): Promise<string> {
  const id = "ol_" + randomHex(8);
  await db(env).run(
    "INSERT INTO order_lists (id, tenant, store, location_id, item_ids, status, created_at, received_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, 'issued', ?6, NULL)",
    id,
    list.tenant,
    list.store,
    list.locationId,
    JSON.stringify(list.itemIds),
    now,
  );
  return id;
}

/** Load one order-list row by id (the receipt's correlation lookup; NULL = unknown id). */
export async function getOrderList(env: Env, id: string): Promise<OrderListRow | null> {
  const row = await db(env).first<OrderListRow>(
    "SELECT id, tenant, store, location_id, item_ids, status, created_at, received_at FROM order_lists WHERE id = ?1",
    id,
  );
  return row ?? null;
}

/** Parse an order-list's `item_ids` JSON into the issued canonical-id set (tolerant of a corrupt column → []). */
export function parseItemIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Mark an order-list `received`, stamping `received_at` on the FIRST application (COALESCE keeps the
 * original timestamp on a re-post) for audit. Idempotent — re-applying a receipt converges rather
 * than double-acting. Returns the resulting status.
 */
export async function markOrderListReceived(env: Env, id: string, now: number = Date.now()): Promise<string> {
  await db(env).run(
    "UPDATE order_lists SET status = 'received', received_at = COALESCE(received_at, ?2) WHERE id = ?1",
    id,
    now,
  );
  return "received";
}

/**
 * Prune orphaned `issued` order-lists (Refreshed but never received) whose `created_at` is older
 * than `olderThan` epoch ms — the order-fill analog of `pruneTerminalTasks` (satellite-tasks-db.ts).
 * `received` rows are RETAINED as the audit trail; only orphaned `issued` rows are reaped, so the
 * table stays bounded despite a Refresh-and-abandon leaving a row forever. Returns the pruned count.
 */
export async function pruneStaleOrderLists(env: Env, olderThan: number): Promise<number> {
  const res = await db(env).run(
    "DELETE FROM order_lists WHERE status = 'issued' AND created_at < ?1",
    olderThan,
  );
  return res.changes;
}

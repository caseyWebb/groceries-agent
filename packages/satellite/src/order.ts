// The order-fill client (satellite-order-cart-fill) — the satellite's OUTBOUND half of the two
// DIRECT `/satellite/order/*` request/response endpoints. Unlike the pull channel (claim/lease/task)
// this is a plain request/response: the human-run local helper FETCHES the tenant's to-buy pull-list
// (`POST /satellite/order/list`) and, after driving the cart to review, POSTS the receipt
// (`POST /satellite/order/receipt`). The Worker never dials in. Reuses the transport/backoff idioms
// from ./push.ts and ./pull.ts (`FetchImpl`, exponential backoff, injectable sleep for fast tests).
//
// A store cart write is a NON-idempotent side effect, so the safety rests on the human (fill-cart-
// never-checkout, Decision 6), NOT on a retry being harmless — but these two calls are themselves
// safe to retry: `list` re-mints (a fresh issued-set) and `receipt` application is idempotent on the
// Worker side (a re-posted receipt converges). Terminal 4xx (bad key / forbidden / wrong-mode /
// bad-payload / unknown list) are NOT retried; 429 / 5xx / network are, with backoff.

import type { OrderListResponse, OrderReceiptRequest, OrderReceiptResponse } from "@yamp/contract";
import type { FetchImpl, PushOptions } from "./push.js";

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The coarse outcome of a pull-list fetch. */
export type OrderListOutcome =
  | { result: "ok"; list: OrderListResponse }
  | { result: "bad_key" } // 401 — the ingest key is unknown/revoked (no retry)
  | { result: "forbidden"; error: string } // 403 — an operator-global (unbound) key has no order-list (no retry)
  | { result: "wrong_mode"; error: string } // 409 — a Kroger/Worker-native or plain-walk primary (no retry)
  | { result: "rate_limited" } // 429 — after exhausting retries
  | { result: "error"; error: string }; // 5xx / network after retries

/** The coarse outcome of a receipt post. */
export type ReceiptOutcome =
  | { result: "ok"; response: OrderReceiptResponse }
  | { result: "bad_key" } // 401 (no retry)
  | { result: "forbidden"; error: string } // 403 — a non-tenant-bound key (no retry)
  | { result: "bad_payload"; error: string } // 400 — a malformed receipt (no retry)
  | { result: "not_found" } // 404 — a foreign/unknown order-list id (no retry)
  | { result: "rate_limited" } // 429 — after exhausting retries
  | { result: "error"; error: string }; // 5xx / network after retries

/** Read a JSON error body's `message` (best-effort), for surfacing a structured error to the human. */
async function readMessage(read: () => Promise<unknown>, fallback: string): Promise<string> {
  const body = (await read().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === "string" && body.message ? body.message : fallback;
}

/**
 * POST /satellite/order/list — fetch the tenant's freshly-resolved to-buy pull-list (the body is an
 * empty object; the server resolves everything from the tenant-bound key). 401→bad_key, 403→forbidden
 * (operator-global key), 409→wrong_mode (Kroger/walk primary) — none retried; 429/5xx/network retried
 * with backoff. Never throws.
 */
export async function fetchOrderList(
  connectorUrl: string,
  key: string,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  options: PushOptions = {},
): Promise<OrderListOutcome> {
  const url = `${connectorUrl.replace(/\/+$/, "")}/satellite/order/list`;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const body = JSON.stringify({});

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: number;
    let read: () => Promise<unknown>;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
      });
      status = res.status;
      read = res.json;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    if (status === 200) {
      const list = (await read().catch(() => null)) as OrderListResponse | null;
      if (!list) {
        lastError = "malformed order-list response";
        if (attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        return { result: "error", error: lastError };
      }
      return { result: "ok", list };
    }
    if (status === 401) return { result: "bad_key" };
    if (status === 403) return { result: "forbidden", error: await readMessage(read, "forbidden") };
    if (status === 409) return { result: "wrong_mode", error: await readMessage(read, "wrong fulfillment mode") };
    // 429 / 5xx / any other non-2xx — back off and retry.
    lastError = `http ${status}`;
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    return status === 429 ? { result: "rate_limited" } : { result: "error", error: lastError };
  }
  return { result: "error", error: lastError };
}

/**
 * POST /satellite/order/receipt — land the assembled cart-fill receipt (the issued `order_list_id`,
 * the per-item `order` observations, and the optional `mark_placed` flag). 401→bad_key,
 * 403→forbidden, 400→bad_payload, 404→not_found (a foreign/unknown order-list) — none retried;
 * 429/5xx/network retried with backoff (the Worker applies a receipt idempotently, so a retry
 * converges). Never throws.
 */
export async function postReceipt(
  connectorUrl: string,
  key: string,
  receipt: OrderReceiptRequest,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  options: PushOptions = {},
): Promise<ReceiptOutcome> {
  const url = `${connectorUrl.replace(/\/+$/, "")}/satellite/order/receipt`;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;
  const body = JSON.stringify(receipt);

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status: number;
    let read: () => Promise<unknown>;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
      });
      status = res.status;
      read = res.json;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    if (status === 200) {
      const response = (await read().catch(() => null)) as OrderReceiptResponse | null;
      if (!response) {
        lastError = "malformed order-receipt response";
        if (attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        return { result: "error", error: lastError };
      }
      return { result: "ok", response };
    }
    if (status === 401) return { result: "bad_key" };
    if (status === 403) return { result: "forbidden", error: await readMessage(read, "forbidden") };
    if (status === 400) return { result: "bad_payload", error: await readMessage(read, "bad payload") };
    if (status === 404) return { result: "not_found" }; // the order-list is gone/foreign — no retry
    // 429 / 5xx / any other non-2xx — back off and retry.
    lastError = `http ${status}`;
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
      continue;
    }
    return status === 429 ? { result: "rate_limited" } : { result: "error", error: lastError };
  }
  return { result: "error", error: lastError };
}

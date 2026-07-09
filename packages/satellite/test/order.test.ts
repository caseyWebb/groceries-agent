import { describe, expect, it, vi } from "vitest";
import type { OrderListResponse, OrderReceiptRequest, OrderReceiptResponse } from "@yamp/contract";
import { fetchOrderList, postReceipt } from "../src/order.js";
import type { FetchImpl } from "../src/push.js";

// The order-fill client (satellite-order-cart-fill): the OUTBOUND half of the two direct
// `/satellite/order/*` endpoints. Fixture-based — no network. Locks the request shapes (POST + bearer
// key) and the status→outcome mapping (terminal 4xx not retried; 429/5xx retried with backoff).

const CONNECTOR = "https://mcp.example";
const KEY = "ingest-key-123";
const noWait = { baseDelayMs: 0, sleep: () => Promise.resolve() };

/** A fake fetch that returns a canned status + body, recording the calls it saw (mirrors push.test.ts). */
function fakeFetch(responses: Array<{ status: number; body: unknown }>): FetchImpl & { calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] } {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  let i = 0;
  const impl = ((url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) });
  }) as FetchImpl & { calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] };
  impl.calls = calls;
  return impl;
}

const listBody: OrderListResponse = {
  order_list_id: "ol_1",
  store: "target",
  location_id: "T-1",
  items: [{ item_id: "milk", name: "milk", quantity: 1, for_recipes: ["stew"], assumed_quantity: false }],
  partials: [],
};

const receiptBody: OrderReceiptResponse = {
  order_list: { id: "ol_1", status: "received" },
  results: [{ disposition: "accepted", source: "milk" }],
};

const receipt = (over: Partial<OrderReceiptRequest> = {}): OrderReceiptRequest => ({
  order_list_id: "ol_1",
  observations: [{ kind: "order", item_id: "milk", disposition: "carted", product: { productId: "p1", description: "Milk" } }],
  ...over,
});

describe("fetchOrderList", () => {
  it("maps 200 to ok and POSTs {} to /satellite/order/list with the bearer key", async () => {
    const f = fakeFetch([{ status: 200, body: listBody }]);
    const out = await fetchOrderList(CONNECTOR, KEY, f, noWait);
    expect(out.result).toBe("ok");
    if (out.result === "ok") expect(out.list.order_list_id).toBe("ol_1");
    const call = f.calls[0];
    expect(call.url).toBe("https://mcp.example/satellite/order/list");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.init.body).toBe("{}");
  });

  it("maps 401 to bad_key without retrying", async () => {
    const f = fakeFetch([{ status: 401, body: { error: "bad_key" } }]);
    const out = await fetchOrderList(CONNECTOR, KEY, f, noWait);
    expect(out.result).toBe("bad_key");
    expect(f.calls).toHaveLength(1);
  });

  it("maps 403 to forbidden with the server message (operator-global key)", async () => {
    const f = fakeFetch([{ status: 403, body: { error: "forbidden", message: "order-fill requires a tenant-bound ingest key" } }]);
    const out = await fetchOrderList(CONNECTOR, KEY, f, noWait);
    expect(out.result).toBe("forbidden");
    if (out.result === "forbidden") expect(out.error).toMatch(/tenant-bound/);
    expect(f.calls).toHaveLength(1);
  });

  it("maps 409 to wrong_mode with the server message (Kroger/walk primary)", async () => {
    const f = fakeFetch([{ status: 409, body: { error: "wrong_fulfillment_mode", message: "primary store is Kroger" } }]);
    const out = await fetchOrderList(CONNECTOR, KEY, f, noWait);
    expect(out.result).toBe("wrong_mode");
    if (out.result === "wrong_mode") expect(out.error).toMatch(/Kroger/);
    expect(f.calls).toHaveLength(1);
  });

  it("retries a 503 then succeeds", async () => {
    const f = fakeFetch([
      { status: 503, body: { error: "storage_error" } },
      { status: 200, body: listBody },
    ]);
    const sleep = vi.fn(() => Promise.resolve());
    const out = await fetchOrderList(CONNECTOR, KEY, f, { baseDelayMs: 1, sleep });
    expect(out.result).toBe("ok");
    expect(f.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up as rate_limited after exhausting retries on persistent 429", async () => {
    const f = fakeFetch([{ status: 429, body: {} }]);
    const out = await fetchOrderList(CONNECTOR, KEY, f, { maxAttempts: 3, ...noWait });
    expect(out.result).toBe("rate_limited");
    expect(f.calls).toHaveLength(3);
  });
});

describe("postReceipt", () => {
  it("maps 200 to ok and POSTs the receipt to /satellite/order/receipt", async () => {
    const f = fakeFetch([{ status: 200, body: receiptBody }]);
    const out = await postReceipt(CONNECTOR, KEY, receipt(), f, noWait);
    expect(out.result).toBe("ok");
    if (out.result === "ok") expect(out.response.order_list.status).toBe("received");
    const call = f.calls[0];
    expect(call.url).toBe("https://mcp.example/satellite/order/receipt");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(call.init.body)).toMatchObject({ order_list_id: "ol_1" });
  });

  it("carries the mark_placed flag through", async () => {
    const f = fakeFetch([{ status: 200, body: receiptBody }]);
    await postReceipt(CONNECTOR, KEY, receipt({ observations: undefined, mark_placed: true }), f, noWait);
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({ order_list_id: "ol_1", mark_placed: true });
  });

  it("maps 404 to not_found without retrying (foreign/unknown order-list)", async () => {
    const f = fakeFetch([{ status: 404, body: { error: "not_found" } }]);
    const out = await postReceipt(CONNECTOR, KEY, receipt(), f, noWait);
    expect(out.result).toBe("not_found");
    expect(f.calls).toHaveLength(1);
  });

  it("maps 400 to bad_payload with the server message", async () => {
    const f = fakeFetch([{ status: 400, body: { error: "bad_payload", message: "order_list_id: too short" } }]);
    const out = await postReceipt(CONNECTOR, KEY, receipt(), f, noWait);
    expect(out.result).toBe("bad_payload");
    if (out.result === "bad_payload") expect(out.error).toMatch(/too short/);
    expect(f.calls).toHaveLength(1);
  });

  it("maps 401 to bad_key without retrying", async () => {
    const f = fakeFetch([{ status: 401, body: { error: "bad_key" } }]);
    const out = await postReceipt(CONNECTOR, KEY, receipt(), f, noWait);
    expect(out.result).toBe("bad_key");
    expect(f.calls).toHaveLength(1);
  });

  it("retries a 500 then succeeds (idempotent re-post converges)", async () => {
    const f = fakeFetch([
      { status: 500, body: {} },
      { status: 200, body: receiptBody },
    ]);
    const out = await postReceipt(CONNECTOR, KEY, receipt(), f, { baseDelayMs: 1, sleep: () => Promise.resolve() });
    expect(out.result).toBe("ok");
    expect(f.calls).toHaveLength(2);
  });
});

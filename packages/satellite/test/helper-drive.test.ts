import { describe, expect, it } from "vitest";
import { Drive, toCheckpointResolution, type DriveDeps, type DriveEvent } from "../src/helper/drive.js";
import type { OrderAdapterFactory } from "../src/order-adapter.js";
import type { OrderLine, OrderObservation } from "@grocery-agent/contract";

// The cart-fill DRIVE orchestration (satellite-order-cart-fill): a fake adapter + a fake page (no
// real browser) exercise the crux — per-item progress, the human checkpoint blocking round-trip, the
// sensor-not-judge gate on returned emits, and the terminal review-ready / error transitions.

const lines: OrderLine[] = [
  { item_id: "milk", name: "Milk", quantity: 1, for_recipes: ["stew"], assumed_quantity: false },
  { item_id: "eggs", name: "Eggs", quantity: 1, for_recipes: [], assumed_quantity: false },
];

const silentLog = { info() {}, warn() {}, error() {} };
const fakePage = () => ({}) as never;
const openPage = async () => ({ page: fakePage(), close: async () => {} });

const deps = (adapterFactory: OrderAdapterFactory): DriveDeps => ({
  store: { store: "target", adapter: "target" },
  config: { connector_url: "https://mcp.example", sources: [] },
  session: null,
  adapterFactory,
  openPage,
  log: silentLog,
});

/** Poll a predicate until true or the deadline — the UI does the same over SSE/status. */
async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("Drive — the checkpoint blocking round-trip", () => {
  it("emits progress, BLOCKS on a checkpoint, resolves via resolveCheckpoint, then reaches review-ready", async () => {
    const factory: OrderAdapterFactory = () => ({
      id: "fake",
      async fill(sdk, ls) {
        const out: OrderObservation[] = [];
        // Optional live progress via the { progress } log extra.
        sdk.log.info("adding milk", { progress: { item_id: "milk", state: "adding" } });
        const res = await sdk.checkpoint({ item_id: "milk", message: "pick a match", options: [{ productId: "p1", description: "Milk A" }] });
        if (res.action === "select") {
          out.push({ kind: "order", item_id: "milk", disposition: "carted", product: { productId: res.productId, description: "Milk A" } });
        }
        // A second line, unavailable, exercises the terminal-from-return path (no live progress).
        out.push({ kind: "order", item_id: ls[1].item_id, disposition: "unavailable", note: "out of stock" });
        return out;
      },
    });

    const d = new Drive("d1");
    const events: DriveEvent[] = [];
    d.subscribe((e) => events.push(e));
    const done = d.run(deps(factory), lines);

    // The adapter BLOCKS at the checkpoint — the drive is still running, not review-ready.
    await waitFor(() => d.pendingCheckpoint !== null);
    expect(d.phase).toBe("running");
    expect(d.pendingCheckpoint?.item_id).toBe("milk");
    expect(d.pendingCheckpoint?.options[0].productId).toBe("p1");
    // The live "adding" progress surfaced.
    expect(events.some((e) => e.type === "item" && e.state === "adding")).toBe(true);

    // The human resolves — the blocked adapter continues.
    const ok = d.resolveCheckpoint(d.pendingCheckpoint!.checkpoint_id, { action: "select", productId: "p1" });
    expect(ok).toBe(true);

    await done;
    expect(d.phase).toBe("review-ready");
    expect(d.observations.map((o) => o.item_id)).toEqual(["milk", "eggs"]);
    expect(d.observations[0].disposition).toBe("carted");
    expect(d.observations[1].disposition).toBe("unavailable");
    expect(events.some((e) => e.type === "review-ready")).toBe(true);
  });

  it("returns false for an unknown / already-resolved checkpoint id", async () => {
    const d = new Drive("d2");
    expect(d.resolveCheckpoint("cp_nope", { action: "skip" })).toBe(false);
  });
});

describe("Drive — the sensor-not-judge gate and terminal errors", () => {
  it("drops a returned emit that smuggles a derived grocery-list state field", async () => {
    const factory: OrderAdapterFactory = () => ({
      id: "bad",
      async fill() {
        // `status` is a derived grocery-list field — validateOrderEmit rejects it, so it is NOT collected.
        return [{ kind: "order", item_id: "milk", disposition: "carted", status: "in_cart" } as unknown as OrderObservation];
      },
    });
    const d = new Drive("d3");
    await d.run(deps(factory), lines);
    expect(d.phase).toBe("review-ready");
    expect(d.observations).toHaveLength(0);
  });

  it("surfaces an adapter structured error as a terminal error", async () => {
    const factory: OrderAdapterFactory = () => ({
      id: "err",
      async fill() {
        return { error: "session expired" };
      },
    });
    const d = new Drive("d4");
    await d.run(deps(factory), lines);
    expect(d.phase).toBe("error");
    expect(d.error?.code).toBe("adapter_error");
    expect(d.error?.message).toMatch(/session expired/);
  });

  it("surfaces an adapter throw as a terminal error", async () => {
    const factory: OrderAdapterFactory = () => ({
      id: "throw",
      async fill() {
        throw new Error("DOM changed");
      },
    });
    const d = new Drive("d5");
    await d.run(deps(factory), lines);
    expect(d.phase).toBe("error");
    expect(d.error?.code).toBe("fill_threw");
  });
});

describe("toCheckpointResolution — wire → SDK mapping (human is the only resolver)", () => {
  it("maps pick / substitute / skip / abort", () => {
    expect(toCheckpointResolution({ pick: { productId: "p1" } })).toEqual({ action: "select", productId: "p1" });
    expect(toCheckpointResolution({ substitute: { productId: "p2", description: "X" } })).toEqual({
      action: "substitute",
      product: { productId: "p2", description: "X", size: undefined, price: undefined, url: undefined },
    });
    expect(toCheckpointResolution({ skip: true })).toEqual({ action: "skip" });
    expect(toCheckpointResolution({ abort: true })).toEqual({ action: "abort" });
  });

  it("returns null for a malformed / unknown resolution", () => {
    expect(toCheckpointResolution({})).toBeNull();
    expect(toCheckpointResolution({ pick: {} })).toBeNull();
    expect(toCheckpointResolution(null)).toBeNull();
    expect(toCheckpointResolution("skip")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { draftProposals, proposalId } from "../src/reconcile-signals.js";
import type { NightVibe } from "../src/night-vibe-db.js";
import { enqueueProposal, readProposals, setProposalStatus, getProposal } from "../src/reconcile-db.js";
import { fakeD1 } from "./fake-d1.js";

const NOW = new Date("2026-07-01T00:00:00Z");

function vibe(over: Partial<NightVibe> & { id: string; vibe: string }): NightVibe {
  return { ...over };
}

describe("draftProposals", () => {
  it("proposes PRUNE for a cadence vibe added long ago and never satisfied", () => {
    const palette = [vibe({ id: "salad", vibe: "a light salad", cadence_days: 7, created_at: "2026-04-01T00:00:00Z" })];
    const drafts = draftProposals(palette, new Map(), NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "prune_vibe", target: "salad", payload: { id: "salad" } });
  });

  it("does NOT propose pruning a freshly-added, never-satisfied vibe", () => {
    const palette = [vibe({ id: "new", vibe: "a new idea", cadence_days: 7, created_at: "2026-06-28T00:00:00Z" })];
    expect(draftProposals(palette, new Map(), NOW)).toHaveLength(0);
  });

  it("proposes ADJUST when the real interval runs well past the cadence", () => {
    const palette = [vibe({ id: "pasta", vibe: "weeknight pasta", cadence_days: 7, created_at: "2026-01-01T00:00:00Z" })];
    // last cooked 2026-06-01 → ~30 days ago vs a 7-day cadence (> 3×).
    const drafts = draftProposals(palette, new Map([["pasta", "2026-06-01"]]), NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("adjust_cadence");
    expect((drafts[0].payload as { cadence_days: number }).cadence_days).toBeGreaterThan(7);
  });

  it("proposes nothing for a recently-satisfied or cadence-less vibe", () => {
    const palette = [
      vibe({ id: "pasta", vibe: "weeknight pasta", cadence_days: 7, created_at: "2026-01-01T00:00:00Z" }),
      vibe({ id: "wild", vibe: "a wildcard", created_at: "2026-01-01T00:00:00Z" }), // no cadence
    ];
    const drafts = draftProposals(palette, new Map([["pasta", "2026-06-28"]]), NOW); // 3 days ago
    expect(drafts).toHaveLength(0);
  });

  it("gives a stable, dedup-ing id per (tenant, kind, target)", () => {
    expect(proposalId("a", "prune_vibe", "salad")).toBe(proposalId("a", "prune_vibe", "salad"));
    expect(proposalId("a", "prune_vibe", "salad")).not.toBe(proposalId("b", "prune_vibe", "salad"));
  });
});

describe("pending_proposals store", () => {
  it("enqueues idempotently, reads pending, and resolves on confirm", async () => {
    const d1 = fakeD1({ tables: { pending_proposals: [] } });
    const draft = { kind: "prune_vibe" as const, target: "salad", payload: { id: "salad" }, rationale: "drop it?", evidence: {} };

    const first = await enqueueProposal(d1.env, "everett", draft, "signal-cron", NOW.toISOString());
    expect(first.inserted).toBe(true);
    const again = await enqueueProposal(d1.env, "everett", draft, "signal-cron", NOW.toISOString());
    expect(again.inserted).toBe(false); // stable id → no duplicate

    const pending = await readProposals(d1.env, "everett", "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "prune_vibe", target: "salad", status: "pending" });

    const ok = await setProposalStatus(d1.env, first.id, "everett", "rejected", NOW.toISOString());
    expect(ok).toBe(true);
    expect(await readProposals(d1.env, "everett", "pending")).toHaveLength(0);
    expect((await getProposal(d1.env, first.id, "everett"))?.status).toBe("rejected");
  });
});

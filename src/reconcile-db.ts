// D1 store for the profile-reconciliation queue (`pending_proposals`) + the apply-on-accept
// logic (profile-reconciliation capability). All D1 goes through `src/db.ts`; applying an
// accepted proposal routes to the night-vibe palette writes (add/adjust/prune).

import { db } from "./db.js";
import type { Env } from "./env.js";
import { proposalId, type ProposalDraft } from "./reconcile-signals.js";
import { readNightVibes, upsertNightVibe, deleteNightVibe, type NightVibe } from "./night-vibe-db.js";

/** One decoded proposal row. */
export interface PendingProposal {
  id: string;
  tenant: string;
  kind: string;
  target: string | null;
  payload: Record<string, unknown>;
  rationale: string | null;
  evidence: Record<string, unknown> | null;
  status: "pending" | "accepted" | "rejected";
  producer: string | null;
  created_at: string | null;
}

interface ProposalRow {
  id: string;
  tenant: string;
  kind: string;
  target: string | null;
  payload: string | null;
  rationale: string | null;
  evidence: string | null;
  status: string;
  producer: string | null;
  created_at: string | null;
}

function parseObj(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function decode(r: ProposalRow): PendingProposal {
  return {
    id: r.id,
    tenant: r.tenant,
    kind: r.kind,
    target: r.target,
    payload: parseObj(r.payload),
    rationale: r.rationale,
    evidence: r.evidence ? parseObj(r.evidence) : null,
    status: (r.status as PendingProposal["status"]) ?? "pending",
    producer: r.producer,
    created_at: r.created_at,
  };
}

const COLS = "id, tenant, kind, target, payload, rationale, evidence, status, producer, created_at";

/** A member's proposals, most-recent-first, optionally filtered by status. */
export async function readProposals(env: Env, tenant: string, status?: PendingProposal["status"]): Promise<PendingProposal[]> {
  const rows = status
    ? await db(env).all<ProposalRow>(`SELECT ${COLS} FROM pending_proposals WHERE tenant = ?1 AND status = ?2 ORDER BY created_at DESC`, tenant, status)
    : await db(env).all<ProposalRow>(`SELECT ${COLS} FROM pending_proposals WHERE tenant = ?1 ORDER BY created_at DESC`, tenant);
  return rows.map(decode);
}

/** One proposal scoped to a member (so a member can only touch their own). */
export async function getProposal(env: Env, id: string, tenant: string): Promise<PendingProposal | null> {
  const row = await db(env).first<ProposalRow>(`SELECT ${COLS} FROM pending_proposals WHERE id = ?1 AND tenant = ?2`, id, tenant);
  return row ? decode(row) : null;
}

/** Idempotent enqueue (stable id → INSERT OR IGNORE): re-drafting a live/decided proposal is a
 *  no-op, so a rejected proposal is never re-surfaced. Returns true when a NEW row was inserted. */
export async function enqueueProposal(env: Env, tenant: string, draft: ProposalDraft, producer: string, nowIso: string): Promise<{ id: string; inserted: boolean }> {
  const id = proposalId(tenant, draft.kind, draft.target);
  const r = await db(env).run(
    "INSERT OR IGNORE INTO pending_proposals (id, tenant, kind, target, payload, rationale, evidence, status, producer, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    id,
    tenant,
    draft.kind,
    draft.target,
    JSON.stringify(draft.payload),
    draft.rationale,
    JSON.stringify(draft.evidence),
    "pending",
    producer,
    nowIso,
  );
  return { id, inserted: r.changes > 0 };
}

/** Move a pending proposal to accepted/rejected. Returns true when a pending row was updated. */
export async function setProposalStatus(env: Env, id: string, tenant: string, status: "accepted" | "rejected", nowIso: string): Promise<boolean> {
  const r = await db(env).run(
    "UPDATE pending_proposals SET status = ?3, resolved_at = ?4 WHERE id = ?1 AND tenant = ?2 AND status = 'pending'",
    id,
    tenant,
    status,
    nowIso,
  );
  return r.changes > 0;
}

/**
 * Apply an accepted proposal's diff to the member's palette. add_vibe / adjust_cadence upsert;
 * prune_vibe deletes. Returns a short description of what was applied (or throws a structured
 * storage_error via db.ts). Unknown kinds are a no-op.
 */
export async function applyProposal(env: Env, tenant: string, proposal: PendingProposal, nowIso: string): Promise<string> {
  const p = proposal.payload;
  switch (proposal.kind) {
    case "prune_vibe": {
      const id = typeof p.id === "string" ? p.id : proposal.target ?? "";
      await deleteNightVibe(env, tenant, id);
      return `pruned night vibe ${id}`;
    }
    case "adjust_cadence": {
      const id = typeof p.id === "string" ? p.id : proposal.target ?? "";
      const existing = (await readNightVibes(env, tenant)).find((v) => v.id === id);
      if (!existing) return `no vibe ${id} to adjust`;
      const cadence = typeof p.cadence_days === "number" ? p.cadence_days : existing.cadence_days ?? null;
      await upsertNightVibe(env, tenant, { ...existing, cadence_days: cadence }, nowIso);
      return `adjusted ${id} cadence to ${cadence}`;
    }
    case "add_vibe": {
      const vibe = p as unknown as NightVibe;
      if (!vibe.id || !vibe.vibe) return "add_vibe payload missing id/vibe";
      await upsertNightVibe(env, tenant, vibe, nowIso);
      return `added night vibe ${vibe.id}`;
    }
    default:
      return `unknown proposal kind ${proposal.kind}`;
  }
}

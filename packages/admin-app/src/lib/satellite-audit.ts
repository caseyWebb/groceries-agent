// The Satellites source-audit vocabulary + derivation (admin-spa). Ported from the SSR
// panel's `src/admin/satellite-audit-shared.ts` (the audit prop shapes, the reason/origin
// gloss maps, the display thresholds, and the provenance helpers — the module's pure,
// JSX-free parts) and from `src/admin/pages/satellites.tsx`'s `buildAuditSources` (the
// server-side join of the liveness rollup × the rejection ledger × the quarantine flags,
// now a pure client-side function over the `/admin/api/satellites` payload).
//
// The window/threshold constants MIRROR src/satellite-audit-db.ts's SOURCE_QUALITY_WINDOW_DAYS /
// QUARANTINE_FAIL_RATE_THRESHOLD / QUARANTINE_MIN_SAMPLE — display-only: the recommendation
// itself is computed Worker-side and carried on `AuditQuality.recommendQuarantine`.

import type { SatellitesData } from "./queries";

export type SatelliteRollup = SatellitesData["rollup"];
export type RejectionRow = SatellitesData["rejections"][number];
export type QuarantineRow = SatellitesData["quarantine"][number];
export type RecentPush = SatelliteRollup["pushes"][number];

export type QState = "healthy" | "degrading" | "quarantined";

/** The per-source quality dimension (from the Worker's `readSourceQuality`, dedups excluded). */
export interface AuditQuality {
  accepted: number;
  rejected: number;
  /** accepted + rejected — the rate denominator. */
  sample: number;
  acceptanceRate: number;
  failRate: number;
  /** The fixed-numeric quarantine hint (over the fail-rate threshold with a minimum sample). */
  recommendQuarantine: boolean;
}

/** One aggregated drill-down ledger row: the Worker's count-1 rejects and the pre-aggregated
 *  local-summary rows are grouped by (reason, origin, provenance) — `count` summed, `rejected_at`
 *  the most recent in the group — so identical rejects collapse ("40× contract_invalid"). */
export interface AuditRejection {
  reason: string;
  origin: "worker" | "local";
  provenance: string | null;
  count: number;
  rejected_at: number;
}

export interface AuditQuarantine {
  quarantined_at: number;
  /** The operator note; the Worker persists no actor, so the panel shows the note only. */
  note: string | null;
}

/** A satellite's source row with the audit dimension joined on by {kind, source}. */
export interface AuditSource {
  /** Stable per-row key `${satelliteId}::${kind}::${source}`. */
  key: string;
  satelliteId: string;
  satelliteLabel: string;
  kind: string;
  source: string;
  /** The source's tenant binding — the quarantine flag keys on it so the toggle actually
   *  suppresses intake (the intake check keys off the carrying key's tenant, not the kind). */
  tenant: string | null;
  qstate: QState;
  quality: AuditQuality;
  /** Recency stays owned by liveness (ruling: integrate, don't duplicate) — the quality cell is
   *  accept/fail only. */
  recency: { health: "fresh" | "stale" | "never"; lastPush: number | null; pushes24h: number };
  rejections: AuditRejection[];
  quarantine: AuditQuarantine | null;
}

/** A satellite machine + its audit-joined source rows. */
export interface AuditSatellite {
  id: string;
  label: string;
  health: "fresh" | "stale" | "never";
  lastPush: number | null;
  pushes24h: number;
  sourceCount: number;
  satelliteVersion: string | null;
  contractVersion: string | null;
  skew: boolean;
  sources: AuditSource[];
}

// Reason gloss — broken-adapter framing (a health gauge, never a security verdict).
export const REJECT_REASONS: Record<string, string> = {
  contract_invalid: "the adapter's output no longer matches the expected shape — the site's markup likely changed",
  judgment_smuggled: "the adapter tried to report a derived judgment a sensor must never assert (the Worker derives it)",
  implausible: "a value failed a Worker-side plausibility check (e.g. a 0-minute cook time, 900 servings)",
  quarantined: "rejected on arrival because this source is quarantined",
};

/** Where a reject happened. `local` is the loudest "adapter broke" signal (dropped before the wire). */
export const REJECT_ORIGINS: Record<"worker" | "local", { label: string; gloss: string }> = {
  worker: { label: "worker", gloss: "the Worker rejected it on arrival" },
  local: {
    label: "local",
    gloss: "the satellite's own pre-send check dropped it before it left the machine — the loudest 'adapter broke' signal",
  },
};

export const AUDIT_WINDOW_DAYS = 60;
export const AUDIT_WINDOW_LABEL = `${AUDIT_WINDOW_DAYS} days`;
export const AUDIT_FAIL_THRESHOLD = 0.3;
export const AUDIT_MIN_SAMPLE = 20;

/** A provenance string is actionable when it is an http(s) URL (ruling #5). */
export function isUrlProvenance(prov: string | null): prov is string {
  return prov != null && /^https?:\/\//.test(prov);
}

/** Shorten a URL for display (drop the scheme + a trailing slash). */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;

// ── Derivation: join the audit dimension onto each satellite's source rows ──────────────────────

/** NUL-delimited composite key matching the Worker's `{tenant, kind, source}` accounting keys. */
const qKey = (tenant: string | null, kind: string, source: string): string =>
  `${tenant ?? ""}\u0000${kind}\u0000${source}`;

/**
 * Build the per-satellite audit rows: join the Worker's per-`{tenant, kind, source}` quality rollup,
 * the ledger's rejections, and the quarantine flags onto each satellite's liveness source rows by name
 * (ruling #1). Liveness sources come from the recipe push log (`ingest_pushes`), so they are `recipe`
 * kind, keyed off the satellite's tenant binding — every join is `{tenant: sat.tenant, kind: "recipe",
 * source}`, and `kind` is threaded through props/route/`readRejections` (ruling #2) so a same-named
 * source of another kind never merges. Ledger rows are aggregated by (reason, origin, provenance) with
 * counts summed (ruling #3) — the Worker's count-1 rejects collapse and a pre-aggregated local flood
 * keeps its count.
 */
export function buildAuditSources(
  rollup: SatelliteRollup,
  rejections: RejectionRow[],
  quarantine: QuarantineRow[],
): AuditSatellite[] {
  const qualityIx = new Map(rollup.quality.map((q) => [qKey(q.tenant, q.kind, q.source), q]));
  const quarantineIx = new Map(quarantine.map((q) => [qKey(q.tenant, q.kind, q.source), q]));

  // Group ledger rows by {tenant, kind, source} → aggregated (reason, origin, provenance) rows.
  const rejByKey = new Map<string, AuditRejection[]>();
  for (const r of rejections) {
    const k = qKey(r.tenant, r.kind, r.source);
    let group = rejByKey.get(k);
    if (!group) rejByKey.set(k, (group = []));
    const gk = `${r.reason}\u0000${r.origin}\u0000${r.provenance ?? ""}`;
    const existing = group.find((x) => `${x.reason}\u0000${x.origin}\u0000${x.provenance ?? ""}` === gk);
    if (existing) {
      existing.count += r.count;
      existing.rejected_at = Math.max(existing.rejected_at, r.rejected_at);
    } else {
      group.push({ reason: r.reason, origin: r.origin, provenance: r.provenance, count: r.count, rejected_at: r.rejected_at });
    }
  }

  return rollup.activeSatellites.map((sat): AuditSatellite => {
    const sources: AuditSource[] = sat.sources.map((src): AuditSource => {
      const kind = "recipe"; // liveness sources are recipe pushes; kind is threaded for correctness
      const key = qKey(sat.tenant, kind, src.name);
      const q = qualityIx.get(key);
      const quarantined = quarantineIx.get(key) ?? null;
      const quality = {
        accepted: q?.accepted ?? 0,
        rejected: q?.rejected ?? 0,
        sample: q?.sample ?? 0,
        acceptanceRate: q?.acceptanceRate ?? 0,
        failRate: q?.failRate ?? 0,
        recommendQuarantine: q?.recommendQuarantine ?? false,
      };
      const qstate: QState = quarantined ? "quarantined" : quality.recommendQuarantine ? "degrading" : "healthy";
      const rejs = (rejByKey.get(key) ?? []).slice().sort((a, b) => b.rejected_at - a.rejected_at);
      return {
        key: `${sat.id}::${kind}::${src.name}`,
        satelliteId: sat.id,
        satelliteLabel: sat.label,
        kind,
        source: src.name,
        tenant: sat.tenant,
        qstate,
        quality,
        recency: { health: src.health, lastPush: src.lastPush, pushes24h: src.pushes24h },
        rejections: rejs,
        quarantine: quarantined ? { quarantined_at: quarantined.quarantined_at, note: quarantined.note } : null,
      };
    });
    return {
      id: sat.id,
      label: sat.label,
      health: sat.health,
      lastPush: sat.lastPush,
      pushes24h: sat.pushes24h,
      sourceCount: sat.sourceCount,
      satelliteVersion: sat.satelliteVersion,
      contractVersion: sat.contractVersion,
      skew: sat.skew,
      sources,
    };
  });
}

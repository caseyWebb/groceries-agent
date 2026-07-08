// Discovery › Satellites (admin-spa): the operator liveness view of satellite ingest with the
// source-health audit, ported from the SSR panel's pages/satellites.tsx + client/satellite-audit.tsx.
// One ["satellites"] query carries { rollup, rejections, quarantine, now }; the audit rows are
// derived client-side by lib/satellite-audit's buildAuditSources (the same join the SSR page ran
// server-side). The quarantine hold/clear is THE optimistic mutation (design D3): onMutate patches
// the cached payload's quarantine flags so the held block appears/disappears immediately;
// onError/onSettled invalidate ["satellites"].

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@grocery-agent/ui";
import { api, apiErrorOf, unwrap } from "../lib/api";
import { satellitesQuery, queryClient, type SatellitesData } from "../lib/queries";
import { assertNever } from "../lib/assert";
import { relAge } from "../lib/format";
import { StatCardGrid, StatCard, Badge, Button, DataTable, ErrorBanner } from "../components/kit";
import {
  InboxIcon,
  ActivityIcon,
  AlertTriangleIcon,
  BanIcon,
  ShieldIcon,
  ScanIcon,
  RotateIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
} from "../components/icons";
import {
  REJECT_REASONS,
  REJECT_ORIGINS,
  AUDIT_WINDOW_LABEL,
  AUDIT_FAIL_THRESHOLD,
  isUrlProvenance,
  shortUrl,
  pct,
  buildAuditSources,
  type SatelliteRollup,
  type RecentPush,
  type AuditSatellite,
  type AuditSource,
  type AuditRejection,
} from "../lib/satellite-audit";
import { DiscoverySubNav } from "./discovery";

/** The single quarantine note the operator toggle persists (the Worker records no actor). */
const QUARANTINE_NOTE = "quarantined by the operator from the source-health audit";

const RESULT_LABEL: Record<RecentPush["result"], string> = {
  accepted: "Accepted",
  partial: "Partially deduped",
  bad_payload: "Rejected · bad payload",
  bad_key: "Rejected · bad key",
};

/** The `{tenant, kind, source}` identity a quarantine flag keys on. */
function sameQuarantineKey(row: { tenant: string | null; kind: string; source: string }, src: AuditSource): boolean {
  return (row.tenant ?? null) === (src.tenant ?? null) && row.kind === src.kind && row.source === src.source;
}

// ── The audit hero (ported AuditHero — interactivity is plain component state) ──────────────────

const HealthDot = ({ health }: { health: "fresh" | "stale" | "never" }) => (
  <span className={`dot ${health === "fresh" ? "ok" : health === "stale" ? "fail" : "never"}`} />
);

/** The compact accept/fail bar beside recency (ruling #6: quality only — recency is the dot/meta). */
const QualityCell = ({ src }: { src: AuditSource }) => {
  const acc = Math.round(src.quality.acceptanceRate * 100);
  const fail = Math.round(src.quality.failRate * 100);
  if (src.qstate === "quarantined") {
    return (
      <span className="ig-qual quarantined" title="observations are being rejected on purpose">
        <span className="ig-qbar held">
          <span className="ig-qbar-ok" style={{ width: `${acc}%` }} />
          <span className="ig-qbar-bad" style={{ width: `${100 - acc}%` }} />
        </span>
        <span className="ig-qual-lbl q-held">
          <BanIcon size={11} /> rejecting
        </span>
      </span>
    );
  }
  if (src.quality.sample === 0) {
    return (
      <span className="ig-qual" title="no observations in the audit window yet">
        <span className="ig-qbar" />
        <span className="ig-qual-lbl muted">awaiting signal</span>
      </span>
    );
  }
  const degrading = src.qstate === "degrading";
  return (
    <span className="ig-qual" title={`${acc}% accepted · ${fail}% failing validation, last ${AUDIT_WINDOW_LABEL}`}>
      <span className="ig-qbar">
        <span className="ig-qbar-ok" style={{ width: `${acc}%` }} />
        <span className="ig-qbar-bad" style={{ width: `${fail}%` }} />
      </span>
      <span className={`ig-qual-lbl ${degrading ? "q-warn" : "q-ok"}`}>{degrading ? `${fail}% failing` : `${acc}% ok`}</span>
    </span>
  );
};

/** Where the reject happened — worker (rejected on arrival) vs local (dropped before the wire). */
const OriginBadge = ({ origin }: { origin: "worker" | "local" }) => (
  <span className={`ig-origin ig-o-${origin}`} title={REJECT_ORIGINS[origin].gloss}>
    {origin === "local" ? <ScanIcon size={11} /> : <ShieldIcon size={11} />}
    {REJECT_ORIGINS[origin].label}
  </span>
);

/** Provenance is actionable when it's a URL (ruling #5: clickable, new-tab, stopPropagation so it
 *  doesn't toggle the drill-down); otherwise a redacted sample rendered as a code chip. */
const Provenance = ({ prov }: { prov: string | null }) => {
  if (prov == null) return null;
  if (isUrlProvenance(prov)) {
    return (
      <a
        className="ig-prov ig-prov-url"
        href={prov}
        target="_blank"
        rel="noopener noreferrer"
        title={prov}
        onClick={(e) => e.stopPropagation()}
      >
        <code>{shortUrl(prov)}</code>
        <ExternalLinkIcon size={11} />
      </a>
    );
  }
  return (
    <code className="ig-prov ig-prov-sample" title="redacted sample of the rejected payload">
      {prov}
    </code>
  );
};

const RejectionLine = ({ r, now }: { r: AuditRejection; now: number }) => (
  <div className="ig-rej">
    <span className="ig-rej-count">{r.count ? `${r.count}×` : "—"}</span>
    <span className={`ig-rej-reason rr-${r.reason}`} title={REJECT_REASONS[r.reason] ?? ""}>
      {r.reason}
    </span>
    <OriginBadge origin={r.origin} />
    <Provenance prov={r.provenance} />
    <span className="ig-rej-when muted small">{relAge(r.rejected_at, now)}</span>
  </div>
);

const RecommendationChip = ({ src, onQuarantine }: { src: AuditSource; onQuarantine: (src: AuditSource) => void }) => (
  <div className="ig-rec">
    <span className="ig-rec-ico">
      <AlertTriangleIcon size={14} />
    </span>
    <span className="ig-rec-text">
      <strong>{pct(src.quality.failRate)}</strong> of the last {src.quality.sample} observations failed validation — a
      broken adapter, most likely. Quarantine this source?
    </span>
    <button type="button" className="ig-rec-btn" onClick={() => onQuarantine(src)}>
      <BanIcon size={13} /> Quarantine
    </button>
  </div>
);

const QuarantinedBlock = ({
  src,
  now,
  onUnquarantine,
}: {
  src: AuditSource;
  now: number;
  onUnquarantine: (src: AuditSource) => void;
}) => (
  <div className="ig-quar">
    <span className="ig-quar-badge">
      <BanIcon size={13} /> quarantined
    </span>
    <span className="ig-quar-meta">
      since {src.quarantine ? relAge(src.quarantine.quarantined_at, now) : "now"}
      {src.quarantine?.note ? <span className="ig-quar-why"> — {src.quarantine.note}</span> : null}
    </span>
    <button type="button" className="ig-quar-undo" onClick={() => onUnquarantine(src)}>
      <RotateIcon size={13} /> Un-quarantine
    </button>
  </div>
);

const Drilldown = ({ src, now }: { src: AuditSource; now: number }) => (
  <div className="ig-drill">
    {src.rejections.length > 0 ? (
      <>
        <div className="ig-drill-head">
          <span className="ig-drill-title">Rejection ledger</span>
          <span className="muted small">why the Worker (or the satellite) dropped observations · last {AUDIT_WINDOW_LABEL}</span>
        </div>
        <div className="ig-rej-list">
          {src.rejections.map((r) => (
            <RejectionLine key={`${r.reason} ${r.origin} ${r.provenance ?? ""}`} r={r} now={now} />
          ))}
        </div>
        <div className="ig-drill-foot muted small">
          <ScanIcon size={11} /> <strong>local</strong> = dropped on the satellite before sending (adapter broke){" "}
          <span className="dimsep">·</span> <ShieldIcon size={11} /> <strong>worker</strong> = rejected on arrival
        </div>
      </>
    ) : (
      <div className="ig-drill-empty">No rejections in the last {AUDIT_WINDOW_LABEL} — this source is clean.</div>
    )}
  </div>
);

interface HeroHandlers {
  openKey: string | null;
  busyKey: string | null;
  onToggle: (key: string) => void;
  onQuarantine: (src: AuditSource) => void;
  onUnquarantine: (src: AuditSource) => void;
}

const SourceRow = ({ src, now, openKey, busyKey, onToggle, onQuarantine, onUnquarantine }: { src: AuditSource; now: number } & HeroHandlers) => {
  const isOpen = openKey === src.key;
  const isBusy = busyKey === src.key;
  return (
    <div className={`ig-srcx q-${src.qstate}${isOpen ? " open" : ""}`}>
      <div
        className="ig-srcx-head"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen ? "true" : "false"}
        onClick={() => onToggle(src.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(src.key);
          }
        }}
      >
        <HealthDot health={src.recency.health} />
        <span className="ig-srcx-name">{src.source}</span>
        <QualityCell src={src} />
        <span className="ig-srcx-meta muted small">
          {src.recency.lastPush == null ? "never" : relAge(src.recency.lastPush, now)} <span className="dimsep">·</span>{" "}
          {src.recency.pushes24h}/24h
        </span>
        <ChevronDownIcon size={15} className={`ig-srcx-chev${isOpen ? " up" : ""}`} />
      </div>

      {/* The chip/held block render from the (optimistically patched) derived qstate, so the hold
          appears the moment the operator confirms — the pending line rides alongside, never
          replacing the optimistic state. */}
      {src.qstate === "degrading" ? <RecommendationChip src={src} onQuarantine={onQuarantine} /> : null}
      {src.qstate === "quarantined" ? <QuarantinedBlock src={src} now={now} onUnquarantine={onUnquarantine} /> : null}
      {isBusy ? (
        <div className="ig-island-pending">
          <RotateIcon size={13} /> updating quarantine…
        </div>
      ) : null}

      {isOpen ? <Drilldown src={src} now={now} /> : null}
    </div>
  );
};

const SatelliteAuditCard = ({
  sat,
  now,
  contractVersion,
  ...handlers
}: { sat: AuditSatellite; now: number; contractVersion: string } & HeroHandlers) => {
  const never = sat.health === "never";
  return (
    <div className={`ig-live-card wide${never ? " never" : ""}`}>
      <div className="ig-live-head">
        <div className="ig-live-id">
          <span className="ig-live-source item-title">{sat.label}</span>
          <span className="ig-live-label muted small">
            {sat.sourceCount ? `${sat.sourceCount} ${sat.sourceCount === 1 ? "source" : "sources"}` : "no sources configured"}
          </span>
        </div>
        <div className="ig-live-headright">
          <span className={`ig-live-ago${never ? " none" : ""}`}>{never ? "no pushes yet" : relAge(sat.lastPush ?? now, now)}</span>
          <Badge variant={sat.health === "fresh" ? "secondary" : sat.health === "stale" ? "destructive" : "outline"}>
            {sat.health}
          </Badge>
        </div>
      </div>

      {sat.sources.length > 0 ? (
        <div className="ig-srcx-list">
          {sat.sources.map((src) => (
            <SourceRow key={src.key} src={src} now={now} {...handlers} />
          ))}
        </div>
      ) : null}

      <div className="ig-live-foot muted small">
        {sat.satelliteVersion ? (
          <>
            satellite <code>v{sat.satelliteVersion}</code> <span className="dimsep">·</span> contract <code>{sat.contractVersion}</code>
            {sat.skew ? (
              <span className="ig-skew" title={`Worker is on contract ${contractVersion}`}>
                {" "}
                <AlertTriangleIcon size={11} /> behind {contractVersion}
              </span>
            ) : null}
          </>
        ) : (
          <span>key minted — no satellite has authenticated</span>
        )}
      </div>
    </div>
  );
};

/** The satellite liveness + source-health hero. */
const AuditHero = ({
  satellites,
  now,
  contractVersion,
  ...handlers
}: { satellites: AuditSatellite[]; now: number; contractVersion: string } & HeroHandlers) => {
  if (satellites.length === 0) {
    return (
      <p className="muted">
        No satellites yet. Mint an ingest key in Config › Ingest Keys, then run a satellite on your network that pushes recipes here.
      </p>
    );
  }
  return (
    <div className="ig-sat-list">
      {satellites.map((sat) => (
        <SatelliteAuditCard key={sat.id} sat={sat} now={now} contractVersion={contractVersion} {...handlers} />
      ))}
    </div>
  );
};

// ── Throughput funnel + recent pushes (pure renders) ────────────────────────────────────────────

const Funnel = ({ rollup }: { rollup: SatelliteRollup }) => {
  const a = rollup.funnel.arrival;
  const d = rollup.funnel.downstream;
  const arrival: [string, number][] = [
    ["Received", a.received],
    ["Accepted", a.accepted],
    ["Deduped on arrival", a.deduped],
    ["Handed to sweep", a.swept],
  ];
  const downstream: [string, number][] = [
    ["Imported", d.imported],
    ["No match", d.noMatch],
    ["Duplicate", d.duplicate],
    ["Parked", d.parked],
  ];
  return (
    <div className="ig-funnel">
      <div className="ig-arrival">
        {arrival.map(([label, value]) => (
          <div key={label} className="ig-fstep">
            <div className="ig-fval">{value}</div>
            <div className="ig-flabel muted small">{label}</div>
          </div>
        ))}
      </div>
      <div className="ig-down">
        {downstream.map(([label, value]) => (
          <Badge key={label} variant="outline">
            {label} {value}
          </Badge>
        ))}
      </div>
    </div>
  );
};

const RecentPushes = ({ pushes, now }: { pushes: RecentPush[]; now: number }) => {
  if (pushes.length === 0) return <p className="muted">No pushes yet.</p>;
  return (
    <div className="cfg-table-wrap">
      <DataTable
        columns={[
          { key: "when", label: "When" },
          { key: "satellite", label: "Satellite" },
          { key: "source", label: "Source" },
          { key: "batch", label: "Batch" },
          { key: "result", label: "Result" },
        ]}
        rows={pushes.map((p) => ({
          when: <span className="muted small">{relAge(p.at, now)}</span>,
          satellite: p.satellite,
          source: p.source,
          batch: p.count,
          result: (
            <>
              <Badge variant={p.result === "accepted" ? "secondary" : p.result === "partial" ? "outline" : "destructive"}>
                {RESULT_LABEL[p.result]}
              </Badge>
              {p.result === "partial" && p.deduped > 0 ? <span className="muted small"> {p.deduped} deduped</span> : null}
            </>
          ),
        }))}
      />
    </div>
  );
};

// ── The quarantine confirm dialog (Radix — accessible name starts with "Quarantine") ────────────

const ConfirmQuarantineDialog = ({
  src,
  busy,
  onConfirm,
  onClose,
}: {
  src: AuditSource | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) => (
  <Dialog open={src != null} onOpenChange={(open) => (open ? undefined : onClose())}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{src ? `Quarantine ${src.source}?` : "Quarantine source?"}</DialogTitle>
        <DialogDescription className="muted small">
          This does <strong>not</strong> stop the satellite; it stops the Worker from accepting this one source — the
          machine's other sources keep flowing. Its observations are rejected until you un-quarantine.
        </DialogDescription>
      </DialogHeader>
      {src ? (
        <p className="ig-confirm-stat">
          <strong>{pct(src.quality.failRate)}</strong> of the last {src.quality.sample} observations failed validation.
        </p>
      ) : null}
      <p className="muted small">
        Reversible in one click. This is a scalpel for one source — the whole-machine revoke lever lives in Config › Ingest keys.
      </p>
      <DialogFooter className="form-actions">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          <BanIcon size={14} /> Quarantine source
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ── The loaded view + the routed screen ─────────────────────────────────────────────────────────

function SatellitesView({ data }: { data: SatellitesData }) {
  const { rollup, rejections, quarantine, now } = data;
  const satellites = buildAuditSources(rollup, rejections, quarantine);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<AuditSource | null>(null);

  // THE optimistic mutation (design D3): patch the cached payload's quarantine flags so the
  // derived qstate flips immediately; the truth converges via invalidation either way.
  const hold = useMutation({
    mutationFn: (src: AuditSource) =>
      unwrap(
        api.admin.api.satellites.quarantine.$post({
          json: { kind: src.kind, source: src.source, tenant: src.tenant, note: QUARANTINE_NOTE },
        }),
      ),
    onMutate: async (src) => {
      await queryClient.cancelQueries({ queryKey: ["satellites"] });
      queryClient.setQueryData<SatellitesData>(["satellites"], (prev) =>
        prev
          ? {
              ...prev,
              quarantine: [
                ...prev.quarantine.filter((q) => !sameQuarantineKey(q, src)),
                { tenant: src.tenant, kind: src.kind, source: src.source, quarantined_at: Date.now(), note: QUARANTINE_NOTE },
              ],
            }
          : prev,
      );
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ["satellites"] }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["satellites"] }),
  });
  const release = useMutation({
    mutationFn: (src: AuditSource) =>
      unwrap(
        api.admin.api.satellites.quarantine.clear.$post({
          json: { kind: src.kind, source: src.source, tenant: src.tenant },
        }),
      ),
    onMutate: async (src) => {
      await queryClient.cancelQueries({ queryKey: ["satellites"] });
      queryClient.setQueryData<SatellitesData>(["satellites"], (prev) =>
        prev ? { ...prev, quarantine: prev.quarantine.filter((q) => !sameQuarantineKey(q, src)) } : prev,
      );
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ["satellites"] }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["satellites"] }),
  });

  const anyPending = hold.isPending || release.isPending;
  const busyKey = hold.isPending ? hold.variables.key : release.isPending ? release.variables.key : null;
  const mutationError = hold.error ?? release.error;
  const errorMsg = mutationError ? (apiErrorOf(mutationError)?.message ?? String(mutationError)) : null;

  const doQuarantine = (src: AuditSource) => {
    setConfirm(null);
    // Reveal the ledger so the new (held) state is visible, matching the island's behavior.
    setOpenKey(src.key);
    hold.mutate(src);
  };
  const doUnquarantine = (src: AuditSource) => {
    if (anyPending) return;
    release.mutate(src);
  };

  const degrading = satellites.reduce((n, s) => n + s.sources.filter((x) => x.qstate === "degrading").length, 0);
  const quarantined = satellites.reduce((n, s) => n + s.sources.filter((x) => x.qstate === "quarantined").length, 0);

  return (
    <div className="satellites">
      <div className="area-head status-head">
        <h2>Discovery</h2>
      </div>

      <DiscoverySubNav active="satellites" />

      <StatCardGrid>
        <StatCard icon={<InboxIcon size={15} />} label="Satellites" value={rollup.stats.activeSatellites} sub={`${rollup.stats.sources} sources`} />
        <StatCard icon={<ActivityIcon size={15} />} label="Fresh" value={rollup.stats.fresh} sub={rollup.stats.stale ? `${rollup.stats.stale} stale` : "all live"} />
        <StatCard
          icon={<AlertTriangleIcon size={15} />}
          label="Degrading"
          value={degrading}
          sub={degrading ? `fail rate over ${pct(AUDIT_FAIL_THRESHOLD)}` : "all clean"}
          tone={degrading > 0 ? "warn" : undefined}
        />
        <StatCard
          icon={<BanIcon size={15} />}
          label="Quarantined"
          value={quarantined}
          sub={quarantined ? "held by operator" : "none held"}
          tone={quarantined > 0 ? "bad" : undefined}
        />
      </StatCardGrid>

      {errorMsg != null ? <ErrorBanner message={errorMsg} /> : null}

      <p className="group-label">Satellite liveness &amp; source health</p>
      <AuditHero
        satellites={satellites}
        now={now}
        contractVersion={rollup.contractVersion}
        openKey={openKey}
        busyKey={busyKey}
        onToggle={(key) => setOpenKey(openKey === key ? null : key)}
        onQuarantine={(src) => setConfirm(src)}
        onUnquarantine={doUnquarantine}
      />

      <p className="group-label">Throughput · last 24h</p>
      <Funnel rollup={rollup} />

      <p className="group-label">Recent pushes</p>
      <RecentPushes pushes={rollup.pushes} now={now} />

      <ConfirmQuarantineDialog
        src={confirm}
        busy={hold.isPending}
        onConfirm={() => confirm && doQuarantine(confirm)}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

/** The routed Satellites screen: one primary query, branched exhaustively on its status. */
export function SatellitesScreen() {
  const q = useQuery(satellitesQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <SatellitesView data={q.data} />;
    default:
      return assertNever(q);
  }
}

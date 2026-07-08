// The Normalization screen (admin-spa): the operator audit + override surface over the organic
// ingredient-identity graph, ported from the SSR panel's pages/normalize.tsx + client/normalize.tsx.
// Six tabs — Decisions (the capture audit stream, with its Terms/Edges segment), Audits (the
// existing AuditsTab component), Queue, Aliases, Nodes (read-only browse, design D11), Reconcile
// (the existing ReconcileCard) — all URL state (?tab/stream/filter/q/src/page/node/facet) as
// validated search params, every combination deep-linkable.
//
// Data: normalizePageQuery is the screen's primary query (the shell's stat tiles + sub-nav counts
// + Decisions/Queue/Aliases render from it); the other tabs' reads mount only with their tab —
// Nodes → normalizeNodesQuery, Audits → normalizeAuditQuery, Reconcile → reconcileQuery. The
// Decisions tab also mounts normalizeAuditQuery (its Edges stream renders the audit surface's
// edge verdicts — the exact SSR wiring). The island's location.reload() becomes four narrow
// useMutations settling into ["normalize","page"] invalidation (alias writes also touch
// ["normalize","nodes"] — they change node alias lists).

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@grocery-agent/ui";
import { api, apiErrorOf, unwrap } from "../lib/api";
import {
  normalizePageQuery,
  normalizeNodesQuery,
  normalizeAuditQuery,
  reconcileQuery,
  queryClient,
  type NormalizePageData,
  type NormalizeAuditData,
  type NormalizeNodesData,
  type ReconcileData,
} from "../lib/queries";
import { assertNever } from "../lib/assert";
import { relAge, relFuture } from "../lib/format";
import { StatCardGrid, StatCard, Button, ErrorBanner } from "../components/kit";
import {
  DatabaseIcon,
  LinkIcon,
  GitMergeIcon,
  ClockIcon,
  SparklesIcon,
  AlertTriangleIcon,
  RotateIcon,
  TrashIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  MinusCircleIcon,
  CheckCircleIcon,
} from "../components/icons";
import { AuditsTab } from "../components/audits";
import { ReconcileCard } from "../components/reconcile";
import {
  type NormalizeSearch,
  type NormalizeQuery,
  type NormalizationDecision,
  type PageModel,
  resolveQuery,
  linkSearch,
  ResolvedId,
  SourceBadge,
} from "./normalize-shared";
import { AliasesTab } from "./normalize-aliases";
import { NodesTab } from "./normalize-nodes";

type AuditSurface = NormalizeAuditData;
type EdgeDecisionCard = AuditSurface["edges"][number];

const OUTCOME_LABEL: Record<string, string> = {
  same: "Same",
  spec: "Specialization",
  novel: "Novel",
  merge: "Merge",
  nollm: "No-LLM",
  fail: "Failed",
};

/** The decision filter pills, in display order. */
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "same", label: "Same" },
  { key: "spec", label: "Specialization" },
  { key: "novel", label: "Novel" },
  { key: "merge", label: "Merge" },
  { key: "nollm", label: "No-LLM" },
  { key: "fail", label: "Failed" },
];

const OutcomeBadge = ({ d }: { d: NormalizationDecision }) => (
  <span className={`nz-badge oc-${d.outcome}`}>
    {OUTCOME_LABEL[d.outcome] ?? d.outcome}
    {d.failedSafe ? " → Novel" : ""}
  </span>
);

const Candidates = ({ d }: { d: NormalizationDecision }) => {
  if (d.candidates.length === 0) {
    return <p className="nz-empty muted small">No candidates — the embedder returned nothing usable.</p>;
  }
  const anyChosen = d.candidates.some((c) => c.chosen);
  return (
    <div className="nz-cands">
      {d.candidates.map((c) => (
        <div key={c.id} className={c.chosen ? "nz-cand chosen" : "nz-cand"}>
          <span className="nz-cand-id">{c.id}</span>
          <span className="nz-cand-track">
            <span
              className={`nz-cand-fill${c.chosen ? " chosen" : ""}${d.belowFloor ? " floor" : ""}`}
              style={{ width: `${Math.round(c.score * 100)}%` }}
            />
          </span>
          <span className="nz-cand-score">{c.score.toFixed(2)}</span>
          {c.chosen ? <span className="nz-cand-flag">chosen</span> : <span className="nz-cand-flag ghost" />}
        </div>
      ))}
      {!anyChosen ? (
        <p className="nz-cands-note muted small">
          {d.belowFloor
            ? "All below the similarity floor — resolved as a new base with no LLM call."
            : d.outcome === "novel" || d.outcome === "fail"
              ? "None chosen — the classifier judged this a distinct product."
              : "None chosen."}
        </p>
      ) : null}
    </div>
  );
};

/** The canonical id a decision resolved to (base or base::detail), for the Nodes deep-link. */
function decisionNodeId(d: NormalizationDecision): string {
  return d.outcome === "merge" ? (d.mergeInto ?? d.base) : d.detail ? `${d.base}::${d.detail}` : d.base;
}

/** The resolved-id, linked into its node when one exists in the graph (a deep-link to the Nodes tab). */
const ResolvedDecId = ({ d, query, nodeIds }: { d: NormalizationDecision; query: NormalizeQuery; nodeIds: Set<string> }) => {
  const id = decisionNodeId(d);
  const inner =
    d.outcome === "merge" ? (
      <ResolvedId base={d.mergeInto ?? d.base} detail={null} />
    ) : (
      <ResolvedId base={d.base} detail={d.detail} concept={d.concept} />
    );
  if (nodeIds.has(id)) {
    return (
      <Link
        className="nz-resolve-link"
        to="/normalize"
        search={linkSearch({ tab: "nodes", node: id, filter: "all", q: "", page: 0 }, query)}
        title="View in the node graph"
      >
        {inner}
      </Link>
    );
  }
  return inner;
};

/** The per-card mutation triggers a decision card raises to the screen. */
interface DecisionActions {
  busy: boolean;
  onRequeue: (term: string) => void;
  onOverride: (term: string) => void;
  onDeleteDecision: (id: string) => void;
}

const DecisionCard = ({
  d,
  now,
  query,
  nodeIds,
  actions,
}: {
  d: NormalizationDecision;
  now: number;
  query: NormalizeQuery;
  nodeIds: Set<string>;
  actions: DecisionActions;
}) => (
  <div className={`nz-card oc-${d.outcome}`} data-term={d.term}>
    <details className="nz-details">
      <summary className="nz-main">
        <div className="nz-lead">
          <div className="nz-term-wrap">
            <div className="nz-term">{d.term}</div>
            <div className="nz-resolve">
              <ArrowRightIcon size={13} />
              <ResolvedDecId d={d} query={query} nodeIds={nodeIds} />
            </div>
          </div>
          <div className="nz-badges">
            <OutcomeBadge d={d} />
            {d.reconfirm ? (
              <span className="nz-reconfirm" title="From the periodic re-confirm pass, not the initial capture">
                <RotateIcon size={11} /> re-confirm
              </span>
            ) : null}
            <SourceBadge source={d.source} />
            {d.createdAt ? <span className="nz-time muted">{relAge(d.createdAt, now)}</span> : null}
          </div>
        </div>
        <div className="nz-foot">
          <span className="nz-expand">
            Details <ChevronDownIcon size={14} />
          </span>
          <div className="nz-actions">
            <Button
              variant="outline"
              size="sm"
              className="nz-act-btn"
              data-action="requeue"
              data-term={d.term}
              onClick={(e) => {
                e.preventDefault();
                actions.onRequeue(d.term);
              }}
            >
              <RotateIcon size={13} /> Re-queue
            </Button>
            <Button
              size="sm"
              className="nz-act-btn"
              data-action="override"
              data-term={d.term}
              onClick={(e) => {
                e.preventDefault();
                actions.onOverride(d.term);
              }}
            >
              Override
            </Button>
            {d.outcome === "fail" ? (
              <button
                type="button"
                className="nz-del"
                title="Delete row"
                data-action="delete-decision"
                data-id={String(d.id)}
                disabled={actions.busy}
                onClick={(e) => {
                  e.preventDefault();
                  actions.onDeleteDecision(String(d.id));
                }}
              >
                <TrashIcon size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </summary>

      <div className="nz-detail">
        <div className="nz-detail-block">
          <p className="nz-detail-label">
            Candidates <span className="muted">· nearest by cosine</span>
          </p>
          <Candidates d={d} />
        </div>
        <div className="nz-detail-meta">
          <div className="nz-meta-item">
            <span className="nz-meta-k">Model</span>
            {d.model ? (
              <code className="nz-meta-model">{d.model}</code>
            ) : (
              <span className="nz-chip-floor">
                <MinusCircleIcon size={12} /> below floor — no LLM
              </span>
            )}
          </div>
          {d.mergeInto ? (
            <div className="nz-meta-item">
              <span className="nz-meta-k">Merge</span>
              <span className="nz-edge">
                <code>{d.term}</code>
                <ArrowRightIcon size={12} />
                <code>{d.mergeInto}</code>
                <span className="nz-edge-rel">same-as</span>
              </span>
            </div>
          ) : null}
        </div>
        {d.edges.length > 0 || d.members.length > 0 ? (
          <div className="nz-detail-block">
            <p className="nz-detail-label">{d.concept ? "Membership edges" : "Proposed edges"}</p>
            <div className="nz-edges">
              {d.edges.map((e) => (
                <span key={`${e.from} ${e.to} ${e.rel}`} className="nz-edge">
                  <code>{e.from}</code>
                  <ArrowRightIcon size={12} />
                  <code>{e.to}</code>
                  <span className="nz-edge-rel">{e.rel}</span>
                </span>
              ))}
              {d.members.map((m) => (
                <span key={m} className="nz-edge member">
                  <code>{m}</code>
                  <ArrowRightIcon size={12} />
                  <code>{d.base}</code>
                  <span className="nz-edge-rel">member-of</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {d.reason ? (
          <div className="nz-reason">
            <span className="nz-reason-k">Reason</span>
            <span className="nz-reason-v">"{d.reason}"</span>
          </div>
        ) : null}
      </div>
    </details>
  </div>
);

// === Decisions › Edges segment ==============================================================
// Verdicts on directed satisfies-edges from the edge audit — shaped differently from term
// decisions: a from→to edge, KEEP/DROP, an amber flag for self-loop/cycle drops, the check's
// reason, and (for drops later revisited by the replay) a pointer into the Audits tab's
// restorations log. Read-only — the filter is a search param like the term-stream pills.

const EDGE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "keep", label: "Kept" },
  { key: "drop", label: "Dropped" },
];

/** A short human verdict line for an edge decision (derived — the log stores the parts). */
function edgeVerdict(d: EdgeDecisionCard): string {
  if (d.outcome === "keep") {
    if (d.note === "structural") return "structural — a spec satisfies its base";
    if (d.note === "confirm_failed_safe") return "undecidable — kept fail-safe";
    if (d.direction === "both") return "holds both ways";
    return "direction holds";
  }
  if (d.flag === "self-loop") return "self-loop — an id can't satisfy itself";
  if (d.flag === "cycle") return "closed a cycle — this direction lost";
  return "direction doesn't hold";
}

const EdgeStream = ({ edges, query, now }: { edges: EdgeDecisionCard[]; query: NormalizeQuery; now: number }) => {
  const shown = edges.filter((d) => query.filter === "all" || d.outcome === query.filter);
  return (
    <>
      <div className="data-nav nz-filters">
        {EDGE_FILTERS.map((f) => {
          const n = f.key === "all" ? edges.length : edges.filter((d) => d.outcome === f.key).length;
          return (
            <Link
              key={f.key}
              className={query.filter === f.key ? `pill nz-pill oc-edge_${f.key} active` : `pill nz-pill oc-edge_${f.key}`}
              to="/normalize"
              search={linkSearch({ filter: f.key, page: 0 }, query)}
              aria-disabled={n === 0 && f.key !== "all"}
            >
              {f.label}
              {n > 0 ? <span className="pill-count">{n}</span> : null}
            </Link>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="muted">No edge decisions match this filter.</p>
      ) : (
        <div className="nz-list">
          {shown.map((d) => (
            <div key={d.id} className={`nz-card ec-card oc-edge_${d.outcome}`} id={`edge-${d.id}`}>
              <div className="ec-main">
                <div className="ec-lead">
                  <div className="ec-edge">
                    <code>{d.from}</code>
                    <ArrowRightIcon size={14} />
                    <code>{d.to}</code>
                    <span className="ec-rel">{d.kind}</span>
                  </div>
                  <div className="nz-badges">
                    <span className={`nz-badge oc-edge_${d.outcome}`}>{d.outcome === "keep" ? "Kept" : "Dropped"}</span>
                    {d.flag ? <span className="ec-flag">{d.flag}</span> : null}
                    {d.createdAt ? <span className="nz-time muted">{relAge(d.createdAt, now)}</span> : null}
                  </div>
                </div>
                <div className="ec-verdict">
                  <span className="ec-verdict-glyph">
                    {d.outcome === "keep" ? <CheckCircleIcon size={13} /> : <MinusCircleIcon size={13} />}
                  </span>
                  {edgeVerdict(d)}
                </div>
                {d.reason ? <div className="ec-reason">"{d.reason}"</div> : null}
                {d.revisitedBy != null ? (
                  <Link
                    className="ec-restored"
                    to="/normalize"
                    search={linkSearch({ tab: "audits", stream: "terms", filter: "all", page: 0 }, query)}
                    hash={`rst-${d.revisitedBy}`}
                  >
                    <RotateIcon size={12} /> later revisited by the edge audit — see Restorations
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

// === Queue tab ==============================================================================

const QueueTable = ({ data, now }: { data: PageModel; now: number }) => (
  <div className="nz-queue">
    <p className="nz-queue-blurb muted small">
      Novel terms seen in member input, waiting for the next normalization pass. Each is embedded, matched, and classified
      when its retry window opens.
    </p>
    <div className="cfg-table-wrap">
      <table className="cfg-table nz-queue-table">
        <thead>
          <tr>
            <th>Term</th>
            <th>First seen</th>
            <th className="ig-th-num">Attempts</th>
            <th>Next retry</th>
          </tr>
        </thead>
        <tbody>
          {data.queue.length === 0 ? (
            <tr>
              <td colSpan={4} className="nz-al-empty muted small">
                The queue is empty — every seen term has been placed.
              </td>
            </tr>
          ) : (
            data.queue.map((q) => (
              <tr key={q.term}>
                <td>
                  <code className="nz-queue-term">{q.term}</code>
                </td>
                <td className="muted small">{q.firstSeenAt ? relAge(q.firstSeenAt, now) : "—"}</td>
                <td className="ig-th-num cfg-num">{q.attempts}</td>
                <td className="small">
                  {q.nextRetryAt ? (
                    <span className="nz-queue-next">
                      <ClockIcon size={12} /> {relFuture(q.nextRetryAt, now)}
                    </span>
                  ) : (
                    <span className="muted">due</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// === Per-tab query gates (only the active tab's query is enabled/mounted) ====================

const AuditsGate = ({ q, now }: { q: UseQueryResult<NormalizeAuditData>; now: number }) => {
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return (
        <AuditsTab
          s={q.data.obs}
          gauges={q.data.gauges}
          restorations={q.data.restorations}
          rejections={q.data.rejections}
          backoffDays={q.data.backoffDays}
          now={now}
        />
      );
    default:
      return assertNever(q);
  }
};

const ReconcileGate = ({ q, now }: { q: UseQueryResult<ReconcileData>; now: number }) => {
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return (
        <div className="nz-reconcile">
          <ReconcileCard s={q.data} now={now} />
        </div>
      );
    default:
      return assertNever(q);
  }
};

const NodesGate = ({ q, query }: { q: UseQueryResult<NormalizeNodesData>; query: NormalizeQuery }) => {
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <NodesTab nodes={q.data} query={query} />;
    default:
      return assertNever(q);
  }
};

const EdgesGate = ({ q, query, now }: { q: UseQueryResult<NormalizeAuditData>; query: NormalizeQuery; now: number }) => {
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <EdgeStream edges={q.data.edges} query={query} now={now} />;
    default:
      return assertNever(q);
  }
};

// === Dialogs (Radix — accessible names "Override normalization" / "Add alias mapping") ======

/** Which dialog is open + its subject — one union, so subject and openness can't contradict. */
type DialogState = { kind: "none" } | { kind: "override"; term: string } | { kind: "add" };

const OverrideDialog = ({
  state,
  onClose,
  onSave,
}: {
  state: DialogState;
  onClose: () => void;
  onSave: (term: string, canonicalId: string) => void;
}) => {
  const [canonicalId, setCanonicalId] = React.useState("");
  const open = state.kind === "override";
  // Reset the draft whenever the dialog re-opens (the island cleared the input on open).
  React.useEffect(() => {
    if (open) setCanonicalId("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <form
          className="nz-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (state.kind === "override") onSave(state.term, canonicalId);
          }}
        >
          <DialogHeader>
            <DialogTitle>Override normalization</DialogTitle>
            <DialogDescription className="nz-dialog-desc muted small">
              Pin this term to a canonical id yourself. A human correction is authoritative — the automatic system will not
              overwrite it.
            </DialogDescription>
          </DialogHeader>
          <label className="nz-dialog-field">
            <span className="nz-ov-k">Term</span>
            <code className="nz-ov-term">{state.kind === "override" ? state.term : ""}</code>
          </label>
          <label className="nz-dialog-field">
            <span className="nz-ov-k">Canonical id</span>
            <Input
              type="text"
              name="canonicalId"
              list="nz-known-ids"
              placeholder="Search or type an id — base or base::detail"
              value={canonicalId}
              onChange={(e) => setCanonicalId(e.currentTarget.value)}
            />
          </label>
          <DialogFooter className="nz-dialog-foot">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save as human correction</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const AddAliasDialog = ({
  state,
  onClose,
  onSave,
}: {
  state: DialogState;
  onClose: () => void;
  onSave: (variant: string, canonicalId: string) => void;
}) => {
  const [variant, setVariant] = React.useState("");
  const [canonicalId, setCanonicalId] = React.useState("");
  const open = state.kind === "add";
  React.useEffect(() => {
    if (open) {
      setVariant("");
      setCanonicalId("");
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <form
          className="nz-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(variant, canonicalId);
          }}
        >
          <DialogHeader>
            <DialogTitle>Add alias mapping</DialogTitle>
            <DialogDescription className="nz-dialog-desc muted small">
              Pin a surface form to a canonical id. Saved as a human mapping — authoritative, and the automatic system won't
              overwrite it.
            </DialogDescription>
          </DialogHeader>
          <label className="nz-dialog-field">
            <span className="nz-ov-k">Variant</span>
            <Input type="text" name="variant" placeholder="e.g. EVOO" value={variant} onChange={(e) => setVariant(e.currentTarget.value)} />
          </label>
          <label className="nz-dialog-field">
            <span className="nz-ov-k">Canonical id</span>
            <Input
              type="text"
              name="canonicalId"
              list="nz-known-ids"
              placeholder="Search or type an id — a new id is allowed too"
              value={canonicalId}
              onChange={(e) => setCanonicalId(e.currentTarget.value)}
            />
          </label>
          <DialogFooter className="nz-dialog-foot">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save as human mapping</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// === The loaded view + the routed screen =====================================================

function NormalizeView({
  payload,
  query,
  auditQ,
  nodesQ,
  reconQ,
}: {
  payload: NormalizePageData;
  query: NormalizeQuery;
  auditQ: UseQueryResult<NormalizeAuditData>;
  nodesQ: UseQueryResult<NormalizeNodesData>;
  reconQ: UseQueryResult<ReconcileData>;
}) {
  const data = payload.data;
  const now = payload.now;
  // The render clock for the tabs whose reads carry no `now` (audits/reconcile/edges) —
  // captured once per mount, never re-ticking (time-free landmarks).
  const [clientNow] = React.useState(() => Date.now());
  const [dlg, setDlg] = React.useState<DialogState>({ kind: "none" });

  // The four mutations (the island's Override / Re-queue / Delete / Add-alias), one-at-a-time
  // across the whole surface: every trigger gates on `busy`, mirroring the island's single
  // ActionState. Override and Add-alias are the SAME write (a human alias row).
  const invalidate = (alsoNodes: boolean) => {
    void queryClient.invalidateQueries({ queryKey: ["normalize", "page"] });
    if (alsoNodes) void queryClient.invalidateQueries({ queryKey: ["normalize", "nodes"] });
  };
  const aliasSave = useMutation({
    mutationFn: (vars: { variant: string; canonicalId: string }) =>
      unwrap(api.admin.api.normalization.alias.$post({ json: vars })),
    onSettled: () => invalidate(true),
  });
  const aliasDelete = useMutation({
    mutationFn: (variant: string) => unwrap(api.admin.api.normalization.alias[":variant"].$delete({ param: { variant } })),
    onSettled: () => invalidate(true),
  });
  const requeue = useMutation({
    mutationFn: (term: string) => unwrap(api.admin.api.normalization.requeue.$post({ json: { term } })),
    onSettled: () => invalidate(false),
  });
  const deleteDecision = useMutation({
    mutationFn: (id: string) => unwrap(api.admin.api.normalization.decision[":id"].$delete({ param: { id } })),
    onSettled: () => invalidate(false),
  });

  const busy = aliasSave.isPending || aliasDelete.isPending || requeue.isPending || deleteDecision.isPending;
  const mutationError = aliasSave.error ?? aliasDelete.error ?? requeue.error ?? deleteDecision.error;

  const saveAlias = (variant: string, canonicalId: string) => {
    if (!variant.trim() || !canonicalId.trim()) return;
    setDlg({ kind: "none" });
    if (busy) return;
    aliasSave.mutate({ variant: variant.trim(), canonicalId: canonicalId.trim() });
  };

  const actions: DecisionActions = {
    busy,
    onRequeue: (term) => {
      if (!busy) requeue.mutate(term);
    },
    onOverride: (term) => setDlg({ kind: "override", term }),
    onDeleteDecision: (id) => {
      if (!busy) deleteDecision.mutate(id);
    },
  };

  const stats = data.stats;
  // The set of node ids a decision's resolved id can deep-link into. Rendered from the
  // ["normalize","nodes"] cache — populated once the Nodes tab has loaded; until then the
  // resolved ids render unlinked (the read mounts only with its tab).
  const nodeIds = React.useMemo(() => new Set((nodesQ.data?.nodes ?? []).map((n) => n.id)), [nodesQ.data]);
  const cards: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }> = [
    { icon: <DatabaseIcon size={15} />, label: "Canonical nodes", value: stats.nodes.toLocaleString() },
    { icon: <LinkIcon size={15} />, label: "Aliases", value: stats.aliases.toLocaleString() },
    { icon: <GitMergeIcon size={15} />, label: "Satisfies-edges", value: stats.satisfies.toLocaleString() },
    { icon: <ClockIcon size={15} />, label: "Pending queue", value: stats.pending, sub: "awaiting a pass" },
    { icon: <SparklesIcon size={15} />, label: "Decisions · 24h", value: stats.decisions24h },
    { icon: <AlertTriangleIcon size={15} />, label: "Needs attention", value: stats.needsAttention, sub: "failed" },
  ];

  const filteredDecisions = data.decisions.filter((d) => query.filter === "all" || d.outcome === query.filter);

  return (
    <div className="normalize">
      <div className="data-nav nz-subnav">
        <Link
          className={query.tab === "decisions" ? "pill active" : "pill"}
          to="/normalize"
          search={linkSearch({ tab: "decisions", page: 0 }, query)}
        >
          Decisions
        </Link>
        <Link
          className={query.tab === "audits" ? "pill active" : "pill"}
          to="/normalize"
          search={linkSearch({ tab: "audits", page: 0 }, query)}
        >
          {auditQ.data ? <span className={`rk-tab-dot ${auditQ.data.obs.state}`} /> : null}
          Audits
        </Link>
        <Link
          className={query.tab === "queue" ? "pill active" : "pill"}
          to="/normalize"
          search={linkSearch({ tab: "queue", page: 0 }, query)}
        >
          Queue
          {data.queue.length > 0 ? <span className="pill-count">{data.queue.length}</span> : null}
        </Link>
        <Link
          className={query.tab === "aliases" ? "pill active" : "pill"}
          to="/normalize"
          search={linkSearch({ tab: "aliases", page: 0 }, query)}
        >
          Aliases
          {data.aliases.length > 0 ? <span className="pill-count">{data.aliases.length}</span> : null}
        </Link>
        <Link
          className={query.tab === "nodes" ? "pill active" : "pill"}
          to="/normalize"
          search={linkSearch({ tab: "nodes", page: 0, node: "", facet: "all" }, query)}
        >
          Nodes
          {nodesQ.data && nodesQ.data.stats.total > 0 ? <span className="pill-count">{nodesQ.data.stats.total}</span> : null}
        </Link>
        <Link
          className={query.tab === "reconcile" ? "pill active" : "pill"}
          to="/normalize"
          search={linkSearch({ tab: "reconcile", page: 0 }, query)}
        >
          {reconQ.data ? <span className={`rk-tab-dot ${reconQ.data.state}`} /> : null}
          Reconcile
        </Link>
      </div>

      <div className="area-head status-head">
        <h2>Normalization</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["normalize"] });
            void queryClient.invalidateQueries({ queryKey: ["reconcile"] });
          }}
        >
          Refresh{data.lastSweep != null ? ` · last sweep ${relAge(data.lastSweep, now)}` : ""}
        </Button>
      </div>

      <StatCardGrid>
        {cards.map((c) => (
          <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} sub={c.sub} />
        ))}
      </StatCardGrid>

      {mutationError != null ? <ErrorBanner message={`Action failed: ${apiErrorOf(mutationError)?.message ?? String(mutationError)}`} /> : null}

      {query.tab === "queue" ? (
        <QueueTable data={data} now={now} />
      ) : query.tab === "aliases" ? (
        <AliasesTab
          data={data}
          query={query}
          busy={busy}
          onAdd={() => setDlg({ kind: "add" })}
          onDelete={(variant) => {
            if (!busy) aliasDelete.mutate(variant);
          }}
        />
      ) : query.tab === "nodes" ? (
        <NodesGate q={nodesQ} query={query} />
      ) : query.tab === "reconcile" ? (
        <ReconcileGate q={reconQ} now={clientNow} />
      ) : query.tab === "audits" ? (
        <AuditsGate q={auditQ} now={clientNow} />
      ) : (
        <>
          {/* The Terms / Edges stream segment — two decision shapes, one deep-linkable param.
              Switching streams resets the filter (the two segments' filter keys differ). */}
          <div className="nz-stream-bar">
            <div className="seg nz-stream-seg">
              <Link
                className={query.stream === "terms" ? "seg-btn active" : "seg-btn"}
                to="/normalize"
                search={linkSearch({ stream: "terms", filter: "all", page: 0 }, query)}
              >
                Terms<span className="nz-stream-n">{data.decisions.length}</span>
              </Link>
              <Link
                className={query.stream === "edges" ? "seg-btn active" : "seg-btn"}
                to="/normalize"
                search={linkSearch({ stream: "edges", filter: "all", page: 0 }, query)}
              >
                Edges{auditQ.data ? <span className="nz-stream-n">{auditQ.data.edges.length}</span> : null}
              </Link>
            </div>
            <span className="nz-stream-hint muted small">
              {query.stream === "terms" ? "surface term → canonical id" : "directed satisfies-edge · keep or drop"}
            </span>
          </div>

          {query.stream === "edges" ? (
            <EdgesGate q={auditQ} query={query} now={clientNow} />
          ) : (
            <>
              <div className="data-nav nz-filters">
                {FILTERS.map((f) => {
                  const n = f.key === "all" ? data.decisions.length : data.decisions.filter((d) => d.outcome === f.key).length;
                  return (
                    <Link
                      key={f.key}
                      className={query.filter === f.key ? `pill nz-pill oc-${f.key} active` : `pill nz-pill oc-${f.key}`}
                      to="/normalize"
                      search={linkSearch({ filter: f.key, page: 0 }, query)}
                      aria-disabled={n === 0 && f.key !== "all"}
                    >
                      {f.label}
                      {n > 0 ? <span className="pill-count">{n}</span> : null}
                    </Link>
                  );
                })}
              </div>

              {filteredDecisions.length === 0 ? (
                <p className="muted">No decisions match this filter.</p>
              ) : (
                <div className="nz-list">
                  {filteredDecisions.map((d) => (
                    <DecisionCard key={d.id} d={d} now={now} query={query} nodeIds={nodeIds} actions={actions} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {busy ? <p className="muted small">Working…</p> : null}

      {/* `<datalist>` gives the dialogs' canonical-id inputs a native typeahead over known ids. */}
      <datalist id="nz-known-ids">
        {data.knownIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <OverrideDialog state={dlg} onClose={() => setDlg({ kind: "none" })} onSave={saveAlias} />
      <AddAliasDialog state={dlg} onClose={() => setDlg({ kind: "none" })} onSave={saveAlias} />
    </div>
  );
}

/** The routed Normalization screen: the page aggregate is the primary query (the shell renders
 *  from it on every tab); the other tabs' reads are enabled only with their tab — a disabled
 *  useQuery still surfaces already-cached data (the sub-nav dot/count embellishments). */
export function NormalizeScreen({ search }: { search: NormalizeSearch }) {
  const query = resolveQuery(search);
  const pageQ = useQuery(normalizePageQuery);
  const auditQ = useQuery({
    ...normalizeAuditQuery,
    // The Decisions tab needs the audit surface too — its Edges stream renders the edge verdicts.
    enabled: query.tab === "audits" || query.tab === "decisions",
  });
  const nodesQ = useQuery({ ...normalizeNodesQuery, enabled: query.tab === "nodes" });
  const reconQ = useQuery({ ...reconcileQuery, enabled: query.tab === "reconcile" });

  switch (pageQ.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(pageQ.error)?.message ?? String(pageQ.error)} />;
    case "success":
      return <NormalizeView payload={pageQ.data} query={query} auditQ={auditQ} nodesQ={nodesQ} reconQ={reconQ} />;
    default:
      return assertNever(pageQ);
  }
}

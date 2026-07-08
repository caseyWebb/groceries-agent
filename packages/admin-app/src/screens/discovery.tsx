// The Discovery screen (admin-spa): the candidate-pipeline view over `discovery_log`, ported
// from the SSR panel's pages/discovery.tsx + client/discovery.tsx. Stat tiles, filter pills,
// the ingest strip, and the paginated progression-track cards are pure renders over the one
// ["discovery","candidates"] query; only Retry/Delete mutate — one useMutation whose
// `variables` identifies the acting card (one-at-a-time falls out of `isPending`), settling
// into a narrow invalidation instead of the island's location.reload().

import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorOf, unwrap } from "../lib/api";
import { discoveryCandidatesQuery, queryClient, type DiscoveryData } from "../lib/queries";
import { assertNever } from "../lib/assert";
import { relAge, relFuture, isRetryable } from "../lib/format";
import { StatCardGrid, StatCard, Pager, PrettyKV, StageTrack, Badge, Button, ErrorBanner } from "../components/kit";
import {
  CompassIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  RotateIcon,
  RssIcon,
  MailIcon,
  ChevronDownIcon,
  TargetIcon,
  DownloadIcon,
  SparklesIcon,
  FileTextIcon,
  GitMergeIcon,
  ScanIcon,
  InboxIcon,
} from "../components/icons";

type Candidate = DiscoveryData["candidates"][number];
type MatchScore = NonNullable<Candidate["matchScores"]>[number];
type StageKey = Candidate["haltStage"];
type IngestStripData = DiscoveryData["ingest"];

/** Candidates per page. */
export const PAGE_SIZE = 6;

/** Mirrors DEFAULT_CONFIG.retryMaxAttempts (src/discovery-sweep.ts) — display-only copy; the
 *  retry cap itself is enforced Worker-side. */
const RETRY_MAX_ATTEMPTS = 5;

/** The pipeline's 7 stages, in real execution order — icon + a short blurb of what each does
 *  (design.md Decision 1 / the "Discovery candidate progression track" requirement). */
export const STAGES: Array<{ key: StageKey; label: string; icon: React.ReactNode; blurb: string }> = [
  { key: "triage", label: "Triage", icon: <TargetIcon size={14} />, blurb: "Cheap taste pre-filter — title+summary embed near any member?" },
  { key: "acquire", label: "Acquire", icon: <DownloadIcon size={14} />, blurb: "Fetch the page + parse to structured recipe content." },
  { key: "classify", label: "Classify", icon: <SparklesIcon size={14} />, blurb: "env.AI classification → contract-valid frontmatter facets." },
  { key: "describe", label: "Describe", icon: <FileTextIcon size={14} />, blurb: "Generate the description and embed it — the authoritative vector." },
  { key: "dedup", label: "Dedup", icon: <GitMergeIcon size={14} />, blurb: "Near-duplicate cosine vs the corpus (and this tick's imports)." },
  { key: "match", label: "Match", icon: <ScanIcon size={14} />, blurb: "Taste cosine + dietary gate, then the negation-aware LLM confirm." },
  { key: "import", label: "Import", icon: <DownloadIcon size={14} />, blurb: "Assemble body + frontmatter, validate, write to the corpus." },
];
const STAGE_IX: Record<StageKey, number> = Object.fromEntries(STAGES.map((s, i) => [s.key, i])) as Record<StageKey, number>;

const OUTCOME_LABEL: Record<string, string> = {
  imported: "Imported",
  duplicate: "Duplicate",
  no_match: "No match",
  dietary_gated: "Dietary gated",
  rejected_source: "Source rejected",
  error: "Parked",
  failed: "Failed",
  deferred: "Deferred",
};

const ACQUIRE_REASON_LABEL: Record<string, string> = {
  unreachable: "Page unreachable",
  no_jsonld: "No recipe JSON-LD on page",
  not_a_recipe: "Not a recipe page",
  incomplete: "Recipe markup incomplete",
};

/** The filter pills, in display order. "retrying" matches `retryable` (either error/failed
 *  outcome with a pending next_retry_at); the rest match their outcome value 1:1. */
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "imported", label: "Imported" },
  { key: "retrying", label: "Retrying" },
  { key: "error", label: "Parked" },
  { key: "failed", label: "Failed" },
  { key: "no_match", label: "No match" },
  { key: "duplicate", label: "Duplicate" },
  { key: "dietary_gated", label: "Dietary" },
  { key: "deferred", label: "Deferred" },
];

function countFor(cands: Candidate[], key: string): number {
  if (key === "all") return cands.length;
  if (key === "retrying") return cands.filter((c) => c.retryable).length;
  return cands.filter((c) => c.outcome === key).length;
}

function matchesFilter(c: Candidate, key: string): boolean {
  if (key === "all") return true;
  if (key === "retrying") return c.retryable;
  return c.outcome === key;
}

function entryTitle(c: Candidate): string {
  return c.title ?? c.url ?? "(untitled)";
}

/** Whether a row's `source` looks like an email address (vs a feed name) — the same shape the
 *  sweep's inbox path uses for `source` (a sender address). */
function isEmailSource(source: string | null): boolean {
  return !!source && source.includes("@");
}

function attribution(detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  const attrs = Array.isArray(d.attribution) ? d.attribution : [];
  return attrs
    .map((a) => (a && typeof a === "object" ? `@${(a as Record<string, unknown>).tenant}` : null))
    .filter((x): x is string => !!x)
    .join(", ");
}

/** A one-line plain-language summary of where/why the candidate stands (design.md's summary
 *  line). Mirrors the mock's summaryLine, grounded in the real detail shapes. */
function summaryLine(c: Candidate): string {
  const d = (c.detail ?? {}) as Record<string, unknown>;
  switch (c.outcome) {
    case "imported": {
      const who = attribution(c.detail);
      return `Imported${who ? ` → tagged for ${who}` : ""}${c.slug ? ` · ${c.slug}` : ""}`;
    }
    case "duplicate":
      return `Near-duplicate of ${String(d.duplicate_of ?? "an existing recipe")}`;
    case "no_match":
      return d.stage === "triage"
        ? "Stopped at triage — no member near in taste"
        : d.stage === "confirm"
          ? "Cleared cosine, but the LLM confirm declined all candidates"
          : "No member cleared the taste threshold";
    case "dietary_gated":
      return `Gated by a hard dietary restriction${d.restriction ? ` — ${d.restriction}` : ""}${d.tenant ? ` (@${d.tenant})` : ""}`;
    case "rejected_source":
      return `Source on the member reject list${d.tenant ? ` (@${d.tenant})` : ""}`;
    case "error": {
      const reason = typeof d.reason === "string" ? d.reason : "unknown reason";
      const label = ACQUIRE_REASON_LABEL[reason] ?? reason;
      return `Parked at ${STAGES[STAGE_IX[c.haltStage]].label} — ${label}${d.status ? ` (${d.status})` : ""}`;
    }
    case "failed":
      return `Infrastructure failure at ${STAGES[STAGE_IX[c.haltStage]].label} — ${String(d.reason ?? "unexpected error")}`;
    case "deferred":
      return `Passed match; deferred at import — ${String(d.note ?? "rate cap reached, re-queued for next tick")}`;
    default:
      return c.outcome;
  }
}

/** The one row-action mutation (Retry / Delete) — its `variables` are the acting op, so the
 *  in-flight op, its target, and its failure cannot contradict (the island's ActionState union,
 *  now carried by the mutation itself). */
type RowOp = { kind: "retry"; id: string } | { kind: "delete"; id: string };

/** The Retry-clock / terminal readout for a retryable or terminal row (design.md's retry-clock
 *  requirement). Non-retryable, non-terminal rows (a plain rejection) render nothing. */
const RetryReadout = ({
  c,
  now,
  pendingOp,
  anyPending,
  onAct,
}: {
  c: Candidate;
  now: number;
  pendingOp: RowOp | null;
  anyPending: boolean;
  onAct: (op: RowOp) => void;
}) => {
  const isTerminal = isRetryable(c.outcome) && !c.retryable && c.attempts > 0;
  if (!c.retryable && !isTerminal) return null;
  const act = (op: RowOp) => (e: React.MouseEvent) => {
    // The buttons live INSIDE <summary>: preventDefault suppresses the native <details>
    // toggle-on-click default action, leaving the disclosure to every OTHER summary click.
    e.preventDefault();
    if (anyPending) return;
    onAct(op);
  };
  const retryBusy = pendingOp?.kind === "retry" && pendingOp.id === c.id;
  const deleteBusy = pendingOp?.kind === "delete" && pendingOp.id === c.id;
  return (
    <div className="dc-retry" data-candidate-id={c.id}>
      {c.retryable ? (
        <>
          <span className="muted small">
            attempt {c.attempts}/{RETRY_MAX_ATTEMPTS}
            {c.next_retry_at ? ` · auto-retry ${relFuture(new Date(c.next_retry_at).getTime(), now)}` : ""}
          </span>
          <Button className="dc-retry-btn" variant="outline" size="sm" disabled={anyPending} onClick={act({ kind: "retry", id: c.id })}>
            <RotateIcon size={13} /> {retryBusy ? "Retrying…" : "Retry now"}
          </Button>
        </>
      ) : (
        <span className="dc-terminal muted small">terminal · retry cap ({RETRY_MAX_ATTEMPTS}) reached</span>
      )}
      <Button variant="ghost" size="sm" disabled={anyPending} onClick={act({ kind: "delete", id: c.id })}>
        {deleteBusy ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
};

/** The per-member match scores computed at the match stage (operator-admin's "A match-halted
 *  candidate shows its per-member scores" requirement) — best score first, so the operator sees
 *  at a glance how close the nearest member came, not only the pass/fail outcome. Renders
 *  nothing when the row carries no scores (e.g. halted before the match stage, or imported). */
const MatchScores = ({ scores }: { scores: MatchScore[] | null }) => {
  if (!scores || scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  return (
    <div className="dc-match-scores">
      {sorted.map((s) => (
        <Badge key={s.tenant} variant="outline">
          @{s.tenant} {s.score.toFixed(2)}
        </Badge>
      ))}
    </div>
  );
};

const StageDetail = ({ c }: { c: Candidate }) => {
  const haltIx = STAGE_IX[c.haltStage];
  const imported = c.outcome === "imported";
  return (
    <div className="dc-stages">
      {STAGES.map((s, i) => {
        const done = i < haltIx || (i === haltIx && imported);
        const halt = i === haltIx && !imported;
        const isPush = c.pushed && s.key === "acquire" && done;
        const rowClass = done ? `dcs-row done${isPush ? " push" : ""}` : halt ? `dcs-row halt ${c.kind}` : "dcs-row todo";
        return (
          <div key={s.key} className={rowClass}>
            <span className="dcs-ico">{isPush ? <InboxIcon size={15} /> : done ? <CheckCircleIcon size={15} /> : s.icon}</span>
            <div className="dcs-body">
              <div className="dcs-name">
                {s.label}
                {isPush ? (
                  <span className="dcs-tag push">arrived via push</span>
                ) : done ? (
                  <span className="dcs-tag ok">passed</span>
                ) : halt ? (
                  <span className="dcs-tag halt">stopped here</span>
                ) : (
                  <span className="dcs-tag todo">not reached</span>
                )}
              </div>
              <div className="dcs-blurb muted small">{s.blurb}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const CandidateCard = ({
  c,
  now,
  pendingOp,
  anyPending,
  onAct,
}: {
  c: Candidate;
  now: number;
  pendingOp: RowOp | null;
  anyPending: boolean;
  onAct: (op: RowOp) => void;
}) => {
  const email = isEmailSource(c.source);
  const rawRow: Record<string, unknown> = {
    id: c.id,
    url: c.url,
    outcome: c.outcome,
    slug: c.slug,
    attempts: c.attempts,
    next_retry_at: c.next_retry_at ? relFuture(new Date(c.next_retry_at).getTime(), now) : null,
    ...((c.detail ?? {}) as Record<string, unknown>),
  };
  return (
    <div className={`dc-card kind-${c.kind}`} data-candidate-id={c.id}>
      <details className="dc-details">
        {/* Everything visible on the collapsed card — including the retry clock/actions and the
            Details toggle affordance — lives inside <summary> so it is the ONE clickable native
            disclosure control: always visible, and correctly bidirectional (open ↔ closed). */}
        <summary className="dc-main">
          <div className="dc-headrow">
            <span className="dc-title">{entryTitle(c)}</span>
            <Badge variant={c.kind === "accepted" ? "secondary" : c.kind === "park" || c.kind === "fail" ? "destructive" : "outline"}>
              {OUTCOME_LABEL[c.outcome] ?? c.outcome}
            </Badge>
          </div>
          <div className="dc-src">
            {c.pushed ? <InboxIcon size={13} /> : email ? <MailIcon size={13} /> : <RssIcon size={13} />}
            <span className="dc-src-name">{c.source ?? ""}</span>
            {c.pushed ? <Badge variant="outline">satellite: {c.origin ?? "?"}</Badge> : null}
            {c.created_at ? (
              <>
                <span className="dimsep">·</span>
                <span className="muted">{relAge(new Date(c.created_at).getTime(), now)}</span>
              </>
            ) : null}
            {c.url ? <span className="dc-url muted">{c.url.replace(/^https?:\/\//, "").slice(0, 46)}</span> : null}
          </div>

          <StageTrack
            stages={STAGES.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))}
            haltIndex={STAGE_IX[c.haltStage]}
            kind={c.kind}
            imported={c.outcome === "imported"}
            pushedAcquireIndex={c.pushed ? STAGE_IX.acquire : null}
          />

          <div className="dc-summary">{summaryLine(c)}</div>
          <MatchScores scores={c.matchScores} />

          <div className="dc-foot">
            <RetryReadout c={c} now={now} pendingOp={pendingOp} anyPending={anyPending} onAct={onAct} />
            <span className="dc-expand">
              <span className="dc-expand-closed">
                Details <ChevronDownIcon size={14} />
              </span>
              <span className="dc-expand-open">
                Hide{" "}
                <span className="up">
                  <ChevronDownIcon size={14} />
                </span>
              </span>
            </span>
          </div>
        </summary>

        <div className="dc-detail">
          <StageDetail c={c} />
          <div className="dc-rawwrap">
            <p className="log-summary-label muted small">discovery_log detail</p>
            <PrettyKV obj={rawRow} />
          </div>
        </div>
      </details>
    </div>
  );
};

/** The Candidates | Satellites sub-nav shared by both Discovery views. */
export const DiscoverySubNav = ({ active }: { active: "candidates" | "satellites" }) => (
  <div className="data-nav">
    <Link to="/discovery" search={{ filter: "all", page: 1 }} className={active === "candidates" ? "pill active" : "pill"}>
      Candidates
    </Link>
    <Link to="/discovery/satellites" className={active === "satellites" ? "pill active" : "pill"}>
      Satellites
    </Link>
  </div>
);

const IngestStrip = ({ ingest }: { ingest: IngestStripData }) => {
  if (ingest.activeSatellites === 0) return null;
  return (
    <Link to="/discovery/satellites" className={ingest.warn ? "dc-ingest-strip warn" : "dc-ingest-strip"}>
      <InboxIcon size={13} />
      <span>
        <strong>{ingest.activeSatellites} satellites</strong> · {ingest.fresh} fresh
        {ingest.stale ? <span className="txt-bad"> · {ingest.stale} stale</span> : null} · {ingest.pushedToday} recipes pushed today
      </span>
      <span className="dc-strip-go">Satellites →</span>
    </Link>
  );
};

/** The loaded Discovery view: stat tiles, filter pills, the paginated candidate list.
 *  `filter`/`page` are validated route search params so every combination is deep-linkable. */
function DiscoveryView({
  data,
  filter,
  page,
  onRefresh,
}: {
  data: DiscoveryData;
  filter: string;
  page: number;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const { candidates, ingest, now } = data;

  const rowAction = useMutation({
    mutationFn: (op: RowOp): Promise<unknown> =>
      op.kind === "retry"
        ? unwrap(api.admin.api.discovery[":id"].retry.$post({ param: { id: op.id } }))
        : unwrap(api.admin.api.discovery[":id"].$delete({ param: { id: op.id } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["discovery", "candidates"] }),
  });
  const pendingOp = rowAction.isPending ? rowAction.variables : null;
  const actionError = rowAction.error ? (apiErrorOf(rowAction.error)?.message ?? String(rowAction.error)) : null;

  const total = candidates.length;
  // `readDiscoveryCandidates` orders newest-first, so the freshest row's `created_at` is the
  // cleanest available signal for "when did the sweep last touch this pipeline".
  const lastSweepAt = candidates[0]?.created_at ? new Date(candidates[0].created_at).getTime() : null;
  const imported = candidates.filter((c) => c.outcome === "imported").length;
  const importRate = total > 0 ? Math.round((imported / total) * 100) : 0;
  const parkedFailed = candidates.filter((c) => c.outcome === "error" || c.outcome === "failed").length;
  const inRetryQueue = candidates.filter((c) => c.retryable).length;

  const filtered = candidates.filter((c) => matchesFilter(c, filter));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(Math.max(0, page - 1), pages - 1);
  const shown = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);

  const gotoPage = (nextPg: number) => navigate({ to: "/discovery", search: { filter, page: nextPg + 1 } });

  return (
    <div className="discovery">
      <div className="area-head status-head">
        <h2>Discovery</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh{lastSweepAt != null ? ` · last sweep ${relAge(lastSweepAt, now)}` : ""}
        </Button>
      </div>

      <DiscoverySubNav active="candidates" />

      <IngestStrip ingest={ingest} />

      <StatCardGrid>
        <StatCard icon={<CompassIcon size={15} />} label="Candidates" value={total} />
        <StatCard icon={<CheckCircleIcon size={15} />} label="Imported" value={imported} sub={`${importRate}% of intake`} />
        <StatCard icon={<AlertTriangleIcon size={15} />} label="Parked / failed" value={parkedFailed} />
        <StatCard icon={<RotateIcon size={15} />} label="In retry queue" value={inRetryQueue} />
      </StatCardGrid>

      <div className="data-nav dc-filters">
        {FILTERS.map((f) => {
          const n = countFor(candidates, f.key);
          const active = filter === f.key;
          return (
            <Link
              key={f.key}
              className={active ? "pill active" : "pill"}
              to="/discovery"
              search={{ filter: f.key, page: 1 }}
              aria-disabled={n === 0 && f.key !== "all" ? true : undefined}
            >
              {f.label}
              {n > 0 ? <span className="pill-count">{n}</span> : null}
            </Link>
          );
        })}
      </div>

      {actionError != null ? (
        <ErrorBanner message={`${rowAction.variables?.kind === "delete" ? "Delete" : "Retry"} failed: ${actionError}`} />
      ) : null}

      {shown.length === 0 ? (
        <p className="muted">No candidates match this filter.</p>
      ) : (
        <div className="dc-list" id="discovery-list">
          {shown.map((c) => (
            <CandidateCard
              key={c.id}
              c={c}
              now={now}
              pendingOp={pendingOp ?? null}
              anyPending={rowAction.isPending}
              onAct={(op) => rowAction.mutate(op)}
            />
          ))}
        </div>
      )}

      {pages > 1 ? (
        <Pager
          info={`Page ${pg + 1} of ${pages} · ${filtered.length} candidates`}
          prev={
            <Button variant="outline" size="sm" disabled={pg === 0} onClick={() => gotoPage(pg - 1)}>
              Prev
            </Button>
          }
          next={
            <Button variant="outline" size="sm" disabled={pg >= pages - 1} onClick={() => gotoPage(pg + 1)}>
              Next
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

/** The routed Discovery screen: one primary query, branched exhaustively on its status. */
export function DiscoveryScreen({ filter, page }: { filter: string; page: number }) {
  const q = useQuery(discoveryCandidatesQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <DiscoveryView data={q.data} filter={filter} page={page} onRefresh={() => void q.refetch()} />;
    default:
      return assertNever(q);
  }
}

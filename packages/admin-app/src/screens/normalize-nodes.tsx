// Normalize › Nodes (admin-spa): the READ-ONLY browse over the identity graph (design D11 — no
// edge mutations), ported from the SSR page's NodesTab. A node list (facet-filtered, deep-linkable
// by ?facet) opens a relationship detail (?node=<id>) that lays a node's incoming ("satisfied by")
// and outgoing ("satisfies") edges on one left→right axis. Orphans (edgeless concrete non-merged
// nodes) are the audit signal, filterable. Selection is a search param — every view deep-links.

import { Link } from "@tanstack/react-router";
import { Button } from "../components/kit";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitMergeIcon,
  LayersIcon,
  TargetIcon,
} from "../components/icons";
import type { NormalizeNodesData } from "../lib/queries";
import { type NormalizeQuery, linkSearch, NzPager, ResolvedId, SourceBadge } from "./normalize-shared";

type NodesModel = NormalizeNodesData;
type GraphNode = NodesModel["nodes"][number];
type NodeEdge = GraphNode["incoming"][number];

const NODE_PAGE_SIZE = 25;

/** Edge-kind badge presentation. general=blue · containment=amber · membership=violet. */
const EDGE_KIND_GLOSS: Record<string, string> = {
  general: "a specific type satisfies its base",
  containment: "a whole satisfies a part",
  membership: "a member satisfies a concept class",
};

const KindBadge = ({ kind }: { kind: string }) => <span className={`ng-kind k-${kind}`}>{kind}</span>;

/** A node's "kind" label for the list sub-line. */
function nodeKindLabel(n: GraphNode): string {
  return !n.concrete ? "concept class" : n.detail ? "specialization" : "base";
}

function isNodeOrphan(n: GraphNode): boolean {
  return n.concrete && n.rep == null && n.incoming.length === 0 && n.outgoing.length === 0;
}

const NODE_FACETS: Array<{ key: string; label: string; test: (n: GraphNode) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "base", label: "Bases", test: (n) => n.concrete && !n.detail && n.rep == null },
  { key: "detail", label: "Specializations", test: (n) => !!n.detail },
  { key: "concept", label: "Concepts", test: (n) => !n.concrete },
  { key: "orphan", label: "Orphans", test: isNodeOrphan },
];

/** One directed edge chip on the satisfies axis. The arrow always points RIGHT (the global
 *  "satisfies" flow), so `dir` only orders the pill vs the arrow — incoming reads other→node,
 *  outgoing reads node→other. A known-node endpoint deep-links to that node. */
const EdgeChip = ({
  e,
  dir,
  byId,
  query,
}: {
  e: NodeEdge;
  dir: "in" | "out";
  byId: Map<string, GraphNode>;
  query: NormalizeQuery;
}) => {
  const other = byId.get(e.id);
  const arrow = (
    <span className="ng-arrow-wire">
      <KindBadge kind={e.kind} />
      <ArrowRightIcon size={13} />
    </span>
  );
  const pill = (
    <span className="ng-edge-node">
      {other ? <ResolvedId base={other.base} detail={other.detail} concept={!other.concrete} /> : <code>{e.id}</code>}
    </span>
  );
  const body =
    dir === "in" ? (
      <>
        {pill}
        {arrow}
      </>
    ) : (
      <>
        {arrow}
        {pill}
      </>
    );
  if (other) {
    return (
      <Link className="ng-edge" to="/normalize" search={linkSearch({ node: e.id }, query)} title={EDGE_KIND_GLOSS[e.kind] ?? e.kind}>
        {body}
      </Link>
    );
  }
  return (
    <span className="ng-edge disabled" title={EDGE_KIND_GLOSS[e.kind] ?? e.kind}>
      {body}
    </span>
  );
};

/** The relationship detail for one selected node — identity facts + the satisfies axis. */
const NodeDetail = ({ node, byId, query }: { node: GraphNode; byId: Map<string, GraphNode>; query: NormalizeQuery }) => {
  const orphan = isNodeOrphan(node);
  const inc = node.incoming;
  const out = node.outgoing;
  return (
    <div className="node-detail">
      <Button variant="outline" size="sm" className="nd-back" asChild>
        <Link to="/normalize" search={linkSearch({ node: "" }, query)}>
          <ChevronLeftIcon size={15} /> Nodes
        </Link>
      </Button>

      <div className="nd-head">
        <div className="nd-id">
          <span className={`ng-row-glyph big${!node.concrete ? " concept" : orphan ? " orphan" : ""}`}>
            {!node.concrete ? <LayersIcon size={20} /> : node.rep ? <GitMergeIcon size={20} /> : <TargetIcon size={20} />}
          </span>
          <div className="nd-id-text">
            <div className="nd-id-main">
              <ResolvedId base={node.base} detail={node.detail} concept={!node.concrete} />
            </div>
            <div className="nd-id-sub">
              {!node.concrete ? (
                "abstract concept class"
              ) : node.detail ? (
                <>
                  specialization of <code>{node.base}</code>
                </>
              ) : (
                "canonical base"
              )}
            </div>
          </div>
        </div>
        {orphan ? (
          <span className="ng-orphan-chip big">
            <AlertTriangleIcon size={13} /> orphan
          </span>
        ) : null}
      </div>

      <dl className="nd-facts">
        <div className="nd-fact">
          <dt>Kind</dt>
          <dd>
            {!node.concrete ? (
              <span className="ng-fact-concept">
                <LayersIcon size={13} /> concept class
              </span>
            ) : (
              <span className="ng-fact-concrete">
                <TargetIcon size={13} /> concrete product
              </span>
            )}
          </dd>
        </div>
        <div className="nd-fact">
          <dt>Base</dt>
          <dd>
            <code>{node.base}</code>
          </dd>
        </div>
        <div className="nd-fact">
          <dt>Detail</dt>
          <dd>{node.detail ? <code>{node.detail}</code> : <span className="pv-null">—</span>}</dd>
        </div>
        <div className="nd-fact">
          <dt>Source</dt>
          <dd>
            <SourceBadge source={node.source} />
          </dd>
        </div>
        <div className="nd-fact">
          <dt>Edges</dt>
          <dd>
            <span className="ng-fact-edges">
              {inc.length} in <span className="nz-id-dot">·</span> {out.length} out
            </span>
          </dd>
        </div>
        {node.rep ? (
          <div className="nd-fact">
            <dt>Merged into</dt>
            <dd>
              <Link className="nd-rep-link" to="/normalize" search={linkSearch({ node: node.rep }, query)}>
                <code>{node.rep}</code>
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      {node.rep ? (
        <div className="nd-rep">
          <GitMergeIcon size={14} />
          <span>
            Merged into{" "}
            <Link className="nd-rep-link" to="/normalize" search={linkSearch({ node: node.rep }, query)}>
              <code>{node.rep}</code>
            </Link>{" "}
            — requests for this id re-key to the representative.
          </span>
        </div>
      ) : null}

      {node.aliases.length > 0 ? (
        <div className="nd-block">
          <p className="nz-detail-label">
            Aliases <span className="muted">· surface forms that resolve here</span>
          </p>
          <div className="nd-aliases">
            {node.aliases.map((a) => (
              <code key={a} className="nd-alias">
                {a}
              </code>
            ))}
          </div>
        </div>
      ) : null}

      <div className="nd-block">
        <p className="nz-detail-label">
          Relationships <span className="muted">· directed "satisfies" edges — left to right</span>
        </p>

        {orphan ? (
          <div className="nd-orphan-note">
            <AlertTriangleIcon size={16} />
            <div>
              <strong>No satisfies-edges — this node is orphaned.</strong>
              <p className="muted small">
                A concrete node with zero edges. Nothing satisfies it and it satisfies nothing, so it can't be matched through the
                graph — a below-floor mint that never got linked, and a candidate for a pinned alias/override.
              </p>
            </div>
          </div>
        ) : (
          <div className="ng-axis">
            <div className="ng-axis-col in">
              <div className="ng-axis-cap">
                <ChevronRightIcon size={12} className="ng-cap-in" /> Satisfied by<span className="ng-axis-n">{inc.length}</span>
              </div>
              {inc.length ? (
                inc.map((e) => <EdgeChip key={`${e.id} ${e.kind}`} e={e} dir="in" byId={byId} query={query} />)
              ) : (
                <span className="ng-axis-empty">nothing points in</span>
              )}
            </div>

            <div className="ng-axis-center">
              <div className="ng-center-node">
                <ResolvedId base={node.base} detail={node.detail} concept={!node.concrete} />
              </div>
              <span className="ng-axis-flow">satisfies →</span>
            </div>

            <div className="ng-axis-col out">
              <div className="ng-axis-cap">
                Satisfies<span className="ng-axis-n">{out.length}</span>
                <ChevronRightIcon size={12} className="ng-cap-out" />
              </div>
              {out.length ? (
                out.map((e) => <EdgeChip key={`${e.id} ${e.kind}`} e={e} dir="out" byId={byId} query={query} />)
              ) : (
                <span className="ng-axis-empty">points to nothing</span>
              )}
            </div>
          </div>
        )}

        <div className="nd-legend">
          {Object.keys(EDGE_KIND_GLOSS).map((k) => (
            <span key={k} className="nd-legend-item">
              <KindBadge kind={k} />
              <span className="muted small">{EDGE_KIND_GLOSS[k]}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

/** The Nodes tab: the node list (facet-filtered + paged), or the selected node's detail. */
export const NodesTab = ({ nodes, query }: { nodes: NodesModel; query: NormalizeQuery }) => {
  const byId = new Map(nodes.nodes.map((n) => [n.id, n]));

  const selected = query.node ? byId.get(query.node) : undefined;
  if (selected) {
    return <NodeDetail node={selected} byId={byId} query={query} />;
  }

  const facetTest = (NODE_FACETS.find((f) => f.key === query.facet) ?? NODE_FACETS[0]).test;
  const rows = nodes.nodes.filter(facetTest);
  const pages = Math.max(1, Math.ceil(rows.length / NODE_PAGE_SIZE));
  const pg = Math.min(query.page, pages - 1);
  const shown = rows.slice(pg * NODE_PAGE_SIZE, pg * NODE_PAGE_SIZE + NODE_PAGE_SIZE);

  return (
    <div className="nodes">
      <p className="nz-queue-blurb muted small">
        Every canonical node in the identity graph — <code>base</code> or <code>base::detail</code>, concrete products and abstract
        concept classes — with its directed satisfies-edges. Pick a node to audit what it is and how it's connected. Edgeless
        concrete nodes surface under{" "}
        <Link className="ng-inline-filter" to="/normalize" search={linkSearch({ facet: "orphan", page: 0 }, query)}>
          Orphans
        </Link>
        .
      </p>

      <div className="data-nav ng-facets">
        {NODE_FACETS.map((f) => {
          const n = nodes.nodes.filter(f.test).length;
          return (
            <Link
              key={f.key}
              className={`pill${f.key === "orphan" ? " ng-pill-orphan" : ""}${query.facet === f.key ? " active" : ""}`}
              to="/normalize"
              search={linkSearch({ facet: f.key, page: 0 }, query)}
              aria-disabled={n === 0 && f.key !== "all"}
            >
              {f.key === "orphan" ? <AlertTriangleIcon size={12} /> : null}
              {f.label}
              {n > 0 ? <span className="pill-count">{n}</span> : null}
            </Link>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="nz-al-empty muted small">No nodes match this filter.</p>
      ) : (
        <div className="ng-list">
          {shown.map((n) => {
            const orphan = isNodeOrphan(n);
            return (
              <Link
                key={n.id}
                className={`ng-row${orphan ? " orphan" : ""}`}
                to="/normalize"
                search={linkSearch({ node: n.id }, query)}
              >
                <span className={`ng-row-glyph${!n.concrete ? " concept" : orphan ? " orphan" : ""}`}>
                  {!n.concrete ? <LayersIcon size={15} /> : n.rep ? <GitMergeIcon size={15} /> : <TargetIcon size={15} />}
                </span>
                <span className="ng-row-main">
                  <span className="ng-row-id">
                    <ResolvedId base={n.base} detail={n.detail} concept={!n.concrete} />
                  </span>
                  <span className="ng-row-sub">
                    <span className="ng-row-kind">{nodeKindLabel(n)}</span>
                    <span className="nz-id-dot">·</span>
                    <span>
                      {n.aliases.length} {n.aliases.length === 1 ? "alias" : "aliases"}
                    </span>
                    {n.rep ? (
                      <>
                        <span className="nz-id-dot">·</span>
                        <span className="ng-row-merged">
                          <GitMergeIcon size={11} /> merged → <code>{n.rep}</code>
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="ng-row-trail">
                  {orphan ? (
                    <span className="ng-orphan-chip">
                      <AlertTriangleIcon size={11} /> orphan
                    </span>
                  ) : (
                    <span className="ng-deg">
                      <span className="ng-deg-part" title="satisfied by (incoming)">
                        <ChevronRightIcon size={12} className="ng-deg-in" />
                        {n.incoming.length}
                      </span>
                      <span className="ng-deg-part" title="satisfies (outgoing)">
                        {n.outgoing.length}
                        <ChevronRightIcon size={12} className="ng-deg-out" />
                      </span>
                    </span>
                  )}
                  <ChevronRightIcon size={16} className="ng-row-chev" />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {pages > 1 ? (
        <NzPager
          pg={pg}
          pages={pages}
          info={`Page ${pg + 1} of ${pages} · ${rows.length} nodes`}
          searchFor={(page) => linkSearch({ page }, query)}
        />
      ) : null}
    </div>
  );
};

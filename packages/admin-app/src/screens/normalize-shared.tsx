// Normalize (admin-spa) — the shared search-param vocabulary + tiny renderers the area's
// screens compose. The URL state ports the SSR page's `parseQuery` exactly (same names,
// defaults omitted): every field is optional and present ONLY when non-default, so
// `Link`/`navigate` omit defaults structurally (`undefined` never serializes) and every
// tab/stream/filter/search/page/node/facet combination stays deep-linkable.

import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "../components/kit";
import { UsersIcon } from "../components/icons";
import type { NormalizePageData } from "../lib/queries";

export type NormalizeTab = "decisions" | "audits" | "queue" | "aliases" | "reconcile" | "nodes";

/** The `/normalize` URL state — the SSR query params, defaults omitted. */
export interface NormalizeSearch {
  tab?: Exclude<NormalizeTab, "decisions">;
  /** Decisions-tab stream segment; omitted = the term stream. */
  stream?: "edges";
  /** Omitted = "all". */
  filter?: string;
  /** Omitted = "". */
  q?: string;
  /** Omitted = "all". */
  src?: string;
  /** 1-based in the URL (present only when ≥ 2 — page 1 is the default). */
  page?: number;
  /** Selected node id on the Nodes tab; omitted = the node list. */
  node?: string;
  /** Node-list facet on the Nodes tab; omitted = "all". */
  facet?: string;
}

/** Validate the raw search params (the route's `validateSearch`) — the SSR `parseQuery`. */
export function validateNormalizeSearch(s: Record<string, unknown>): NormalizeSearch {
  const page = Number(s.page);
  return {
    tab:
      s.tab === "audits" || s.tab === "queue" || s.tab === "aliases" || s.tab === "reconcile" || s.tab === "nodes"
        ? s.tab
        : undefined,
    stream: s.stream === "edges" ? "edges" : undefined,
    filter: typeof s.filter === "string" && s.filter !== "all" && s.filter !== "" ? s.filter : undefined,
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
    src: typeof s.src === "string" && s.src !== "all" && s.src !== "" ? s.src : undefined,
    page: Number.isFinite(page) && page >= 2 ? Math.floor(page) : undefined,
    node: typeof s.node === "string" && s.node !== "" ? s.node : undefined,
    facet: typeof s.facet === "string" && s.facet !== "all" && s.facet !== "" ? s.facet : undefined,
  };
}

/** The resolved (defaults filled) query state the views read — the SSR `NormalizeQuery`.
 *  `page` is 0-based here (the URL carries it 1-based), matching the SSR convention. */
export interface NormalizeQuery {
  tab: NormalizeTab;
  stream: "terms" | "edges";
  filter: string;
  q: string;
  src: string;
  page: number;
  node: string;
  facet: string;
}

export function resolveQuery(s: NormalizeSearch): NormalizeQuery {
  return {
    tab: s.tab ?? "decisions",
    stream: s.stream ?? "terms",
    filter: s.filter ?? "all",
    q: s.q ?? "",
    src: s.src ?? "all",
    page: (s.page ?? 1) - 1,
    node: s.node ?? "",
    facet: s.facet ?? "all",
  };
}

/** Serialize a resolved query back to URL search params, defaults omitted (the SSR `href`). */
export function toSearch(q: NormalizeQuery): NormalizeSearch {
  return {
    tab: q.tab === "decisions" ? undefined : q.tab,
    stream: q.stream === "edges" ? "edges" : undefined,
    filter: q.filter === "all" ? undefined : q.filter,
    q: q.q === "" ? undefined : q.q,
    src: q.src === "all" ? undefined : q.src,
    node: q.node === "" ? undefined : q.node,
    facet: q.facet === "all" ? undefined : q.facet,
    page: q.page > 0 ? q.page + 1 : undefined,
  };
}

/** Merge a partial update into the current query and serialize — the SSR `href(part, cur)`. */
export function linkSearch(part: Partial<NormalizeQuery>, cur: NormalizeQuery): NormalizeSearch {
  return toSearch({ ...cur, ...part });
}

// ── Shared model aliases (derived from the wire payloads — never Worker imports) ────────────

export type PageModel = NormalizePageData["data"];
export type NormalizationDecision = PageModel["decisions"][number];
export type AliasRow = PageModel["aliases"][number];

// ── Shared renderers ─────────────────────────────────────────────────────────────────────────

/** Canonical id renderer — base in normal weight, ::detail as a lighter badge, a concept tag. */
export const ResolvedId = ({ base, detail, concept }: { base: string; detail: string | null; concept?: boolean }) => (
  <span className="nz-id">
    <span className="nz-id-base">{base}</span>
    {detail ? (
      <>
        <span className="nz-id-dot">·</span>
        <span className="nz-id-detail">{detail}</span>
      </>
    ) : null}
    {concept ? <span className="nz-id-tag">concept</span> : null}
  </span>
);

/** The human/auto source chip. */
export const SourceBadge = ({ source }: { source: string }) => (
  <span className={source === "human" ? "nz-src human" : "nz-src"}>
    {source === "human" ? (
      <>
        <UsersIcon size={11} /> human
      </>
    ) : (
      "auto"
    )}
  </span>
);

/** The area's Prev / info / Next pager row (`.nz-pager`), client-side over search params. */
export const NzPager = ({
  pg,
  pages,
  info,
  searchFor,
}: {
  pg: number;
  pages: number;
  info: React.ReactNode;
  searchFor: (page: number) => NormalizeSearch;
}) => (
  <div className="nz-pager">
    {pg > 0 ? (
      <Button variant="outline" size="sm" asChild>
        <Link to="/normalize" search={searchFor(pg - 1)}>
          Prev
        </Link>
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled>
        Prev
      </Button>
    )}
    <span className="muted small">{info}</span>
    {pg < pages - 1 ? (
      <Button variant="outline" size="sm" asChild>
        <Link to="/normalize" search={searchFor(pg + 1)}>
          Next
        </Link>
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled>
        Next
      </Button>
    )}
  </div>
);

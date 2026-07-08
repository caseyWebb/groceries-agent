// Normalize › Aliases (admin-spa): the live variant→id map the matcher reads, ported from the
// SSR page's AliasesTab. Mappings-only listing (canonical self-entries collapse into the count
// chip, never rows), source pills + text filter + pagination as search params, and the two
// mutations (add via the shared dialog, delete per row) lifted to the screen's callbacks.

import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Badge as UiBadge } from "@grocery-agent/ui";
import { Button } from "../components/kit";
import { SearchIcon, XCircleIcon, ArrowRightIcon, TrashIcon } from "../components/icons";
import {
  type AliasRow,
  type NormalizeQuery,
  type PageModel,
  linkSearch,
  NzPager,
  ResolvedId,
  SourceBadge,
} from "./normalize-shared";

export const ALIAS_PAGE_SIZE = 25;

function filterAliases(rows: AliasRow[], q: NormalizeQuery): AliasRow[] {
  const needle = q.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q.src !== "all" && r.source !== q.src) return false;
    if (!needle) return true;
    const idStr = r.base + (r.detail ? `::${r.detail}` : "");
    return `${r.variant} ${idStr}`.toLowerCase().includes(needle);
  });
}

/** The controlled variant/id filter box — remounted via `key={q.q}` by the caller so the draft
 *  resets when the URL's q changes (a Clear click, a deep link). Submit navigates with the new
 *  q and a page reset, preserving the source pill. */
const AliasSearchForm = ({ query }: { query: NormalizeQuery }) => {
  const navigate = useNavigate();
  const [draft, setDraft] = React.useState(query.q);
  return (
    <form
      className="recipe-search nz-al-search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ to: "/normalize", search: linkSearch({ q: draft, page: 0 }, query) });
      }}
    >
      <SearchIcon size={15} />
      <input
        className="recipe-search-input"
        type="text"
        name="q"
        placeholder="Filter variants or ids…"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
      {query.q ? (
        <Link className="recipe-search-clear" to="/normalize" search={linkSearch({ q: "", page: 0 }, query)} aria-label="Clear">
          <XCircleIcon size={15} />
        </Link>
      ) : null}
    </form>
  );
};

export const AliasesTab = ({
  data,
  query,
  busy,
  onAdd,
  onDelete,
}: {
  data: PageModel;
  query: NormalizeQuery;
  busy: boolean;
  onAdd: () => void;
  onDelete: (variant: string) => void;
}) => {
  const SRC = [
    { key: "all", label: "All", n: data.aliases.length },
    { key: "human", label: "Human", n: data.aliases.filter((a) => a.source === "human").length },
    { key: "auto", label: "Auto", n: data.aliases.filter((a) => a.source === "auto").length },
  ];
  const filtered = filterAliases(data.aliases, query);
  const pages = Math.max(1, Math.ceil(filtered.length / ALIAS_PAGE_SIZE));
  const pg = Math.min(query.page, pages - 1);
  const shown = filtered.slice(pg * ALIAS_PAGE_SIZE, pg * ALIAS_PAGE_SIZE + ALIAS_PAGE_SIZE);

  return (
    <div className="nz-aliases">
      <p className="nz-queue-blurb muted small">
        The live surface-form → canonical id map the matcher reads. The cron grows it automatically; edit here only to pin a
        synonym it hasn't found or prune a bad one.
      </p>
      <div className="nz-al-toolbar">
        <AliasSearchForm key={query.q} query={query} />
        <div className="data-nav nz-al-srcpills">
          {SRC.map((s) => (
            <Link
              key={s.key}
              className={query.src === s.key ? "pill active" : "pill"}
              to="/normalize"
              search={linkSearch({ src: s.key, page: 0 }, query)}
            >
              {s.label}
              {s.n > 0 ? <span className="pill-count">{s.n}</span> : null}
            </Link>
          ))}
        </div>
        {data.aliasSelfCount > 0 ? (
          // The canonical self-entry population (variant === id, the resolver front-door row
          // every mint writes) — real rows in the table, but not mappings; a count, not a list.
          <UiBadge
            className="nz-al-selfcount"
            variant="outline"
            title="Front-door rows mapping a canonical id to itself — not shown as mappings"
          >
            {data.aliasSelfCount} canonical {data.aliasSelfCount === 1 ? "entry" : "entries"}
          </UiBadge>
        ) : null}
        <Button size="sm" className="nz-al-add" data-action="alias-add" onClick={onAdd}>
          + Add mapping
        </Button>
      </div>

      <div className="cfg-table-wrap">
        <table className="cfg-table nz-al-table">
          <thead>
            <tr>
              <th>Variant</th>
              <th className="nz-al-th-arrow" aria-label="maps to"></th>
              <th>Canonical id</th>
              <th>Source</th>
              <th className="cfg-th-act">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="nz-al-empty muted small">
                  No mappings match this filter.
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={r.variant}>
                  <td>
                    <code className="nz-al-variant">{r.variant}</code>
                  </td>
                  <td className="nz-al-arrow">
                    <ArrowRightIcon size={13} />
                  </td>
                  <td>
                    <span className="nz-al-id">
                      <ResolvedId base={r.base} detail={r.detail} concept={r.concept} />
                      {r.merged ? <span className="nz-al-merged">merged</span> : null}
                    </span>
                  </td>
                  <td>
                    <SourceBadge source={r.source} />
                  </td>
                  <td className="cfg-row-act">
                    <button
                      type="button"
                      className="cfg-remove"
                      data-action="alias-delete"
                      data-variant={r.variant}
                      title={r.source === "human" ? "Prune this pinned mapping" : "Prune — the cron may re-derive this"}
                      aria-label="Delete mapping"
                      disabled={busy}
                      onClick={() => onDelete(r.variant)}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <NzPager
          pg={pg}
          pages={pages}
          info={`Page ${pg + 1} of ${pages} · ${filtered.length} mappings`}
          searchFor={(page) => linkSearch({ page }, query)}
        />
      ) : null}
    </div>
  );
};

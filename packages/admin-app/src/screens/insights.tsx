// The Insights screen (group-insights): the group-wide popularity dashboard over the recipe
// corpus — windowed summary tiles, the GitHub-style cooking-activity heatmap, and recipe +
// source leaderboards. The ONE primary query loads `InsightsData` (every window precomputed by
// the Worker's readInsights), and the window / sort / expanded-source toggles are plain React
// state re-rendering from that one payload — ZERO further requests on toggle (spec-pinned).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { insightsQuery, type InsightsData } from "../lib/queries";
import { apiErrorOf } from "../lib/api";
import { assertNever } from "../lib/assert";
import { Badge, ErrorBanner } from "../components/kit";
import {
  FlameIcon,
  HeartIcon,
  TrophyIcon,
  TrendingUpIcon,
  RssIcon,
  ChevronDownIcon,
  ArrowRightIcon,
} from "../components/icons";

type WindowKey = keyof InsightsData["perWindow"];
type SortKey = "cooks" | "favorites";
type RecipeRow = InsightsData["perWindow"]["all"]["recipes"][number];
type SourceRow = InsightsData["perWindow"]["all"]["sources"][number];
type HeatmapData = InsightsData["heatmap"];
type Totals = InsightsData["perWindow"]["all"]["totals"];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "cooks", label: "Times cooked" },
  { key: "favorites", label: "Favorites" },
];

/** Rank rows by the selected metric descending, ties broken by the blended `combined` score —
 *  the SSR panel's `rankRows` (src/insights.ts), kept local so the screen never imports worker
 *  code beyond the payload type. */
function rankRows<T extends { favorites: number; cooks: number; combined: number }>(rows: T[], sort: SortKey): T[] {
  const metric = (r: T): number => (sort === "favorites" ? r.favorites : r.cooks);
  return [...rows].sort((a, b) => (metric(b) !== metric(a) ? metric(b) - metric(a) : b.combined - a.combined));
}

/** The metric a row is currently ranked/scaled by. */
const metricOf = (row: { favorites: number; cooks: number }, sort: SortKey): number =>
  sort === "favorites" ? row.favorites : row.cooks;

const Metric = ({
  icon,
  value,
  label,
  active,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  active: boolean;
}) => (
  <span className={active ? "ins-metric active" : "ins-metric"}>
    {icon}
    <span className="ins-metric-val">{value}</span>
    <span className="ins-metric-label">{label}</span>
  </span>
);

const Bar = ({ value, max, tone }: { value: number; max: number; tone: string }) => {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="ins-bar">
      <span className={`ins-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

/** The trailing-53-week cooking-activity heatmap. Cells are precomputed (column-major, Sun→Sat);
 *  the only per-render decision is dimming days outside the selected window (`windowStart`). */
const Heatmap = ({
  heatmap,
  windowStart,
  totals,
  win,
}: {
  heatmap: HeatmapData;
  windowStart: string;
  totals: Totals;
  win: WindowKey;
}) => (
  <div className="cal-wrap">
    <div className="cal-figure">
      <div className="cal-corner" />
      <div className="cal-months">
        {heatmap.months.map((m, i) => (
          <span key={i} className="cal-month" style={{ gridColumn: `span ${m.span}` }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="cal-days">
        <span />
        <span>Mon</span>
        <span />
        <span>Wed</span>
        <span />
        <span>Fri</span>
        <span />
      </div>
      <div className="cal-cells">
        {heatmap.cells.map((cell) => (
          <span
            key={cell.date}
            className={`cal-cell lvl-${cell.level}${cell.date >= windowStart ? "" : " out"}`}
            title={`${cell.count} ${cell.count === 1 ? "cook" : "cooks"} · ${cell.date}`}
          />
        ))}
      </div>
    </div>
    <div className="cal-legend">
      <span className="muted small">
        {totals.cooks} cooks · {totals.activeDays} active days
        {win !== "all" ? " in window" : ""}
      </span>
      <span className="cal-scale">
        <span className="muted small">Less</span>
        <span className="cal-cell lvl-0" />
        <span className="cal-cell lvl-1" />
        <span className="cal-cell lvl-2" />
        <span className="cal-cell lvl-3" />
        <span className="cal-cell lvl-4" />
        <span className="muted small">More</span>
      </span>
    </div>
  </div>
);

const RecipeBoard = ({ recipes, sort }: { recipes: RecipeRow[]; sort: SortKey }) => {
  const tone = sort === "favorites" ? "fav" : "cook";
  const max = Math.max(1, ...recipes.map((r) => metricOf(r, sort)));
  const rows = rankRows(recipes, sort).slice(0, 12);
  if (rows.length === 0) return <p className="muted">No cooks or favorites logged yet.</p>;
  return (
    <div className="ins-board">
      {rows.map((r, i) => (
        <Link key={r.slug} className="ins-row clickable" to="/data/recipes/$slug" params={{ slug: r.slug }}>
          <span className={"ins-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
          <div className="ins-main">
            <div className="ins-titlerow">
              <span className="ins-title">{r.title}</span>
              <span className="ins-sub muted">
                {r.cuisine ? `${r.cuisine} · ` : ""}
                {r.sourceName}
              </span>
            </div>
            <Bar value={metricOf(r, sort)} max={max} tone={tone} />
          </div>
          <div className="ins-metrics">
            <Metric icon={<HeartIcon size={13} />} value={r.favorites} label="favorited" active={sort === "favorites"} />
            <Metric icon={<FlameIcon size={13} />} value={r.cooks} label="cooked" active={sort === "cooks"} />
            <span className="ins-last muted small">last {r.lastCookedLabel}</span>
          </div>
        </Link>
      ))}
    </div>
  );
};

const SourceBoard = ({
  sources,
  sort,
  openSource,
  onToggleSource,
  onFeedLink,
}: {
  sources: SourceRow[];
  sort: SortKey;
  openSource: string | null;
  onToggleSource: (key: string) => void;
  onFeedLink: () => void;
}) => {
  const tone = sort === "favorites" ? "fav" : "cook";
  const max = Math.max(1, ...sources.map((s) => metricOf(s, sort)));
  const rows = rankRows(sources, sort);
  if (rows.length === 0) return <p className="muted">No sources yet.</p>;
  return (
    <div className="ins-board">
      {rows.map((s, i) => {
        const isOpen = openSource === s.key;
        const recipes = rankRows(s.recipes, sort);
        return (
          <div key={s.key} className={"ins-source-wrap" + (isOpen ? " open" : "")}>
            <button
              type="button"
              className="ins-row ins-source clickable"
              aria-expanded={isOpen}
              onClick={() => onToggleSource(s.key)}
            >
              <span className={"ins-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
              <div className="ins-main">
                <div className="ins-titlerow">
                  <span className="ins-title">{s.name}</span>
                  {s.isMember ? (
                    <Badge variant="outline">authored in-group</Badge>
                  ) : s.isFeed ? (
                    <span
                      className="ins-feed-tag"
                      role="link"
                      tabIndex={0}
                      title="Open discovery feed config"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFeedLink();
                      }}
                    >
                      <RssIcon size={11} /> discovery feed
                    </span>
                  ) : (
                    <span className="ins-sub muted">{s.domain}</span>
                  )}
                  <span className="ins-count muted small">
                    {s.recipeCount} {s.recipeCount === 1 ? "recipe" : "recipes"}
                  </span>
                </div>
                <Bar value={metricOf(s, sort)} max={max} tone={tone} />
              </div>
              <div className="ins-metrics">
                <Metric icon={<HeartIcon size={13} />} value={s.favorites} label="favorited" active={sort === "favorites"} />
                <Metric icon={<FlameIcon size={13} />} value={s.cooks} label="cooked" active={sort === "cooks"} />
              </div>
              <span className={"ins-caret" + (isOpen ? " up" : "")}>
                <ChevronDownIcon size={16} />
              </span>
            </button>
            {isOpen ? (
              <div className="ins-sub-recipes">
                {recipes.map((r) => (
                  <Link key={r.slug} className="ins-subrecipe" to="/data/recipes/$slug" params={{ slug: r.slug }}>
                    <span className="ins-subrecipe-title">{r.title}</span>
                    <span className="ins-subrecipe-cuisine muted small">{r.cuisine ?? ""}</span>
                    <span className="ins-subrecipe-metrics">
                      <span className="ins-submetric">
                        <HeartIcon size={12} />
                        {r.favorites}
                      </span>
                      <span className="ins-submetric">
                        <FlameIcon size={12} />
                        {r.cooks}
                      </span>
                    </span>
                    <span className="ins-subrecipe-go">
                      <ArrowRightIcon size={13} />
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** The dashboard body: window / sort / expanded-source are in-surface component state (they
 *  don't navigate); every window's aggregates arrived precomputed in the one payload, so a
 *  toggle re-renders from data already on the page — no refetch. */
const InsightsView = ({ payload }: { payload: InsightsData }) => {
  const navigate = useNavigate();
  const [win, setWin] = React.useState<WindowKey>("all");
  const [sort, setSort] = React.useState<SortKey>("cooks");
  const [openSource, setOpenSource] = React.useState<string | null>(null);

  const view = payload.perWindow[win];
  const winLabel = payload.windows.find((w) => w.key === win)?.label ?? "All time";
  const topRecipe = rankRows(view.recipes, sort)[0];
  const topSource = rankRows(view.sources, sort)[0];
  const cards: { icon: React.ReactNode; label: string; value: React.ReactNode; small?: boolean }[] = [
    { icon: <FlameIcon size={15} />, label: "Cook events", value: view.totals.cooks },
    { icon: <HeartIcon size={15} />, label: "Favorites", value: view.totals.favorites },
    { icon: <TrophyIcon size={15} />, label: "Top recipe", value: topRecipe ? topRecipe.title : "—", small: true },
    { icon: <TrendingUpIcon size={15} />, label: "Top source", value: topSource ? topSource.name : "—", small: true },
  ];

  return (
    <div className="insights">
      <div className="area-head status-head">
        <div className="data-nav ins-window">
          {payload.windows.map((w) => (
            <button
              key={w.key}
              type="button"
              className={"pill" + (win === w.key ? " active" : "")}
              onClick={() => setWin(w.key as WindowKey)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="muted small">Group activity · {winLabel.toLowerCase()}</span>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.label} className="stat-card">
            <div className="stat-top">
              <span className="stat-ico">{c.icon}</span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className={"stat-value" + (c.small ? " stat-value-sm" : "")}>{c.value}</div>
          </div>
        ))}
      </div>

      <p className="group-label">Cooking activity</p>
      <Heatmap heatmap={payload.heatmap} windowStart={payload.windowStart[win]} totals={view.totals} win={win} />

      <div className="ins-sortbar ins-gap">
        <span className="ins-sort-label muted small">Rank by</span>
        <div className="data-nav ins-sort">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={"pill" + (sort === s.key ? " active" : "")}
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="group-label">Most popular recipes</p>
      <RecipeBoard recipes={view.recipes} sort={sort} />

      <p className="group-label ins-gap">Top sources</p>
      <SourceBoard
        sources={view.sources}
        sort={sort}
        openSource={openSource}
        onToggleSource={(key) => setOpenSource(openSource === key ? null : key)}
        onFeedLink={() => navigate({ to: "/config" })}
      />
    </div>
  );
};

export function InsightsScreen(): React.ReactElement {
  const q = useQuery(insightsQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading insights…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <InsightsView payload={q.data} />;
    default:
      return assertNever(q);
  }
}

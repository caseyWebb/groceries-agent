// The Members › member-detail screen (operator-admin SPA), ported from the SSR
// pages/member-detail.tsx: header with @username + owner/status/kroger badges + activity
// stats, six section pills (client-side Links to /members/$id/$section), and per-section
// renderers over the ONE memberDetail payload (memberQuery). A pending member arrives as
// `detail: null` — the not-yet-connected empty state, no section pills, no detail read.
// Recipe titles come from the payload's `titles` Record (the SSR page's Map, JSON-flattened).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { memberQuery, type MemberData } from "../lib/queries";
import { apiErrorOf } from "../lib/api";
import { assertNever } from "../lib/assert";
import { relAge } from "../lib/format";
import { Badge, Card, ErrorBanner, PrettyKV, DataTable } from "../components/kit";
import { LinkIcon, ChevronLeftIcon } from "../components/icons";

type MemberRow = MemberData["row"];
type MemberDetailData = NonNullable<MemberData["detail"]>;
type Titles = Record<string, string>;

export const SECTIONS = ["Profile", "Pantry", "Meal plan", "Grocery", "Cooking log", "Notes"] as const;
export type Section = (typeof SECTIONS)[number];

/** The URL segment for each pill (lowercase, hyphenated — `meal-plan`, `cooking-log`). */
export function sectionSlug(s: Section): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}

/** The reverse of `sectionSlug`, defaulting to "Profile" for an unknown/absent segment. */
export function sectionOfSlug(slug: string | undefined): Section {
  const found = SECTIONS.find((s) => sectionSlug(s) === slug);
  return found ?? "Profile";
}

const PWD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PMO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A `YYYY-MM-DD` planned-for date as "Wed · Jun 17" (local calendar date, no timezone shift). */
export function fmtPlanned(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `${PWD[date.getDay()]} · ${PMO[(m ?? 1) - 1]} ${d}`;
}

const Empty = ({ children }: { children?: React.ReactNode }) => (
  <p className="muted" style={{ marginTop: 0 }}>
    {children}
  </p>
);

const RecipeLink = ({ slug, title, small }: { slug: string; title: string | null; small?: boolean }) => (
  <>
    <Link className={small ? "md-recipe-link sm" : "md-recipe-link"} to="/data/recipes/$slug" params={{ slug }}>
      {title ?? slug}
    </Link>
    {!small ? <span className="rslug">{slug}</span> : null}
  </>
);

const ProfileSection = ({ profile }: { profile: MemberDetailData["profile"] }) => (
  <Card>
    <PrettyKV obj={profile as unknown as Record<string, unknown>} />
  </Card>
);

const PantrySection = ({ pantry }: { pantry: MemberDetailData["pantry"] }) =>
  pantry.length === 0 ? (
    <Empty>Pantry is empty.</Empty>
  ) : (
    <DataTable
      columns={[
        "name",
        { key: "quantity", label: "Qty", align: "right" },
        { key: "category", label: "Category" },
        { key: "prepared_from", label: "Prepared from" },
        { key: "last_verified_at", label: "Last verified", align: "right" },
      ]}
      rows={pantry.map((p) => ({
        name: String(p.name ?? ""),
        quantity: String(p.quantity ?? ""),
        category: p.category ? <span className="rfacet">{String(p.category)}</span> : <span className="pv-null">—</span>,
        prepared_from: p.prepared_from ? <span className="md-prep">{String(p.prepared_from)}</span> : <span className="pv-null">—</span>,
        last_verified_at: <span className="muted small">{p.last_verified_at ? String(p.last_verified_at) : "—"}</span>,
      }))}
    />
  );

const MealPlanSection = ({ mealPlan, titles }: { mealPlan: MemberDetailData["meal_plan"]; titles: Titles }) =>
  mealPlan.length === 0 ? (
    <Empty>No meals planned.</Empty>
  ) : (
    <div className="md-plan">
      {mealPlan.map((p, i) => (
        <div key={i} className="md-plan-row">
          <span className="md-plan-day">
            {p.planned_for ? fmtPlanned(p.planned_for) : <span className="muted">Unscheduled</span>}
          </span>
          <span className="md-plan-recipe">
            <RecipeLink slug={p.recipe} title={titles[p.recipe] ?? null} />
          </span>
          {p.sides && p.sides.length > 0 ? <span className="md-plan-sides">+ {p.sides.join(", ")}</span> : null}
        </div>
      ))}
    </div>
  );

const GrocerySection = ({ grocery }: { grocery: MemberDetailData["grocery_list"] }) =>
  grocery.length === 0 ? (
    <Empty>Grocery list is empty.</Empty>
  ) : (
    <div className="md-grocery-list">
      {grocery.map((g, i) => (
        <div key={i} className="md-gitem">
          <span
            className={g.status === "in_cart" ? "md-gstatus in-cart" : "md-gstatus"}
            title={g.status === "in_cart" ? "in cart" : "active"}
          />
          <div className="md-gmain">
            <div className="md-gtop">
              <span className="md-gname">{g.name}</span>
              <span className="md-gqty muted small">{g.quantity}</span>
              {g.status === "in_cart" ? <span className="md-incart">in cart</span> : null}
            </div>
            <div className="md-gsub">
              <span className="rfacet md-gsrc">{g.source.replace("_", "-")}</span>
              {g.for_recipes.length > 0 ? (
                <span className="md-gfor muted small">
                  for{" "}
                  {g.for_recipes.map((s, j) => (
                    <React.Fragment key={s}>
                      {j > 0 ? ", " : ""}
                      <Link className="md-recipe-link sm" to="/data/recipes/$slug" params={{ slug: s }}>
                        {s}
                      </Link>
                    </React.Fragment>
                  ))}
                </span>
              ) : null}
              {g.note ? <span className="md-gnote muted small">· {g.note}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

const CookingLogSection = ({ cookingLog, titles }: { cookingLog: MemberDetailData["cooking_log"]; titles: Titles }) =>
  cookingLog.length === 0 ? (
    <Empty>No cooking history yet.</Empty>
  ) : (
    <DataTable
      columns={[
        "date",
        "dish",
        { key: "protein", label: "Protein" },
        { key: "cuisine", label: "Cuisine" },
        { key: "type", label: "Type", align: "right" },
      ]}
      rows={cookingLog.map((c) => {
        const recipe = typeof c.recipe === "string" ? c.recipe : null;
        const name = typeof c.name === "string" ? c.name : null;
        const type = typeof c.type === "string" ? c.type : "ad_hoc";
        return {
          date: <span className="muted small">{String(c.date ?? "")}</span>,
          dish: recipe ? (
            <span className="md-log-dish">
              <RecipeLink slug={recipe} title={titles[recipe] ?? null} small />
            </span>
          ) : (
            <span className="md-log-title">{name ?? "—"}</span>
          ),
          protein: c.protein ? <span className="rfacet">{String(c.protein)}</span> : <span className="pv-null">—</span>,
          cuisine: c.cuisine ? <span className="rfacet">{String(c.cuisine)}</span> : <span className="pv-null">—</span>,
          type: <span className={`md-type md-type-${type}`}>{type}</span>,
        };
      })}
    />
  );

const NotesSection = ({ id, notes }: { id: string; notes: MemberDetailData["recipe_notes"] }) =>
  notes.length === 0 ? (
    <Empty>@{id} hasn't written any recipe notes.</Empty>
  ) : (
    <div className="rd-notes">
      {notes.map((n, i) => {
        const tags: string[] = Array.isArray(n.tags) ? (n.tags as string[]) : [];
        return (
          <div key={i} className="rd-note">
            <div className="rd-note-head">
              <span className="md-note-recipe">{String(n.recipe ?? "")}</span>
              {n.private ? <Badge variant="outline">private</Badge> : null}
              {tags.map((t) => (
                <span key={t} className="rfacet">
                  {t}
                </span>
              ))}
              <span className="rd-note-time muted small">{String(n.created_at ?? "")}</span>
            </div>
            <div className="rd-note-body">{String(n.body ?? "")}</div>
          </div>
        );
      })}
    </div>
  );

const SectionBody = ({ section, detail, titles }: { section: Section; detail: MemberDetailData; titles: Titles }) => {
  switch (section) {
    case "Profile":
      return <ProfileSection profile={detail.profile} />;
    case "Pantry":
      return <PantrySection pantry={detail.pantry} />;
    case "Meal plan":
      return <MealPlanSection mealPlan={detail.meal_plan} titles={titles} />;
    case "Grocery":
      return <GrocerySection grocery={detail.grocery_list} />;
    case "Cooking log":
      return <CookingLogSection cookingLog={detail.cooking_log} titles={titles} />;
    case "Notes":
      return <NotesSection id={detail.id} notes={detail.recipe_notes} />;
    default:
      return assertNever(section);
  }
};

const Header = ({ row, now }: { row: MemberRow; now: number }) => (
  <div className="md-head">
    <div className="md-id">
      <span className="md-user">@{row.id}</span>
      {row.owner ? <Badge variant="secondary">owner</Badge> : null}
      {row.status === "active" ? <Badge variant="secondary">active</Badge> : <Badge variant="outline">pending</Badge>}
      {row.kroger === "linked" ? (
        <Badge variant="secondary">
          <LinkIcon size={11} /> kroger
        </Badge>
      ) : null}
    </div>
    {row.status === "active" ? (
      <div className="md-stats muted small">
        {row.cooked} recipes cooked · {row.favorites} favorites
        {row.joined != null ? ` · joined ${relAge(row.joined, now)}` : null}
      </div>
    ) : null}
  </div>
);

/** Both variants (pending and active) render the roster back-link (the area landmark). */
const BackLink = () => (
  <p>
    <Link to="/members">
      <ChevronLeftIcon size={15} /> All members
    </Link>
  </p>
);

function MemberDetailView({ payload, section }: { payload: MemberData; section: Section }) {
  const [now] = React.useState(() => Date.now());
  // A pending (not-yet-connected) member: just the header + an explanatory empty state — no
  // sub-nav (the read carried no detail; there is nothing to show yet).
  if (payload.detail === null) {
    return (
      <div>
        <BackLink />
        <Header row={payload.row} now={now} />
        <Empty>@{payload.row.id} hasn't connected their Claude.ai yet — no profile or activity to show.</Empty>
      </div>
    );
  }
  return (
    <div>
      <BackLink />
      <Header row={payload.row} now={now} />
      <div className="data-nav">
        {SECTIONS.map((s) => (
          <Link
            key={s}
            to="/members/$id/$section"
            params={{ id: payload.row.id, section: sectionSlug(s) }}
            className={s === section ? "pill active" : "pill"}
          >
            {s}
          </Link>
        ))}
      </div>
      <SectionBody section={section} detail={payload.detail} titles={payload.titles} />
    </div>
  );
}

export function MemberDetailScreen({ id, section }: { id: string; section: Section }): React.ReactElement {
  const q = useQuery(memberQuery(id));
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading member…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <MemberDetailView payload={q.data} section={section} />;
    default:
      return assertNever(q);
  }
}

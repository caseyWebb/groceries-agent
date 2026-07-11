// Pantry (member-app-core / page 06): the needs-verification section (perishable
// categories + the 7-day staleness threshold, CLIENT-derived from served fields exactly
// like the mock), a multi-item add grid whose category/location autofill is UX-only (the
// server-side D17 funnel is authoritative — a blank category commits as "auto"), a
// group-by Category|Location toggle, in-row qty edit (pantry `add` upsert), verify, and
// disposition-based removal: every regular-row removal is a Used (idempotent delete) or a
// Mark-as-waste event (one canonical `WASTE_REASONS` reason, a client-minted `event_id`,
// value NEVER asked — story 03 §2 / D15 / D17). Renders comfortably at ~100+ rows.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PANTRY_CATEGORIES, PANTRY_LOCATIONS, WASTE_REASONS } from "@yamp/contract";
import {
  Button,
  EmptyState,
  GroupHeading,
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconTrash,
  IconX,
  PageHead,
} from "@yamp/ui";
import { mintRowId, usePantry, type PantryRow } from "../lib/data";
import { usePantryOps, usePantryVerify, type PantryOp } from "../lib/mutations";
import { PERISHABLE, STALE_DAYS, daysSince, localToday, relAge } from "../lib/format";

export const Route = createFileRoute("/_app/pantry")({
  component: PantryPage,
});

// --- controlled vocabulary display maps (store the slug, show Title Case) -------------

/** Location slug → Title-Case label (decision 3). The reverse map keys on the lowercased
 *  label so a datalist pick round-trips back to the slug the server validates. */
const LOCATION_LABEL: Record<string, string> = {
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
  spice_rack: "Spice rack",
  counter: "Counter",
  cabinet: "Cabinet",
};
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  PANTRY_CATEGORIES.map((c) => [c, c[0].toUpperCase() + c.slice(1)]),
);
const LABEL_TO_LOCATION = new Map(PANTRY_LOCATIONS.map((s) => [LOCATION_LABEL[s].toLowerCase(), s]));
const LABEL_TO_CATEGORY = new Map(PANTRY_CATEGORIES.map((c) => [CATEGORY_LABEL[c].toLowerCase(), c]));

/** Friendly waste-reason labels over ALL 10 canonical slugs (decision 1) — the enum, not
 *  the mock's six, is what band-4 avoidability consumes. */
const WASTE_REASON_LABEL: Record<string, string> = {
  spoiled: "Spoiled",
  moldy: "Moldy",
  over_ripe: "Overripe",
  expired: "Past expiry",
  freezer_burned: "Freezer-burned",
  stale: "Stale",
  forgot: "Forgot about it",
  bought_too_much: "Bought too much",
  never_opened: "Never opened",
  other: "Other",
};

/** A typed field value (a Title-Case label OR a raw slug) → the stored location slug; the
 *  raw text falls through when it matches neither, letting the server validate/convert. */
function toLocationSlug(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const lo = t.toLowerCase();
  if (LABEL_TO_LOCATION.has(lo)) return LABEL_TO_LOCATION.get(lo);
  if ((PANTRY_LOCATIONS as readonly string[]).includes(lo)) return lo;
  return t;
}

/** A typed category field → its slug; anything off-vocab passes lowercased and the server
 *  drops it to NULL (the classifier fills it) — never a hard reject. */
function toCategorySlug(input: string): string | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const lo = t.toLowerCase();
  if (LABEL_TO_CATEGORY.has(lo)) return LABEL_TO_CATEGORY.get(lo);
  return lo;
}

// --- non-authoritative client recognition (UX-only, decision 2) -----------------------
// This never reaches the server as authority: it only pre-fills a draft row's category and
// location for a recognized name, and it must NEVER clobber a value the member has typed.
// The server's D17 ingredient-identity funnel is the sole authority — a blank category
// commits as "auto" and the funnel/cron classifies it.
const RECOGNIZE: Record<string, { category?: string; location?: string }> = {
  butter: { category: "dairy", location: "fridge" },
  milk: { category: "dairy", location: "fridge" },
  eggs: { category: "dairy", location: "fridge" },
  yogurt: { category: "dairy", location: "fridge" },
  cheese: { category: "dairy", location: "fridge" },
  parmesan: { category: "dairy", location: "fridge" },
  spinach: { category: "produce", location: "fridge" },
  lettuce: { category: "produce", location: "fridge" },
  carrot: { category: "produce", location: "fridge" },
  tomato: { category: "produce", location: "counter" },
  onion: { category: "produce", location: "pantry" },
  garlic: { category: "produce", location: "pantry" },
  potato: { category: "produce", location: "pantry" },
  rice: { category: "grains", location: "pantry" },
  pasta: { category: "grains", location: "pantry" },
  flour: { category: "baking", location: "pantry" },
  sugar: { category: "baking", location: "pantry" },
  "olive oil": { category: "oils", location: "pantry" },
  chicken: { category: "meat", location: "fridge" },
  beef: { category: "meat", location: "fridge" },
  salmon: { category: "seafood", location: "fridge" },
  shrimp: { category: "seafood", location: "freezer" },
  cumin: { category: "spices", location: "spice_rack" },
  cinnamon: { category: "spices", location: "spice_rack" },
  paprika: { category: "spices", location: "spice_rack" },
};

function recognize(name: string): { category?: string; location?: string } {
  const n = name.trim().toLowerCase();
  if (!n) return {};
  if (RECOGNIZE[n]) return RECOGNIZE[n];
  for (const key of Object.keys(RECOGNIZE)) {
    if (n.includes(key)) return RECOGNIZE[key];
  }
  return {};
}

// --- helpers --------------------------------------------------------------------------

function isStale(p: PantryRow): boolean {
  return (
    PERISHABLE.has(p.category ?? "") &&
    typeof p.last_verified_at === "string" &&
    daysSince(p.last_verified_at) >= STALE_DAYS
  );
}

function byName(a: PantryRow, b: PantryRow): number {
  return a.name.localeCompare(b.name);
}

type GroupBy = "category" | "location";

interface Group {
  key: string;
  label: string;
  items: PantryRow[];
}

/** Group the non-stale rows for display: Category (alphabetical) or Location (the fixed
 *  vocabulary order, decision 3). Rows missing the dimension fall into a trailing group. */
function groupRows(rows: PantryRow[], mode: GroupBy): Group[] {
  const map = new Map<string, PantryRow[]>();
  const keyOf = (p: PantryRow) =>
    mode === "location"
      ? p.location && (PANTRY_LOCATIONS as readonly string[]).includes(p.location)
        ? p.location
        : "__none"
      : p.category
        ? p.category.toLowerCase()
        : "__uncat";
  for (const p of rows) {
    const k = keyOf(p);
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  const labelOf = (k: string) =>
    mode === "location"
      ? k === "__none"
        ? "Unsorted"
        : (LOCATION_LABEL[k] ?? k)
      : k === "__uncat"
        ? "Uncategorized"
        : (CATEGORY_LABEL[k] ?? k);
  const order =
    mode === "location"
      ? [...PANTRY_LOCATIONS, "__none"].filter((k) => map.has(k))
      : [...map.keys()].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  return order.map((k) => ({ key: k, label: labelOf(k), items: (map.get(k) ?? []).slice().sort(byName) }));
}

// --- draft rows (the multi-add grid) --------------------------------------------------

interface DraftRow {
  id: string;
  name: string;
  quantity: string;
  category: string;
  location: string;
  catTouched: boolean;
  locTouched: boolean;
}

let draftSeq = 0;
function freshDraft(): DraftRow {
  return { id: `d${draftSeq++}`, name: "", quantity: "", category: "", location: "", catTouched: false, locTouched: false };
}

// --- page -----------------------------------------------------------------------------

function PantryPage() {
  const pantry = usePantry();
  const items = pantry.data?.items ?? [];
  const [groupBy, setGroupBy] = React.useState<GroupBy>("category");
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const [wasteFor, setWasteFor] = React.useState<PantryRow | null>(null);

  const stale = items
    .filter(isStale)
    .sort((a, b) => daysSince(b.last_verified_at ?? "") - daysSince(a.last_verified_at ?? ""));
  const staleNames = new Set(stale.map((p) => p.name));
  const rest = items.filter((p) => !staleNames.has(p.name));
  const groups = groupRows(rest, groupBy);

  return (
    <div data-testid="pantry-page">
      <PageHead
        title="Pantry"
        sub={`${items.length} item${items.length === 1 ? "" : "s"} on hand${stale.length ? ` · ${stale.length} to verify` : ""}.`}
      />

      {stale.length ? (
        <section className="verify-section" data-testid="verify-section">
          <header className="verify-head">
            <h2>
              <IconAlert /> Needs verification
            </h2>
            <p>Perishables you haven't checked in a while — they may be spoiled or used up. Verify to keep, or remove.</p>
          </header>
          {stale.map((p) => (
            <StaleItem key={p.name} item={p} />
          ))}
        </section>
      ) : null}

      <AddPanel items={items} />

      {pantry.data && items.length === 0 ? (
        <EmptyState title="Pantry is empty" sub="Add what you keep on hand so the agent can plan around it." />
      ) : (
        <>
          <div className="pantry-groupby">
            <span className="pantry-groupby-label">Group by</span>
            <div className="seg" role="radiogroup" aria-label="Group by">
              {(["category", "location"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={groupBy === m}
                  aria-pressed={groupBy === m}
                  data-testid={`pantry-groupby-${m}`}
                  onClick={() => setGroupBy(m)}
                >
                  {m === "category" ? "Category" : "Location"}
                </button>
              ))}
            </div>
          </div>
          {groups.map((g) => (
            <div className="pantry-group" key={g.key} data-testid="pantry-group" data-group={g.key}>
              <GroupHeading>{g.label}</GroupHeading>
              {g.items.map((p) => (
                <PantryItem
                  key={p.name}
                  item={p}
                  menuOpen={openMenu === p.name}
                  onToggleMenu={() => setOpenMenu((cur) => (cur === p.name ? null : p.name))}
                  onCloseMenu={() => setOpenMenu(null)}
                  onWaste={() => {
                    setOpenMenu(null);
                    setWasteFor(p);
                  }}
                />
              ))}
            </div>
          ))}
        </>
      )}

      {wasteFor ? <WasteModal item={wasteFor} onClose={() => setWasteFor(null)} /> : null}
    </div>
  );
}

// --- the needs-verification row (keeps the bare trash = verification cleanup) ----------

function StaleItem({ item }: { item: PantryRow }) {
  const pantryOps = usePantryOps();
  const pantryVerify = usePantryVerify();
  const [qty, setQty] = React.useState(item.quantity ?? "");
  React.useEffect(() => setQty(item.quantity ?? ""), [item.quantity]);

  function commitQty() {
    if ((item.quantity ?? "") === qty) return;
    pantryOps.mutate({ operations: [{ op: "add", item: { name: item.name, quantity: qty } }] });
  }

  return (
    <div className="pantry-item stale" data-testid="pantry-item" data-name={item.name}>
      <div className="pantry-main">
        <span className="pantry-name">{item.name}</span>
        {item.prepared_from ? <span className="pantry-prep">from {item.prepared_from}</span> : null}
        <span className="pantry-stale">{daysSince(item.last_verified_at ?? "")}d unchecked</span>
      </div>
      <input
        className="input pantry-qty"
        value={qty}
        aria-label="Quantity"
        data-testid="pantry-qty"
        onChange={(e) => setQty(e.target.value)}
        onBlur={commitQty}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <Button size="sm" variant="outline" data-testid="pantry-verify" onClick={() => pantryVerify.mutate({ items: [item.name] })}>
        <IconCheck /> Verify
      </Button>
      {/* Bare trash here is verification cleanup (never used/spoiled), so it stays a plain remove. */}
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        data-testid="pantry-remove"
        onClick={() => pantryOps.mutate({ operations: [{ op: "remove", name: item.name }] })}
      >
        <IconTrash />
      </button>
    </div>
  );
}

// --- a regular pantry row (no bare trash: Used / Mark-as-waste dispositions) -----------

function PantryItem({
  item,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onWaste,
}: {
  item: PantryRow;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onWaste: () => void;
}) {
  const pantryOps = usePantryOps();
  const pantryVerify = usePantryVerify();
  const [qty, setQty] = React.useState(item.quantity ?? "");
  React.useEffect(() => setQty(item.quantity ?? ""), [item.quantity]);
  const actionsRef = React.useRef<HTMLDivElement>(null);

  // Close the split-button menu on any pointer outside it (idiomatic dismiss).
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) onCloseMenu();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, onCloseMenu]);

  // Qty edit is the pantry `add` upsert (canonical-id keyed; the merge preserves
  // location/added_at and only restamps last_verified_at).
  function commitQty() {
    if ((item.quantity ?? "") === qty) return;
    pantryOps.mutate({ operations: [{ op: "add", item: { name: item.name, quantity: qty } }] });
  }

  const verified = item.last_verified_at ?? null;
  const verifiedToday = verified != null && daysSince(verified) <= 0;

  return (
    <div className="pantry-item" data-testid="pantry-item" data-name={item.name}>
      <div className="pantry-main">
        <span className="pantry-name">{item.name}</span>
        {item.prepared_from ? <span className="pantry-prep">from {item.prepared_from}</span> : null}
        <span className="pantry-verified-wrap">
          {verified ? <span className="pantry-verified">verified {verifiedToday ? "today" : relAge(verified)}</span> : null}
          {/* The re-verify icon hides once verified today. */}
          {!verifiedToday ? (
            <button
              type="button"
              className="icon-btn pantry-reverify"
              title="Re-verify — mark checked now"
              data-testid="pantry-verify"
              onClick={() => pantryVerify.mutate({ items: [item.name] })}
            >
              <IconCheck />
            </button>
          ) : null}
        </span>
      </div>
      <input
        className="input pantry-qty"
        value={qty}
        aria-label="Quantity"
        data-testid="pantry-qty"
        onChange={(e) => setQty(e.target.value)}
        onBlur={commitQty}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <div className="pantry-actions" ref={actionsRef}>
        <Button
          size="sm"
          className="pantry-used"
          title="Mark as used"
          data-testid="pantry-used"
          onClick={() => pantryOps.mutate({ operations: [{ op: "dispose", name: item.name, disposition: "used" }] })}
        >
          Used
        </Button>
        <Button
          size="sm"
          className="pantry-menu-toggle"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="pantry-menu-toggle"
          onClick={onToggleMenu}
        >
          <IconChevronDown />
        </Button>
        {menuOpen ? (
          <div className="pantry-menu" role="menu">
            <button type="button" className="pantry-menu-item" role="menuitem" data-testid="pantry-waste" onClick={onWaste}>
              <IconTrash /> Mark as waste
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- the multi-item add grid ----------------------------------------------------------

function AddPanel({ items }: { items: PantryRow[] }) {
  const pantryOps = usePantryOps();
  const [rows, setRows] = React.useState<DraftRow[]>(() => [freshDraft()]);

  const named = rows.filter((r) => r.name.trim());
  const addCount = named.length;

  /** Apply a field edit and keep exactly one trailing empty row (a fresh row appends once
   *  the last row has a name — "Tab through to add several at once"). */
  function edit(id: string, patch: Partial<DraftRow>): void {
    setRows((cur) => {
      let next = cur.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      if (last.name.trim()) next = [...next, freshDraft()];
      return next;
    });
  }

  function onName(id: string, value: string): void {
    setRows((cur) => {
      let next = cur.map((r) => {
        if (r.id !== id) return r;
        const rec = recognize(value);
        // Recognition is UX-only and NEVER clobbers a typed override.
        const category = !r.catTouched && rec.category ? CATEGORY_LABEL[rec.category] : r.category;
        const location = !r.locTouched && rec.location ? LOCATION_LABEL[rec.location] : r.location;
        return { ...r, name: value, category, location };
      });
      const last = next[next.length - 1];
      if (last.name.trim()) next = [...next, freshDraft()];
      return next;
    });
  }

  function removeRow(id: string): void {
    setRows((cur) => {
      const next = cur.filter((r) => r.id !== id);
      return next.length ? next : [freshDraft()];
    });
  }

  function clear(): void {
    setRows([freshDraft()]);
  }

  function commit(): void {
    const ops: PantryOp[] = named.map((r) => {
      const category = toCategorySlug(r.category);
      const location = toLocationSlug(r.location);
      const item: Record<string, unknown> = { name: r.name.trim() };
      if (r.quantity.trim()) item.quantity = r.quantity.trim();
      if (category) item.category = category; // blank → "auto": the funnel/cron classifies it
      if (location) item.location = location;
      return { op: "add", item };
    });
    if (ops.length === 0) return;
    // One batch of `add` ops; added rows come back verified-now (the upsert stamps today).
    pantryOps.mutate({ operations: ops });
    clear();
  }

  return (
    <div className="pantry-add-panel" data-testid="pantry-add">
      <div className="pantry-add-grid pantry-add-head">
        <span>Item</span>
        <span>Qty</span>
        <span>Category</span>
        <span>Location</span>
        <span />
      </div>
      {rows.map((r) => (
        <div className="pantry-add-grid" key={r.id} data-testid="pantry-draft-row">
          <input
            className="input"
            list="pantry-items"
            placeholder="Add an item…"
            autoComplete="off"
            aria-label="Item"
            value={r.name}
            onChange={(e) => onName(r.id, e.target.value)}
          />
          <input
            className="input"
            placeholder="1"
            autoComplete="off"
            aria-label="Quantity"
            value={r.quantity}
            onChange={(e) => edit(r.id, { quantity: e.target.value })}
          />
          <input
            className="input"
            list="pantry-cats"
            placeholder="auto"
            autoComplete="off"
            aria-label="Category"
            value={r.category}
            onChange={(e) => edit(r.id, { category: e.target.value, catTouched: true })}
          />
          <input
            className="input"
            list="pantry-locs"
            placeholder="—"
            autoComplete="off"
            aria-label="Location"
            value={r.location}
            onChange={(e) => edit(r.id, { location: e.target.value, locTouched: true })}
          />
          <button
            type="button"
            className="icon-btn"
            title="Remove row"
            aria-label="Remove row"
            data-testid="pantry-draft-remove"
            disabled={rows.length <= 1}
            onClick={() => removeRow(r.id)}
          >
            <IconX />
          </button>
        </div>
      ))}
      <datalist id="pantry-items">
        {items.map((p) => (
          <option key={p.name} value={p.name} />
        ))}
      </datalist>
      <datalist id="pantry-cats">
        {PANTRY_CATEGORIES.map((c) => (
          <option key={c} value={CATEGORY_LABEL[c]} />
        ))}
      </datalist>
      <datalist id="pantry-locs">
        {PANTRY_LOCATIONS.map((s) => (
          <option key={s} value={LOCATION_LABEL[s]} />
        ))}
      </datalist>
      <div className="pantry-add-foot">
        <span className="pantry-add-hint">
          Tab through to add several at once. Category and location fill in when we recognize the item — leave blank if unsure.
        </span>
        <div className="pantry-add-actions">
          <Button size="sm" variant="outline" data-testid="pantry-add-clear" onClick={clear}>
            Clear
          </Button>
          <Button size="sm" disabled={addCount === 0} data-testid="pantry-add-commit" onClick={commit}>
            Add {addCount} item{addCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- the waste modal (single-tap reason; value NEVER asked) ---------------------------

function WasteModal({ item, onClose }: { item: PantryRow; onClose: () => void }) {
  const pantryOps = usePantryOps();

  function toss(reason: string): void {
    // Mint the idempotency key and stamp the day at tap time (D15): a replayed waste
    // disposition converges to exactly one event on the day it happened.
    pantryOps.mutate({
      operations: [
        {
          op: "dispose",
          name: item.name,
          disposition: "waste",
          reason,
          event_id: mintRowId(),
          occurred_at: localToday(),
        },
      ],
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" data-testid="waste-modal" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Mark as waste" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">Toss “{item.name}”</h2>
            <p className="modal-sub">Why is it going in the bin? This feeds your Waste analyzer so it can spot patterns.</p>
          </div>
          <button type="button" className="modal-close" aria-label="Close" data-testid="waste-close" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <ul className="store-results">
          {WASTE_REASONS.map((reason) => (
            <li key={reason}>
              <button type="button" className="store-result" data-testid="waste-reason" data-reason={reason} onClick={() => toss(reason)}>
                <span className="store-result-main">
                  <span className="store-result-name">{WASTE_REASON_LABEL[reason]}</span>
                </span>
                <IconChevronRight />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Grocery (member-app-core 7.7 + member-app-grocery 5.x): the page renders the DERIVED
// to-buy view (GET /api/grocery/to-buy) — explicit and virtual (plan-derived) lines in
// one list with `origin` attribution, the "Already in your pantry" coverage section
// with verify / buy-fresh nudges, the `underived` quiet notice — plus the P1 stored-row
// interactions (explicit in-cart set, remove on explicit rows, bottom add-row, Clear
// purchased) and the order flow: a preview → disposition → commit panel over
// POST /api/grocery/order (Kroger-gated; ONLINE-ONLY — plain fetches, nothing queued or
// replayed: the cart write is not idempotent), and the in-cart group's user-asserted
// "Mark order placed" advance (PATCH status: ordered; the W3 guard enforces).
// No store picker / aisles / substitutions — later phases (P4).
import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  Button,
  EmptyState,
  FacetChip,
  GroupHeading,
  IconAlert,
  IconCart,
  IconCheck,
  IconPlus,
  IconTrash,
  IconX,
  PageHead,
  toast,
} from "@grocery-agent/ui";
import { api, apiError } from "../lib/api";
import { PERISHABLE, STALE_DAYS, daysSince } from "../lib/format";
import {
  useGrocery,
  useProfile,
  useToBuy,
  type GroceryRow,
  type OrderOutcome,
  type OrderRequest,
  type PantryCovered,
  type ToBuyLine,
} from "../lib/data";

export const Route = createFileRoute("/_app/grocery")({
  component: GroceryPage,
});

const KIND_GROUPS: { kind: ToBuyLine["kind"]; label: string }[] = [
  { kind: "grocery", label: "Groceries" },
  { kind: "household", label: "Home goods" },
  { kind: "other", label: "Other" },
];

/** Refresh both grocery reads (the stored rows and the derived view share the prefix). */
async function refreshGrocery(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: ["grocery"] });
}

/** EXPLICIT in-cart set (never a toggle — D8), optimistic on the stored-rows cache. */
async function setInCart(qc: QueryClient, name: string, inCart: boolean): Promise<void> {
  qc.setQueryData<{ items: GroceryRow[] }>(["grocery"], (cur) =>
    cur
      ? { items: cur.items.map((i) => (i.name === name ? { ...i, status: inCart ? "in_cart" : "active" } : i)) }
      : cur,
  );
  const args = { param: { name }, json: { status: inCart ? "in_cart" : "active" } };
  const res = await api.api.grocery.items[":name"].$patch(args).catch(() => null);
  if (!res || !res.ok) {
    if (res) toast((await apiError(res)).message);
    else toast("Couldn't update the item — try again");
  }
  await refreshGrocery(qc);
}

async function removeItem(qc: QueryClient, name: string): Promise<void> {
  const res = await api.api.grocery.items[":name"].$delete({ param: { name } }).catch(() => null);
  if (!res?.ok) toast("Couldn't remove the item — try again");
  await refreshGrocery(qc);
}

/**
 * MATERIALIZE a derived (plan-origin) line as an explicit `source:"menu"` row (D6): the
 * standard add upsert under the same canonical key, carrying the derived `for_recipes` —
 * so the stored row and the derived need merge (`origin:"both"` on the next read).
 * Class (b): replay-idempotent.
 */
async function materialize(qc: QueryClient, line: ToBuyLine, edits: { quantity?: string; note?: string } = {}): Promise<boolean> {
  const res = await api.api.grocery.items
    .$post({
      json: {
        name: line.name,
        source: "menu",
        for_recipes: line.for_recipes,
        ...(edits.quantity ? { quantity: edits.quantity } : {}),
        ...(edits.note ? { note: edits.note } : {}),
      },
    })
    .catch(() => null);
  if (!res?.ok) {
    toast("Couldn't pin the item — try again");
    return false;
  }
  await refreshGrocery(qc);
  return true;
}

function GroceryPage() {
  const grocery = useGrocery();
  const toBuy = useToBuy();
  const profile = useProfile();
  const qc = useQueryClient();
  const [orderOpen, setOrderOpen] = React.useState(false);

  const rows = grocery.data?.items ?? [];
  const view = toBuy.data;
  const lines = view?.to_buy ?? [];
  const inCart = rows.filter((g) => g.status === "in_cart");
  // Stored-row state joined onto the view lines (quantity annotation, note).
  const rowByName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));

  // The order affordance renders only for a Kroger primary with a linked account (D7).
  const stores = (profile.data?.preferences?.stores ?? {}) as { primary?: string };
  const krogerPrimary = (stores.primary ?? "kroger").toLowerCase() === "kroger";
  const krogerReady = krogerPrimary && profile.data?.kroger.linked === true;

  async function clearPurchased() {
    // Received is terminal REMOVAL (docs/TOOLS.md): drop each in_cart row.
    for (const g of inCart) {
      await api.api.grocery.items[":name"].$delete({ param: { name: g.name } }).catch(() => null);
    }
    toast("Purchased items cleared");
    await refreshGrocery(qc);
  }

  async function markOrderPlaced() {
    // The user-asserted in_cart → ordered advance, per item (class (b) explicit set);
    // the shared W3 guard enforces the transition and stamps ordered_at.
    let failed = 0;
    for (const g of inCart) {
      const args = { param: { name: g.name }, json: { status: "ordered" } };
      const res = await api.api.grocery.items[":name"].$patch(args).catch(() => null);
      if (!res?.ok) {
        failed++;
        if (res) toast((await apiError(res)).message);
      }
    }
    if (!failed) toast("Order marked placed");
    await refreshGrocery(qc);
  }

  const groups = KIND_GROUPS.map((grp) => ({
    ...grp,
    lines: lines.filter((l) => l.kind === grp.kind),
  })).filter((grp) => grp.lines.length > 0);

  const empty = view && lines.length === 0 && rows.length === 0;

  return (
    <div data-testid="grocery-page">
      <PageHead
        title="Grocery list"
        sub={`${lines.length} to buy${inCart.length ? ` · ${inCart.length} in cart` : ""}.`}
      />
      {krogerReady && lines.length > 0 ? (
        <div className="g-toolbar">
          <Button size="sm" data-testid="order-open" onClick={() => setOrderOpen(true)}>
            <IconCart /> Add all to Kroger cart
          </Button>
        </div>
      ) : null}
      {orderOpen ? <OrderPanel inCartCount={inCart.length} onClose={() => setOrderOpen(false)} /> : null}
      {view?.pantry_covered.length ? <PantryHave covered={view.pantry_covered} /> : null}
      {view?.underived.length ? (
        <p className="g-underived" data-testid="grocery-underived">
          Ingredients for {view.underived.join(", ")} aren't derived yet — their items may be missing from this list.
        </p>
      ) : null}
      {empty ? (
        <>
          <EmptyState title="List is empty" sub="Add items, or plan a meal to pull ingredients in." />
          <AddRow />
        </>
      ) : (
        <>
          {groups.map((grp) => (
            <div className="g-group" key={grp.kind} data-testid={`grocery-group-${grp.kind}`}>
              <GroupHeading>Category: {grp.label}</GroupHeading>
              <ul className="g-list">
                {grp.lines.map((l) => (
                  <ToBuyItem key={l.key} line={l} row={rowByName.get(l.name.toLowerCase())} />
                ))}
              </ul>
            </div>
          ))}
          <AddRow />
          {inCart.length ? (
            <div className="g-cart-group" data-testid="grocery-in-cart">
              <div className="group-h-row">
                <GroupHeading>In cart</GroupHeading>
                <span>
                  <Button variant="outline" size="sm" data-testid="mark-order-placed" onClick={() => void markOrderPlaced()}>
                    Mark order placed
                  </Button>{" "}
                  <Button variant="ghost" size="sm" data-testid="clear-purchased" onClick={() => void clearPurchased()}>
                    Clear purchased
                  </Button>
                </span>
              </div>
              <ul className="g-list dim">
                {inCart.map((g) => (
                  <InCartItem key={g.name} item={g} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One to-buy line: explicit (P1 behaviors) or virtual (plan cue, pin, no remove — D6). */
function ToBuyItem({ line, row }: { line: ToBuyLine; row?: GroceryRow }) {
  const qc = useQueryClient();
  const virtual = line.origin === "plan";

  async function toggleCart() {
    if (virtual) {
      // A virtual line has no row to advance — materialize first (D6), then set in-cart.
      if (await materialize(qc, line)) await setInCart(qc, line.name, true);
      return;
    }
    await setInCart(qc, line.name, true);
  }

  return (
    <li
      className="g-item"
      data-testid="grocery-item"
      data-name={line.name}
      data-origin={line.origin}
    >
      <button
        type="button"
        className="g-check"
        aria-pressed={false}
        title="Mark in cart"
        data-testid="cart-toggle"
        onClick={() => void toggleCart()}
      >
        {null}
      </button>
      <div className="g-main">
        <div className="g-top">
          <span className="g-name">{line.name}</span>
          <span className="g-qty">
            {row ? row.quantity : line.assumed_quantity ? "1 (assumed)" : String(line.quantity)}
          </span>
        </div>
        <div className="g-sub">
          {virtual ? (
            <span className="g-origin" data-testid="origin-plan">
              from your plan
            </span>
          ) : (
            <FacetChip>
              <span className="g-src">{(row?.source ?? "menu").replace("_", "-")}</span>
            </FacetChip>
          )}
          {line.origin === "both" ? (
            <span className="g-origin" data-testid="origin-both">
              pinned · from your plan
            </span>
          ) : null}
          {line.for_recipes.length ? (
            <span className="g-for">
              for{" "}
              {line.for_recipes.map((s, i) => (
                <React.Fragment key={s}>
                  {i > 0 ? ", " : null}
                  <Link to="/recipe/$slug" params={{ slug: s }}>
                    {s}
                  </Link>
                </React.Fragment>
              ))}
            </span>
          ) : null}
          {line.note ? <span className="g-note">· {line.note}</span> : null}
        </div>
      </div>
      {virtual ? (
        <button
          type="button"
          className="icon-btn"
          title="Keep on list (pin)"
          data-testid="grocery-pin"
          onClick={() => void materialize(qc, line)}
        >
          <IconPlus />
        </button>
      ) : (
        <button
          type="button"
          className="icon-btn"
          title="Remove"
          data-testid="grocery-remove"
          onClick={() => void removeItem(qc, line.name)}
        >
          <IconTrash />
        </button>
      )}
    </li>
  );
}

/** An in-cart stored row (the P1 rendering: un-cart toggle, remove). */
function InCartItem({ item }: { item: GroceryRow }) {
  const qc = useQueryClient();
  return (
    <li className="g-item in-cart" data-testid="grocery-item" data-name={item.name}>
      <button
        type="button"
        className="g-check"
        aria-pressed={true}
        title="Move back to list"
        data-testid="cart-toggle"
        onClick={() => void setInCart(qc, item.name, false)}
      >
        <IconCheck />
      </button>
      <div className="g-main">
        <div className="g-top">
          <span className="g-name">{item.name}</span>
          <span className="g-qty">{item.quantity}</span>
        </div>
        <div className="g-sub">
          <FacetChip>
            <span className="g-src">{item.source.replace("_", "-")}</span>
          </FacetChip>
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        data-testid="grocery-remove"
        onClick={() => void removeItem(qc, item.name)}
      >
        <IconTrash />
      </button>
    </li>
  );
}

/** "Already in your pantry" — the view's coverage rows with verify / buy-fresh nudges. */
function PantryHave({ covered }: { covered: PantryCovered[] }) {
  const qc = useQueryClient();

  async function verify(name: string) {
    const res = await api.api.pantry.verify.$post({ json: { items: [name] } }).catch(() => null);
    if (!res?.ok) toast("Couldn't verify — try again");
    else toast(`${name} verified`);
    await qc.invalidateQueries({ queryKey: ["pantry"] });
    await refreshGrocery(qc);
  }

  async function buyFresh(item: PantryCovered) {
    // Materialize onto the list (the pantry still covers it in the view; at order time it
    // returns as a `partial` the member confirms — the include_partials intent).
    const res = await api.api.grocery.items
      .$post({ json: { name: item.name, source: "menu", for_recipes: item.for_recipes } })
      .catch(() => null);
    if (!res?.ok) toast("Couldn't add — try again");
    else toast(`${item.name} added to the list — confirm it at order time (pantry still has some)`);
    await refreshGrocery(qc);
  }

  const rank = (c: PantryCovered) => {
    const perish = PERISHABLE.has(c.on_hand.category ?? "");
    const stale = perish && c.on_hand.last_verified_at != null && daysSince(c.on_hand.last_verified_at) >= STALE_DAYS;
    return stale ? 0 : perish ? 1 : 2;
  };
  const sorted = [...covered].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return (
    <section className="pantry-have" data-testid="pantry-have">
      <header className="ph-head">
        <div>
          <h2>
            <IconCheck /> Already in your pantry
          </h2>
          <p>
            Your planned recipes need these, but you already have them — no need to buy. Give the flagged
            perishables a quick check.
          </p>
        </div>
      </header>
      <ul className="ph-list">
        {sorted.map((c) => {
          const perish = PERISHABLE.has(c.on_hand.category ?? "");
          const days = c.on_hand.last_verified_at != null ? daysSince(c.on_hand.last_verified_at) : null;
          const stale = perish && days != null && days >= STALE_DAYS;
          return (
            <li className={`ph-item${stale ? " stale" : ""}`} key={c.name} data-testid="pantry-have-item" data-name={c.name}>
              <span className="ph-have" aria-hidden="true">
                <IconCheck />
              </span>
              <div className="ph-main">
                <div className="ph-top">
                  <span className="ph-name">{c.name}</span>
                  {c.on_hand.quantity ? <span className="ph-qty">{c.on_hand.quantity} on hand</span> : null}
                </div>
                <div className="ph-sub">
                  {c.for_recipes.length ? <span>needed for {c.for_recipes.join(", ")}</span> : null}
                  {stale ? (
                    <>
                      <span className="ph-sep">·</span>
                      <span className="ph-flag warn" data-testid="ph-stale-flag">
                        <IconAlert /> {days}d unchecked — verify
                      </span>
                    </>
                  ) : perish ? (
                    <>
                      <span className="ph-sep">·</span>
                      <span className="ph-flag">perishable</span>
                    </>
                  ) : null}
                </div>
              </div>
              {stale ? (
                <div className="ph-actions">
                  <Button size="sm" variant="outline" data-testid="ph-verify" onClick={() => void verify(c.name)}>
                    <IconCheck /> Verify
                  </Button>
                  <Button size="sm" variant="ghost" data-testid="ph-buy" onClick={() => void buyFresh(c)}>
                    Buy fresh
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── The order panel (D7/D11): preview → disposition → commit over one endpoint. ──────

type OrderPhase =
  | { at: "loading" }
  | { at: "error"; message: string }
  | { at: "preview"; result: OrderOutcome }
  | { at: "committing"; result: OrderOutcome }
  | { at: "done"; result: OrderOutcome };

function OrderPanel({ inCartCount, onClose }: { inCartCount: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<OrderPhase>({ at: "loading" });
  // Dispositions, keyed by line name (the op resolves them through the canonical funnel).
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [picks, setPicks] = React.useState<Record<string, string>>({});
  const [confirmedPartials, setConfirmedPartials] = React.useState<Set<string>>(new Set());
  const [cartAcknowledged, setCartAcknowledged] = React.useState(false);

  // The order flow is ONLINE-ONLY (D7/D12): plain fetches through the typed client —
  // never a persisted/replayed mutation (the cart write is not idempotent).
  const post = React.useCallback(async (body: OrderRequest): Promise<OrderOutcome> => {
    const res = await api.api.grocery.order.$post({ json: body });
    if (!res.ok) throw await apiError(res);
    return (await res.json()) as OrderOutcome;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    post({ preview: true })
      .then((result) => {
        if (!cancelled) setPhase({ at: "preview", result });
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setPhase({ at: "error", message: e.message || "Preview failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [post]);

  async function commit(preview: OrderOutcome) {
    setPhase({ at: "committing", result: preview });
    try {
      const result = await post({
        exclude: [...excluded],
        quantities,
        overrides: Object.entries(picks).map(([name, sku]) => ({ name, sku })),
        include_partials: [...confirmedPartials],
      });
      setPhase({ at: "done", result });
      // Refetch the truth: lines the cart actually took are now in_cart.
      await refreshGrocery(qc);
    } catch (e) {
      setPhase({ at: "error", message: (e as { message?: string }).message || "Order failed" });
    }
  }

  async function relinkKroger() {
    const res = await api.api.profile["kroger-login-url"].$get().catch(() => null);
    if (!res?.ok) {
      toast("Couldn't mint the Kroger link — try again");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener");
  }

  const staleCart = inCartCount > 0;
  const commitArmed = !staleCart || cartAcknowledged;

  return (
    <section className="order-panel" data-testid="order-panel">
      <header className="order-head">
        <div>
          <h2>
            <IconCart /> Kroger order
          </h2>
          <p>Review what an order would buy right now, sort out the flagged items, then send it to your cart.</p>
        </div>
        <button className="icon-btn" data-testid="order-close" title="Close" onClick={onClose}>
          <IconX />
        </button>
      </header>

      {staleCart ? (
        <div className="order-warn" data-testid="order-stale-warning">
          <IconAlert />
          {inCartCount} item{inCartCount === 1 ? "" : "s"} from a prior order {inCartCount === 1 ? "is" : "are"} still
          marked in-cart and never confirmed placed. The Kroger cart can't be read back — clear it in the Kroger app
          first so this order doesn't double-add.
          <label>
            <input
              type="checkbox"
              data-testid="order-stale-ack"
              checked={cartAcknowledged}
              onChange={(e) => setCartAcknowledged(e.target.checked)}
            />
            I've checked the Kroger cart
          </label>
        </div>
      ) : null}

      {phase.at === "loading" ? <p className="order-empty">Resolving your list against Kroger…</p> : null}
      {phase.at === "error" ? (
        <p className="order-empty" data-testid="order-error">
          {phase.message}
        </p>
      ) : null}

      {phase.at === "preview" || phase.at === "committing" ? (
        <OrderPreview
          result={phase.result}
          busy={phase.at === "committing"}
          excluded={excluded}
          setExcluded={setExcluded}
          quantities={quantities}
          setQuantities={setQuantities}
          picks={picks}
          setPicks={setPicks}
          confirmedPartials={confirmedPartials}
          setConfirmedPartials={setConfirmedPartials}
          commitArmed={commitArmed}
          onCommit={() => void commit(phase.result)}
        />
      ) : null}

      {phase.at === "done" ? <OrderResult result={phase.result} onRelink={() => void relinkKroger()} /> : null}
    </section>
  );
}

function priceLabel(l: { price?: { regular: number; promo: number }; on_sale?: boolean }): string | null {
  if (!l.price) return null;
  const effective = l.on_sale && l.price.promo > 0 ? l.price.promo : l.price.regular;
  return `$${effective.toFixed(2)}${l.on_sale ? " on sale" : ""}`;
}

function OrderPreview(props: {
  result: OrderOutcome;
  busy: boolean;
  excluded: Set<string>;
  setExcluded: (v: Set<string>) => void;
  quantities: Record<string, number>;
  setQuantities: (v: Record<string, number>) => void;
  picks: Record<string, string>;
  setPicks: (v: Record<string, string>) => void;
  confirmedPartials: Set<string>;
  setConfirmedPartials: (v: Set<string>) => void;
  commitArmed: boolean;
  onCommit: () => void;
}) {
  const { result } = props;
  const toggleExclude = (name: string) => {
    const next = new Set(props.excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    props.setExcluded(next);
  };
  const togglePartial = (name: string) => {
    const next = new Set(props.confirmedPartials);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    props.setConfirmedPartials(next);
  };

  return (
    <div data-testid="order-preview">
      {result.underived.length ? (
        <p className="order-empty" data-testid="order-underived">
          Not derived yet (items missing from this order): {result.underived.join(", ")}
        </p>
      ) : null}

      {result.resolved.length ? (
        <ul className="order-list">
          {result.resolved.map((l) => {
            const excluded = props.excluded.has(l.name);
            const price = priceLabel(l);
            return (
              <li className={`order-row${excluded ? " excluded" : ""}`} key={l.name} data-testid="order-line" data-name={l.name}>
                <div className="order-line">
                  <span className="order-name">{l.name}</span>
                  <span className="order-pick">
                    {l.brand}
                    {l.size ? ` · ${l.size}` : ""}
                  </span>
                  {price ? <span className={`order-price${l.on_sale ? " sale" : ""}`}>{price}</span> : null}
                </div>
                <div className="order-actions">
                  {l.assumed_quantity ? (
                    <span className="order-qty" data-testid="order-qty">
                      qty{" "}
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={99}
                        aria-label={`Quantity for ${l.name}`}
                        value={props.quantities[l.name] ?? l.quantity}
                        disabled={excluded || props.busy}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isInteger(n) && n >= 1 && n <= 99) {
                            props.setQuantities({ ...props.quantities, [l.name]: n });
                          }
                        }}
                      />
                    </span>
                  ) : (
                    <span className="order-qty">qty {l.quantity}</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="order-exclude"
                    disabled={props.busy}
                    onClick={() => toggleExclude(l.name)}
                  >
                    {excluded ? "Include" : "Skip"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="order-empty">Nothing to buy — the pantry covers the plan.</p>
      )}

      {result.checkpoint.length ? (
        <>
          <h3 className="order-section-h">Needs a decision</h3>
          <ul className="order-list" data-testid="order-checkpoint">
            {result.checkpoint.map((cp) => (
              <li className="order-row" key={cp.name} data-testid="order-checkpoint-item" data-name={cp.name}>
                <div className="order-line">
                  <span className="order-name">{cp.name}</span>
                  <span className="order-pick">{cp.message}</span>
                </div>
                {cp.kind === "ambiguous" && cp.candidates?.length ? (
                  <ul className="order-cands">
                    {cp.candidates.slice(0, 5).map((cand) => (
                      <li key={cand.sku}>
                        <label>
                          <input
                            type="radio"
                            name={`cand-${cp.name}`}
                            data-testid="order-cand"
                            data-sku={cand.sku}
                            checked={props.picks[cp.name] === cand.sku}
                            disabled={props.busy}
                            onChange={() => props.setPicks({ ...props.picks, [cp.name]: cand.sku })}
                          />
                          {cand.brand}
                          {cand.size ? ` · ${cand.size}` : ""} · ${" "}
                          {(cand.on_sale && cand.price.promo > 0 ? cand.price.promo : cand.price.regular).toFixed(2)}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="order-pick">left out of this order unless you pick a product</span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result.partials.length ? (
        <>
          <h3 className="order-section-h">Pantry says you have these</h3>
          <ul className="order-list" data-testid="order-partials">
            {result.partials.map((p) => (
              <li className="order-row" key={p.name} data-testid="order-partial" data-name={p.name}>
                <div className="order-line">
                  <span className="order-name">{p.name}</span>
                  {p.for_recipes.length ? <span className="order-pick">for {p.for_recipes.join(", ")}</span> : null}
                </div>
                <label className="order-qty">
                  <input
                    type="checkbox"
                    data-testid="order-partial-confirm"
                    checked={props.confirmedPartials.has(p.name)}
                    disabled={props.busy}
                    onChange={() => togglePartial(p.name)}
                  />
                  buy anyway
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="order-foot">
        <Button data-testid="order-commit" disabled={!props.commitArmed || props.busy} onClick={props.onCommit}>
          {props.busy ? "Sending…" : "Send to Kroger cart"}
        </Button>
      </div>
    </div>
  );
}

/** The post-commit report: each write rendered independently and honestly (D7). */
function OrderResult({ result, onRelink }: { result: OrderOutcome; onRelink: () => void }) {
  const carted = result.cart.written;
  return (
    <div className="order-result" data-testid="order-result">
      <div className={`order-result-row ${carted ? "ok" : "fail"}`} data-testid="order-result-cart">
        {carted ? <IconCheck /> : <IconAlert />}
        {carted ? (
          <span>
            {result.cart.count ?? result.resolved.length} item{(result.cart.count ?? result.resolved.length) === 1 ? "" : "s"} sent to the Kroger cart.
          </span>
        ) : (
          <span>
            The cart was NOT written
            {result.cart.code === "reauth_required"
              ? " — Kroger needs to be re-linked."
              : result.cart.error
                ? ` — ${result.cart.error}`
                : "."}{" "}
            The items stay on your to-buy list.
            {result.cart.code === "reauth_required" ? (
              <>
                {" "}
                <Button size="sm" variant="outline" data-testid="order-relink" onClick={onRelink}>
                  Re-link Kroger
                </Button>
              </>
            ) : null}
          </span>
        )}
      </div>
      <div className={`order-result-row ${result.list.advanced ? "ok" : ""}`} data-testid="order-result-list">
        {result.list.advanced ? <IconCheck /> : <IconAlert />}
        <span>
          {result.list.advanced
            ? "The carted items moved to the In cart group."
            : "The list was not advanced — nothing is marked in-cart."}
        </span>
      </div>
      {result.checkpoint.length ? (
        <div className="order-result-row" data-testid="order-result-checkpoint">
          <IconAlert />
          <span>Not carted (needs a decision): {result.checkpoint.map((c) => c.name).join(", ")}.</span>
        </div>
      ) : null}
    </div>
  );
}

/** The keyboard-driven add row, rendered at the BOTTOM of the list (the mock). */
function AddRow() {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [qty, setQty] = React.useState("");
  const nameRef = React.useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await api.api.grocery.items
      .$post({ json: { name: name.trim(), ...(qty.trim() ? { quantity: qty.trim() } : {}) } })
      .catch(() => null);
    if (res?.ok) {
      setName("");
      setQty("");
      await refreshGrocery(qc);
    } else {
      toast("Couldn't add the item — try again");
    }
    nameRef.current?.focus();
  }

  return (
    <form className="g-add-row" onSubmit={onSubmit} data-testid="grocery-add-row">
      <span className="g-add-plus" aria-hidden="true">
        <IconPlus />
      </span>
      <input
        ref={nameRef}
        className="input"
        placeholder="Add an item — press Enter"
        autoComplete="off"
        aria-label="Item name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input g-qty-in"
        placeholder="qty"
        autoComplete="off"
        aria-label="Quantity"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
      {/* Hidden submit: a form with two text inputs and no submit button gets no
          implicit Enter submission — this keeps the mock's press-Enter-to-add. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}

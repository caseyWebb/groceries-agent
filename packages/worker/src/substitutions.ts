// The deterministic substitution read (member-app-differentiators D1–D4): one shared
// operation behind the coarse MCP tool `suggest_substitutions` and
// `POST /api/grocery/substitutions`. Two halves:
//
//   identitySiblings — the PURE depth-1 walk over the persisted identity graph (D3):
//     satisfies (in-edges, any kind) → general-kind siblings → generalizations
//     (out-edges, general/containment only) → containment-kind siblings →
//     membership-kind siblings; lexicographic within each tier, deduped
//     first-relation-wins, concrete targets only, excluding the line itself and the
//     caller's to-buy set, capped. Every suggestion carries its relation label — the
//     walk proposes and NAMES the relation; fitness judgment stays with the member or
//     the LLM (the architecture's narrowing step).
//
//   suggestSubstitutions — the composed read: per line, the cached pick revalidated
//     (≤ 1 productById), one term search, one `compareUnitPrice` pass with the closed
//     D2 reason vocabulary (`cheaper` / `on_sale` / `in_stock` — nothing else, ever),
//     plus the walk's siblings annotated with pantry hits and the primary store's
//     flyer-rollup sale hints (no per-sibling Kroger search). Budgeted at 12 lines per
//     call with honest `remaining` pagination; a tenant with no resolvable Kroger
//     location degrades to the graph half (`location: null`) rather than erroring.
//
// READ-ONLY by construction: the op never writes the cart, the SKU cache, the grocery
// list, or any other store — acting on a suggestion reuses the existing writes (order
// `overrides`/`exclude`, row add/remove, materialize; D4). The matcher's resolve-only
// and never-substitutes contracts are composed with, never modified: nothing here
// enters the matcher, and a suggestion reaches the cart only as an explicit
// caller-supplied override or list row. The ingredient context is loaded resolve-only
// (capture OFF) — a read must not enqueue novel terms (the to-buy view's posture).

import type { Env } from "./env.js";
import type { KrogerCandidate } from "./kroger.js";
import {
  ingredientContext,
  emptyIngredientContext,
  readIdentityNeighbors,
  readSkuCache,
  type IdentityNeighbor,
  type IdentityNeighbors,
  type IngredientContext,
} from "./corpus-db.js";
import { readPantryNames } from "./session-db.js";
import { readPreferences } from "./profile-db.js";
import { computeToBuyView } from "./to-buy.js";
import { compareUnitPrice, type UnitPriceItem } from "./unit-price.js";
import { baseOf, isFulfillable, isOnSale, MIN_FLYER_DISCOUNT, type CachedMapping, type FlyerItem } from "./matching.js";
import { readStoreFlyer, filterByMinSavings, isSatelliteRollupStale, KROGER_STORE, type FlyerRollup } from "./flyer-warm.js";
import { loadOperatorConfig, DEFAULT_OPERATOR_CONFIG } from "./operator-config.js";
import type { KvStore } from "./kroger-user.js";
import type { OrderWiring } from "./order-tools.js";
import type {
  LineSuggestions,
  SiblingSuggestion,
  SubstitutionAlternative,
  SubstitutionProduct,
  SubstitutionReason,
  SuggestSubstitutionsInput,
  SuggestSubstitutionsResult,
} from "./order-shapes.js";

// The result shapes live in the workerd-free leaf order-shapes.ts (the app and the
// Playwright fixtures type against them); re-exported unchanged.
export type {
  LineSuggestions,
  SiblingSuggestion,
  SubstitutionAlternative,
  SubstitutionProduct,
  SubstitutionReason,
  SuggestSubstitutionsInput,
  SuggestSubstitutionsResult,
} from "./order-shapes.js";

/** Per-call line budget (D1): ≤ 2 Kroger calls per line + token + location resolve —
 *  ≤ ~26 upstream calls at the 12-line cap — stays comfortably under the free-tier
 *  50-subrequest cap. Default AND ceiling. */
export const MAX_SUBSTITUTION_LINES = 12;
/** Same-identity alternatives returned per line, `compareUnitPrice`-ranked (D2). */
export const ALTERNATIVES_CAP = 5;
/** Sibling suggestions returned per line (D3) — membership-last means a broad class
 *  family only surfaces when nothing better exists. */
export const SIBLINGS_CAP = 4;

const EDGE_KINDS = new Set(["general", "containment", "membership"]);

type Relation = SiblingSuggestion["relation"];
type WalkSuggestion = Pick<SiblingSuggestion, "id" | "label" | "relation">;

/**
 * The pure D3 walk over one line's depth-1 neighbor sets. Emits suggestions in the
 * fixed precedence satisfies → `general`-kind siblings → generalizations →
 * `containment`-kind siblings → `membership`-kind siblings, each tier ordered
 * lexicographically by id, deduped across tiers (first relation wins). Targets must
 * be concrete (buyable); the line itself (`neighbors.id`) and anything in `exclude`
 * (the caller's to-buy set, resolved) never surface. Depth is exactly one edge, or
 * two edges through one shared parent — no transitive chains.
 */
export function identitySiblings(
  neighbors: IdentityNeighbors,
  exclude: ReadonlySet<string> = new Set(),
  cap = SIBLINGS_CAP,
): WalkSuggestion[] {
  const x = neighbors.id;
  const admissible = (n: IdentityNeighbor): boolean =>
    n.concrete && n.id !== x && !exclude.has(n.id) && EDGE_KINDS.has(n.kind);
  const byId = (a: IdentityNeighbor, b: IdentityNeighbor): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tier = (entries: IdentityNeighbor[], role: Relation["role"]): WalkSuggestion[] =>
    [...entries].filter(admissible).sort(byId).map((n) => ({
      id: n.id,
      label: n.label,
      relation: {
        role,
        kind: n.kind as Relation["kind"],
        ...(role === "sibling" && n.via !== undefined ? { via: n.via } : {}),
      },
    }));

  const tiers: WalkSuggestion[][] = [
    // satisfies — any kind: the edge's defining semantics (usable where x is requested).
    tier(neighbors.satisfiedBy, "satisfies"),
    // same-kind co-children, general first (the specialization families).
    tier(neighbors.coChildren.filter((n) => n.kind === "general"), "sibling"),
    // generalizations — what x itself satisfies; membership targets are classes, not purchases.
    tier(neighbors.satisfies.filter((n) => n.kind === "general" || n.kind === "containment"), "generalization"),
    tier(neighbors.coChildren.filter((n) => n.kind === "containment"), "sibling"),
    // membership co-children last + capped: a `vegetables`-style broad family only
    // surfaces when nothing better exists, always labeled with its `via` parent.
    tier(neighbors.coChildren.filter((n) => n.kind === "membership"), "sibling"),
  ];

  const out: WalkSuggestion[] = [];
  const seen = new Set<string>();
  for (const t of tiers) {
    for (const s of t) {
      if (seen.has(s.id)) continue; // first relation wins
      seen.add(s.id);
      out.push(s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Effective shopper price: promo when it is a real discount, else regular. */
function effectivePrice(c: KrogerCandidate): number {
  return isOnSale(c) ? c.price.promo : c.price.regular;
}

function toProduct(c: KrogerCandidate): SubstitutionProduct {
  return {
    sku: c.productId,
    brand: c.brand,
    description: c.description,
    size: c.size,
    price: c.price,
    on_sale: isOnSale(c),
    available: isFulfillable(c),
    aisleLocation: c.aisleLocation,
  };
}

/** One line as the op processes it (name + funnel key + optional view origin). */
interface LineInput {
  name: string;
  key: string;
  origin?: "list" | "plan" | "both";
}

/** Match a sibling against the flyer rollup's sale items (D3): a `FlyerItem` whose
 *  `matched_terms` contains the sibling's base or search_term as an ELEMENT — or, for
 *  satellite rollups whose `matched_terms` is empty by contract, whose lowercased
 *  description contains either as a substring. No per-sibling Kroger search, ever. */
function flyerHint(saleItems: FlyerItem[], base: string, searchTerm: string): SiblingSuggestion["on_sale_hint"] {
  const terms = [base.toLowerCase(), searchTerm.toLowerCase()];
  for (const item of saleItems) {
    const hit =
      item.matched_terms.length > 0
        ? item.matched_terms.some((t) => terms.includes(t.toLowerCase()))
        : terms.some((t) => item.description.toLowerCase().includes(t));
    if (hit) return { sku: item.sku, description: item.description, price: item.price, savings: item.savings };
  }
  return undefined;
}

/** The current pick's cache lookup (matcher D7 semantics, read not modified):
 *  location-tagged rows first, the legacy untagged `''` row next, cross-location last. */
function pickMapping(cache: CachedMapping[], key: string, locationId: string): CachedMapping | null {
  const rank = (m: CachedMapping): number =>
    m.locationId === locationId ? 0 : !m.locationId ? 1 : 2;
  const hits = cache.filter((m) => m.ingredient === key).sort((a, b) => rank(a) - rank(b));
  return hits[0] ?? null;
}

/**
 * The shared substitution read (D1/D2). Read-only; ≤ 1 `productById` revalidation +
 * exactly 1 term search per processed line; `max_lines` defaults to and is capped at
 * 12 with unprocessed names returned in `remaining`. With no resolvable Kroger
 * location the price/availability half is empty (`location: null`) and the graph +
 * pantry + flyer half is still served.
 */
export async function suggestSubstitutions(
  env: Env,
  tenantId: string,
  input: SuggestSubstitutionsInput,
  wiring: OrderWiring,
): Promise<SuggestSubstitutionsResult> {
  // Resolve-only funnel (capture OFF): a read must not enqueue novel terms; degrade
  // to the empty context rather than failing the read on a resolver blip.
  const ctx: IngredientContext = await ingredientContext(env, { capture: false }).catch(() =>
    emptyIngredientContext(env),
  );

  // The caller's current to-buy set: the default line source, AND the walk's
  // exclusion set (a suggestion already on the list is not a substitution).
  const view = await computeToBuyView(env, tenantId);
  const viewLines: LineInput[] = view.to_buy.map((l) => ({ name: l.name, key: l.key, origin: l.origin }));
  const lines: LineInput[] =
    input.names !== undefined
      ? input.names.map((name) => ({ name, key: ctx.resolve(name) }))
      : viewLines;

  const budget = Math.min(Math.max(1, Math.floor(input.max_lines ?? MAX_SUBSTITUTION_LINES)), MAX_SUBSTITUTION_LINES);
  const processed = lines.slice(0, budget);
  const remaining = lines.slice(budget).map((l) => l.name);

  // The caller's primary fulfillment store (the store_flyer resolution): the flyer
  // hint's rollup source. Kroger-primary tenants also get the price/availability half.
  const prefs = await readPreferences(env, tenantId).catch(() => null);
  const stores = prefs?.stores as Record<string, unknown> | undefined;
  const primary =
    typeof stores?.primary === "string" && stores.primary.trim() ? stores.primary.trim().toLowerCase() : KROGER_STORE;
  const label = typeof stores?.preferred_location === "string" ? stores.preferred_location : null;

  // No resolvable Kroger location (walk/satellite primaries, unresolvable labels) →
  // degrade: the graph half is store-independent value (D1).
  let locationId: string | null = null;
  if (primary === KROGER_STORE) {
    locationId = await wiring.getLocationId().catch(() => null);
  }

  // The primary store's warmed flyer rollup at the flyer reads' default sale floor —
  // fixed here, not caller-tunable (D1's no-knob revision; widening the net is
  // kroger_flyer/store_flyer's job). Zero fan-out: one KV read.
  const kv = env.KROGER_KV as unknown as KvStore;
  let rollup: FlyerRollup | null = null;
  const flyerLocation = primary === KROGER_STORE ? locationId : label;
  if (label && flyerLocation) {
    rollup = await readStoreFlyer(kv, primary, flyerLocation).catch(() => null);
  }
  // A satellite rollup past the operator's staleness ceiling is suppressed entirely —
  // the same gate `store_flyer` applies — rather than hinting off stale sales;
  // `flyer_as_of` below then reflects that nothing was actually used.
  if (rollup) {
    const operatorConfig = await loadOperatorConfig(env).catch(() => null);
    const stalenessDays = operatorConfig?.scanStalenessDays ?? DEFAULT_OPERATOR_CONFIG.scanStalenessDays;
    if (isSatelliteRollupStale(primary, rollup.as_of, stalenessDays)) rollup = null;
  }
  const saleItems = rollup ? filterByMinSavings(rollup.items, MIN_FLYER_DISCOUNT) : [];

  const [cache, pantry, neighborsByKey] = await Promise.all([
    locationId !== null ? readSkuCache(env) : Promise.resolve([] as CachedMapping[]),
    readPantryNames(env, tenantId),
    // Processed keys drive the walk; the view keys ride along so the exclusion set
    // below compares SURVIVOR ids (a merged-away stored key still excludes its family).
    readIdentityNeighbors(env, [...processed.map((l) => l.key), ...viewLines.map((l) => l.key)]),
  ]);

  // D3: a suggestion never proposes an id already in the caller's to-buy set (the
  // walk itself drops the line's own id). Representative-resolved on both sides.
  const excludeIds = new Set<string>();
  for (const l of viewLines) {
    const n = neighborsByKey.get(l.key);
    excludeIds.add(n ? n.id : l.key);
  }

  const suggestions: LineSuggestions[] = await Promise.all(
    processed.map(async (line): Promise<LineSuggestions> => {
      // --- the graph half (store-independent) --------------------------------
      const neighbors = neighborsByKey.get(line.key);
      const siblings: SiblingSuggestion[] = (neighbors ? identitySiblings(neighbors, excludeIds) : []).map((s) => ({
        ...s,
        in_pantry: pantry.has(s.id),
        ...(() => {
          const hint = flyerHint(saleItems, baseOf(s.id), ctx.searchTerm(s.id));
          return hint ? { on_sale_hint: hint } : {};
        })(),
      }));

      const forLine = { name: line.name, key: line.key, ...(line.origin !== undefined ? { origin: line.origin } : {}) };

      if (locationId === null) {
        return { for: forLine, status: "no_cached_pick", current: null, alternatives: [], siblings };
      }

      // --- the price/availability half (≤ 2 Kroger calls) --------------------
      // 1. Current pick: the cached mapping revalidated for fresh price/fulfillment/aisle.
      const mapping = pickMapping(cache, line.key, locationId);
      let status: LineSuggestions["status"];
      let current: SubstitutionProduct | null = null;
      if (mapping === null) {
        status = "no_cached_pick";
      } else {
        const fresh = await wiring.productById(mapping.sku).catch(() => null);
        if (fresh === null) {
          status = "current_unavailable";
        } else {
          current = toProduct(fresh);
          status = current.available ? "ok" : "current_unavailable";
        }
      }

      // 2. Candidates: exactly one term search (the same phrase the matcher searches),
      //    filtered to fulfillable, the current SKU excluded.
      const found = await wiring.search(ctx.searchTerm(line.key)).catch(() => [] as KrogerCandidate[]);
      const candidates = found.filter((c) => isFulfillable(c) && c.productId !== current?.sku);

      // 3. One compareUnitPrice pass over current + candidates — comparability
      //    (dimension grouping, incomparable) is decided by the existing core.
      const byId = new Map(candidates.map((c) => [c.productId, c] as const));
      const items: UnitPriceItem[] = [];
      const freshCurrent = current;
      if (freshCurrent) {
        items.push({ id: freshCurrent.sku, price: freshCurrent.on_sale ? freshCurrent.price.promo : freshCurrent.price.regular, size: freshCurrent.size ?? "" });
      }
      for (const c of candidates) items.push({ id: c.productId, price: effectivePrice(c), size: c.size ?? "" });
      const compared = compareUnitPrice(items);
      const unitOf = new Map(compared.ranked.map((r) => [r.id, r] as const));
      if (freshCurrent && unitOf.has(freshCurrent.sku)) {
        const u = unitOf.get(freshCurrent.sku)!;
        freshCurrent.unit_price = u.unit_price;
        freshCurrent.base_unit = u.base_unit;
      }

      // Ranked (unit-price ascending) first, then the incomparable in search order.
      const ordered: KrogerCandidate[] = [
        ...compared.ranked.map((r) => byId.get(r.id)).filter((c): c is KrogerCandidate => c !== undefined),
        ...candidates.filter((c) => !unitOf.has(c.productId)),
      ];

      // 4. The closed reason vocabulary (D2) — these three, nothing else, ever.
      const currentUnit = freshCurrent && unitOf.has(freshCurrent.sku) ? unitOf.get(freshCurrent.sku)!.unit_price : null;
      const alternatives: SubstitutionAlternative[] = ordered.slice(0, ALTERNATIVES_CAP).map((c) => {
        const product = toProduct(c);
        const u = unitOf.get(c.productId);
        if (u) {
          product.unit_price = u.unit_price;
          product.base_unit = u.base_unit;
        }
        const reasons: SubstitutionReason[] = [];
        // cheaper: strictly lower unit price, only when BOTH ranked comparable.
        if (currentUnit !== null && u && u.unit_price < currentUnit) reasons.push("cheaper");
        if (product.on_sale) reasons.push("on_sale");
        // in_stock: fulfillable (by filter) while the current pick is unavailable.
        if (status === "current_unavailable") reasons.push("in_stock");
        return { ...product, reasons };
      });

      return { for: forLine, status, current, alternatives, siblings };
    }),
  );

  return {
    suggestions,
    remaining,
    location: locationId !== null ? { id: locationId } : null,
    flyer_as_of: rollup ? new Date(rollup.as_of).toISOString() : null,
  };
}

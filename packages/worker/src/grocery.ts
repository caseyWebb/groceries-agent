// Pure grocery-list operations (grocery-list capability). No I/O — the tool
// wrappers supply the current items and today's date and persist the result, so
// the merge/update/remove logic is unit-testable in isolation.
//
// Items are keyed by NORMALIZED name: re-adding an existing name merges into the
// existing entry (union for_recipes, reconcile quantity) rather than duplicating.
// Resolution to a Kroger SKU is deferred to order time (Change 06b) — nothing
// here stores a SKU, and new items are always created `status: "active"`.

export type GroceryKind = "grocery" | "household" | "other";
export type GroceryStatus = "active" | "in_cart" | "ordered";
export type GrocerySource = "ad_hoc" | "menu" | "pantry_low" | "stockup";

export interface GroceryItem {
  name: string;
  /**
   * The STORED canonical dedup key (the D1 `normalized_name` / PK) — the canonical ingredient id
   * for a food row, else `normalizeName(name)`. Carried on the in-memory shape so the set-algebra
   * keys on the STORED id, never a re-derivation of the (now-independent) display. Optional only so
   * the pure-op fixtures need not supply it — they fall back to `groceryKey`; every production row
   * (and every row this module mints) carries it.
   */
  normalized_name?: string;
  /**
   * The human-facing label rendered to the member, stored independently of both `name` (the
   * resolver input / surface form) and `normalized_name` (the key). Null → the rendered label falls
   * back to `name`. Set from the identity node's curated `display_name` on an add-by-id row; a typed
   * add leaves it null so the member's own phrasing renders (C3 preserve-phrasing).
   */
  display_name?: string | null;
  quantity: string;
  kind: GroceryKind;
  /**
   * The kind of STORE this is bought at — a free string, default "grocery"
   * (common values grocery | home-improvement | garden | pharmacy). Orthogonal to
   * `kind`: `kind` governs pantry reconcile on receive; `domain` governs which
   * store-type an in-store walk includes the item in.
   */
  domain: string;
  status: GroceryStatus;
  source: GrocerySource;
  for_recipes: string[];
  note: string | null;
  added_at: string;
  ordered_at: string | null;
}

/** Input for adding an item; everything is optional with sensible defaults, but at least one of
 *  `name` / `id` must be supplied. */
export interface GroceryAddInput {
  /**
   * The member's surface form. Optional: an add MAY be keyed by `id` alone (add-by-id), in which
   * case the row writer derives the name (posted name → the identity's curated display → the id)
   * before the row is created, so no surface ever renders a bare id.
   */
  name?: string;
  /**
   * An explicit ALREADY-CANONICAL ingredient id (add-by-id). When set, the row keys on this id
   * DIRECTLY — the id is validated, NOT re-resolved through the funnel — and dedups against any
   * existing row with that stored key. Food-only: a canonical id implies food.
   */
  id?: string;
  /**
   * The curated display to store on the row. Populated by the row writer from the identity node's
   * `display_name` for an add-by-id (null when the node stores none → render falls back to `name`);
   * left unset for a typed add so the member's phrasing renders.
   */
  display_name?: string | null;
  quantity?: string;
  kind?: GroceryKind;
  domain?: string;
  source?: GrocerySource;
  for_recipes?: string[];
  note?: string | null;
}

/** Fields a caller may patch on an existing item. */
export interface GroceryUpdateInput {
  quantity?: string;
  kind?: GroceryKind;
  domain?: string;
  status?: GroceryStatus;
  source?: GrocerySource;
  for_recipes?: string[];
  note?: string | null;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether a grocery row is a **food** item — the only rows routed through the ingredient
 * identity funnel (canonical-id dedup + capture). `household` / `other` kinds and non-grocery
 * domains (home-improvement, garden, pharmacy) stay on `normalizeName` and never enter the
 * identity graph, so it only ever ingests real food vocabulary. Both signals default to
 * `grocery` (the schema defaults), so an unqualified item is food. (Pantry has no kind/domain —
 * it is kitchen inventory, food by construction — so pantry callers do not consult this.)
 */
export function isFoodItem(kind?: string, domain?: string): boolean {
  return (kind ?? "grocery") === "grocery" && (domain ?? "grocery") === "grocery";
}

/**
 * The dedup / D1 `normalized_name` key for a grocery row: the canonical ingredient id
 * (`resolve` = normalize + capture) for a food row, else `normalizeName`. `resolve` is the
 * injected `IngredientContext.resolve`; it defaults to `normalizeName` so the pure ops and
 * their unit tests keep today's behavior when no resolver is threaded (production always
 * injects `ctx.resolve`).
 */
export function groceryKey(
  name: string,
  kind: string | undefined,
  domain: string | undefined,
  resolve: (n: string) => string = normalizeName,
): string {
  return isFoodItem(kind, domain) ? resolve(name) : normalizeName(name);
}

/**
 * The STORED dedup key of an in-memory item: its carried `normalized_name` (the trusted D1 PK —
 * NEVER re-derived from the display, which closes coupling #2: a row whose display no longer equals
 * `resolve(name)` must not silently fall out of the set-algebra) when present, else the derived
 * `groceryKey` for a fixture / not-yet-persisted item. Every production row carries `normalized_name`.
 */
export function storedGroceryKey(item: GroceryItem, resolve: (n: string) => string = normalizeName): string {
  return item.normalized_name ?? groceryKey(item.name, item.kind, item.domain, resolve);
}

/**
 * Find an item matching a bare `name` query. The query carries no kind/domain, so it matches BOTH
 * candidate keys: an item matches when its STORED key (`storedGroceryKey`) equals `resolve(name)` OR
 * `normalizeName(name)`. This finds a food target across surface forms and a non-food target without
 * knowing foodness upfront. The existing item is keyed on its STORED `normalized_name` (not a fresh
 * re-derivation); only the QUERY side derives its key. `resolve` defaults to `normalizeName`, so an
 * un-threaded caller keeps today's behavior (both candidate keys collapse to `normalizeName(name)`).
 */
function findIndex(items: GroceryItem[], name: string, resolve: (n: string) => string = normalizeName): number {
  const resolved = resolve(name);
  const plain = normalizeName(name);
  return items.findIndex((it) => {
    const key = storedGroceryKey(it, resolve);
    return key === resolved || key === plain;
  });
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The W3 status-transition guard (grocery-list capability), pure. `active ⇄ in_cart`
 * is freely writable in both directions — and so is re-listing an `ordered` row back
 * to `active`/`in_cart` (a canceled order is a legitimate member correction). Entering
 * `ordered` is legal ONLY from `in_cart`: that write is the user-asserted "I placed
 * the order" advance. Every other path into `ordered` (including re-asserting it on an
 * already-`ordered` row) is rejected — the order flow's own advances
 * (`advanceInCartRows` / `advanceOrderedRows`) are separate code paths and never come
 * through here. Returns the rejection reason, or null when the transition is legal.
 */
export function illegalStatusTransition(current: GroceryStatus, next: GroceryStatus): string | null {
  if (next === "ordered" && current !== "in_cart") {
    return (
      `cannot set status "ordered" on a "${current}" item — "ordered" is accepted only as the ` +
      `user-asserted advance from "in_cart" (order placed); move the item to "in_cart" first`
    );
  }
  return null;
}

/** Find an item matching `name` (the exported face of the dual-key lookup below). */
export function findGroceryItem(
  items: GroceryItem[],
  name: string,
  resolve: (n: string) => string = normalizeName,
): GroceryItem | undefined {
  const idx = findIndex(items, name, resolve);
  return idx >= 0 ? items[idx] : undefined;
}

export interface AddResult {
  items: GroceryItem[];
  item: GroceryItem;
  merged: boolean;
}

/**
 * Add an item, or merge into an existing entry (union for_recipes; take the new
 * quantity/note/source when provided). Returns the next item list.
 *
 * Keying has two modes. Add-BY-ID (`input.id` set): the id is an already-canonical key — the row
 * keys on it DIRECTLY (no `resolve`) and dedups against any existing row with that stored key, and
 * the created row carries the caller-supplied `display_name`. Add-by-NAME (no `id`): today's
 * behavior — the key is `groceryKey(name, …)` (food → `resolve`, non-food → `normalizeName`), the
 * add's foodness gating the injected resolver so a NON-food add never touches the capturing resolver
 * (decision #5). On a merge the surviving row keeps its existing display (`name`/`display_name`/
 * `normalized_name` all ride `...existing`) — C3 keep-first, so a merge never fragments the label.
 */
export function addToGroceryList(
  items: GroceryItem[],
  input: GroceryAddInput,
  today: string,
  resolve: (n: string) => string = normalizeName,
): AddResult {
  const next = items.map((it) => ({ ...it, for_recipes: [...it.for_recipes] }));
  const name = (input.name ?? "").trim();

  let idx: number;
  let storedKey: string;
  if (input.id !== undefined) {
    // Add-by-id: key on the already-canonical id directly; dedup against any row with that stored key.
    storedKey = input.id;
    idx = next.findIndex((it) => storedGroceryKey(it, resolve) === storedKey);
  } else {
    const keyResolve = isFoodItem(input.kind, input.domain) ? resolve : normalizeName;
    idx = findIndex(next, name, keyResolve);
    storedKey = groceryKey(name, input.kind, input.domain, keyResolve);
  }

  if (idx >= 0) {
    const existing = next[idx];
    const merged: GroceryItem = {
      ...existing, // keep-first: name / display_name / normalized_name survive unchanged
      quantity: input.quantity ?? existing.quantity,
      kind: input.kind ?? existing.kind,
      domain: input.domain ?? existing.domain,
      source: input.source ?? existing.source,
      for_recipes: uniq([...existing.for_recipes, ...(input.for_recipes ?? [])]),
      note: input.note !== undefined ? input.note : existing.note,
    };
    next[idx] = merged;
    return { items: next, item: merged, merged: true };
  }

  const created: GroceryItem = {
    name,
    normalized_name: storedKey,
    display_name: input.display_name ?? null,
    quantity: input.quantity ?? "1",
    kind: input.kind ?? "grocery",
    domain: input.domain ?? "grocery",
    status: "active",
    source: input.source ?? "ad_hoc",
    for_recipes: uniq(input.for_recipes ?? []),
    note: input.note ?? null,
    added_at: today,
    ordered_at: null,
  };
  next.push(created);
  return { items: next, item: created, merged: false };
}

export interface UpdateResult {
  items: GroceryItem[];
  item: GroceryItem;
}

/** Patch an existing item by name. Throws if the item is absent. */
export function updateGroceryItem(
  items: GroceryItem[],
  name: string,
  patch: GroceryUpdateInput,
  resolve: (n: string) => string = normalizeName,
): UpdateResult {
  const idx = findIndex(items, name, resolve);
  if (idx < 0) throw new Error(`not found: ${name}`);
  const next = items.map((it) => ({ ...it, for_recipes: [...it.for_recipes] }));
  next[idx] = {
    ...next[idx],
    ...patch,
    for_recipes: patch.for_recipes ?? next[idx].for_recipes,
  };
  return { items: next, item: next[idx] };
}

/** Remove an item by name. `found` is false when no such item existed. */
export function removeGroceryItem(
  items: GroceryItem[],
  name: string,
  resolve: (n: string) => string = normalizeName,
): { items: GroceryItem[]; found: boolean } {
  const idx = findIndex(items, name, resolve);
  if (idx < 0) return { items, found: false };
  return { items: items.filter((_, i) => i !== idx), found: true };
}

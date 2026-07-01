# Tasks

## 1. Food guard + funnel wiring

- [ ] 1.1 Add `isFoodItem(kind, domain)` (`src/grocery.ts` or a small shared helper): `true` iff `kind === "grocery"` and `domain` is grocery/absent. Unit-test the `kind: grocery, domain: pharmacy` exclude and the household/other excludes.
- [ ] 1.2 Thread the `IngredientContext` (or a `resolve(name) => id` closure) into the pure grocery ops (`addToGroceryList` / `findIndex` / `updateGroceryItem` / `removeGroceryItem`) and the order set-math, so the dedup key is `resolve(name)` for food and `normalizeName(name)` otherwise. Keep the ops pure (inject the resolver, don't import env).
- [ ] 1.3 `src/session-db.ts`: compute `normalized_name` via the funnel for food grocery/pantry upserts (pantry funnels wholesale); non-food grocery via `normalizeName`. Capture (enqueue-on-miss) rides `resolve` for food only.

## 2. Matching + set math

- [ ] 2.1 `src/pantry-write.ts` `matches()`: compare canonical ids (resolve both query + stored name) instead of `.toLowerCase()`. Preserve the case-insensitive guarantee (the id is lowercased) and add quantity/alias tolerance.
- [ ] 2.2 `src/order.ts` `computeToBuy`: the pantry ⊖ grocery ∪ menu-needs join keys on the canonical id (food), so an on-hand item cancels its grocery/menu counterpart across surface forms. The overrides-map key (`order-tools.ts`) resolves through the same funnel so a dispositioned line still matches.
- [ ] 2.3 `remove_from_grocery_list` resolves the query through the funnel so a case/quantity/alias-varying removal hits its row.

## 3. Migration / reconcile (decision D2)

- [ ] 3.1 A per-tenant reconcile that re-keys food `pantry` / `grocery_list.normalized_name` from `normalizeName(name)` to `resolve(name)`, applying the collision-merge rules (grocery: union `for_recipes`, reconcile `quantity`, earliest `added_at`, most-advanced `status`, first non-null `note`; pantry: earliest `added_at`, freshest `last_verified_at`, latest `quantity`, first non-null `category`/`prepared_from`/`notes`). Idempotent; leaves `name` untouched.
- [ ] 3.2 Reconcile tests: a collision merges (two rows → one) without losing `for_recipes` / `status` / `added_at`; a non-food row is left on `normalizeName`; re-running is a no-op.
- [ ] 3.3 Decide big-bang vs lazy-re-key (Open Question #1) — default to the reconcile-backfill; wire lazy-tolerant reads only if adopted.

## 4. Docs + guarantees

- [ ] 4.1 `docs/SCHEMAS.md`: `pantry` / `grocery_list` `normalized_name` semantics (canonical id for food via the funnel; `normalizeName` for non-food) + the food guard.
- [ ] 4.2 `docs/ARCHITECTURE.md`: the fragmentation-store list — all four stores now key on the funnel; note the non-food carve-out.
- [ ] 4.3 Confirm the capture cron's per-tick bound absorbs the new food grocery/pantry capture source, or add a drain budget (Open Question #3).

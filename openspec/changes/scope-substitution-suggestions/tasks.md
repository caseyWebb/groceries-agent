## 1. Shape

- [ ] 1.1 Add `in_cart?: boolean` and `on_list?: boolean` to `SiblingSuggestion` in `packages/worker/src/order-shapes.ts` (present-when-true, mirroring `on_sale_hint`); update the doc comment to name the four surfacing reasons.

## 2. Annotator filter

- [ ] 2.1 In `packages/worker/src/substitute-annotator.ts`, extend `AnnotateSubstitutesDeps` with `inCart: ReadonlySet<string>` and `onList: ReadonlySet<string>` (the caller's `in_cart` and active grocery-list keys).
- [ ] 2.2 Take the full ordered walk (call `identitySiblings` uncapped — pass `cap = Infinity`) and drop the to-buy-set exclusion (`excludeIds`); keep only the self-line exclusion that `identitySiblings` already applies.
- [ ] 2.3 Compute each walked target's reasons — `in_pantry` (existing `pantry` set), `in_cart` (`deps.inCart`), `on_list` (`deps.onList`), and `on_sale_hint` (existing `flyerHint`) — and keep a target only when at least one reason is truthy (on-sale independent; the three possession reasons require membership).
- [ ] 2.4 Slice the surviving, precedence-ordered targets to `SIBLINGS_CAP`, and set `in_cart`/`on_list` only when true on each returned `SiblingSuggestion` (alongside the existing `in_pantry` and optional `on_sale_hint`).

## 3. Enriched read wiring

- [ ] 3.1 In `packages/worker/src/to-buy.ts` `enrichView`, build `inCartKeys` and `activeListKeys` `Set<string>` from the already-loaded `list` via `storedGroceryKey(row, resolve)` (statuses `in_cart` and `active`), and thread them into the `annotateSubstitutes` deps. Confirm no new reads are introduced.

## 4. Inline-hint UI

- [ ] 4.1 In `packages/ui/src/components/grocery-list.tsx`, render each substitute's surfacing justification from its reasons — "in your pantry" / "in your cart" / "already on your list" / "on sale — $X" — reusing/adding the `subs-*` testids; keep the accept (by line origin) and per-session dismiss unchanged, and keep an empty `substitutes[]` rendering clean.

## 5. Tests

- [ ] 5.1 Update `packages/worker/test/substitutions.test.ts` and `packages/worker/test/substitution-capture.test.ts`: assert non-actionable neighbors are dropped, each possession reason surfaces with its flag, on-sale surfaces independently (no possession), an active-list substitute surfaces flagged `on_list`, and a no-actionable line returns empty.
- [ ] 5.2 Add a regression test that an actionable neighbor ranked past the raw `SIBLINGS_CAP` still surfaces (filter-before-cap), and that a plan-only virtual to-buy line does not surface unless on sale.
- [ ] 5.3 Update the Playwright `packages/worker/app/visual/specs/substitutions.spec.ts` (and any page-object seed in `app/visual/pages/grocery.page.ts`) to seed an actionable substitute and assert its justification renders; assert a non-actionable line shows no hint affordance.
- [ ] 5.4 Run `aubr typecheck`, `aubr test -- -t "substitut"`, and `aubr test:app`; then `/opsx:archive` readiness — `openspec validate "scope-substitution-suggestions"` passes.

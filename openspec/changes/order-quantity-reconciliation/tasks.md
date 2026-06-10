## 1. Honor menu_needs[].quantity + assumed_quantity (code)

- [x] 1.1 In `worker/src/order.ts`, track a numeric package count per merged entry from `menu_needs[].quantity` (only when `> 0`; take the **max** when several needs merge to one name)
- [x] 1.2 Apply quantity precedence in `computeToBuy`: `quantities[name]` (override, `> 0`) → `menu_needs[].quantity` → default 1
- [x] 1.3 Add `assumed_quantity: boolean` to `ToBuyItem` — `true` exactly when no package count was supplied from either source (line fell back to 1)
- [x] 1.4 Add `assumed_quantity` to `ResolvedLine` and thread it through `placeOrder` (both the override path and the resolved path) so it appears on the (preview) result's `resolved` lines

## 2. Tests

- [x] 2.1 `computeToBuy` honors `menu_needs[].quantity` (quantity 4 → line quantity 4, `assumed_quantity: false`)
- [x] 2.2 `quantities` map overrides `menu_needs[].quantity` (override wins; `assumed_quantity: false`)
- [x] 2.3 No package count from either source → quantity 1, `assumed_quantity: true`
- [x] 2.4 `max` is taken when two menu needs merge to one name with different quantities
- [x] 2.5 `placeOrder` carries `assumed_quantity` onto `resolved` lines (preview); existing order tests still pass
- [x] 2.6 Run `npm test` + `npm run typecheck` in `worker/`; green — 156 passed / 4 skipped, order suite +5; existing `toBuy` helper + override deep-equal updated for the additive field

## 3. Contract + instructions sync

- [x] 3.1 `docs/TOOLS.md` `place_order`: note `menu_needs[].quantity` is honored (overridden by the `quantities` map) and that `resolved` lines carry `assumed_quantity`; also synced the MCP tool description in `order-tools.ts`
- [x] 3.2 `AGENT_INSTRUCTIONS.md` order-placement flow: at `preview`, reconcile `assumed_quantity` lines that are by-the-each produce against the recipe (read the required amount) and set an explicit quantity before the real flush; cites the undercount failure as the reason

## 4. Verify (optional live)

- [ ] 4.1 After deploy, `place_order(preview=true, menu_needs:[{name:"anaheim peppers"}])` shows `assumed_quantity: true`; supplying `quantity: 4` yields a line of 4

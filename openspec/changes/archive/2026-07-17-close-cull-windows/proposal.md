# close-cull-windows

## Why

The deployment is three known members the operator can walk through any breakage, so the cull's deprecation windows are ceremony without benefit: five dispatch aliases and two conversion shims sit on the surface serving nobody. The operator has waived the windows; the culling finishes now. (The older `remove-meal-dimension-shims` cleanup is NOT part of this — its frozen-column drops are gated on verified production-data convergence, not just a window.)

## What Changes

- **BREAKING** The three fusion alias families close: `add_to_grocery_list`, `remove_from_grocery_list`, and `list_guidance` unregister (stale calls get the generic unknown-tool rejection); `toggle_favorite`/`toggle_reject` flip to **app-plane-only** registrations (the recipe-card widget still calls them by name; they leave the model surface).
- **BREAKING** The old single-patch `update_grocery_list` call form is rejected as `malformed_data` (the ops form is the contract).
- **BREAKING** `log_cooked` rejects `type: "ready_to_eat"` with `validation_failed` (the accept-and-convert shim closes; historical rows are untouched and keep aggregating as before).
- **BREAKING** `new_for_me` on `propose_meal_plan`/`display_meal_plan` falls through to the unknown-key rejection (the accept-and-ignore window from `single-slot-discovery` closes in the same release it opened — waived).
- `docs/TOOLS.md`: the fusion-alias rows, their removal-condition paragraph, the `log_cooked` shim row, and the `new_for_me` row leave the deprecation table; the member-surface enumeration loses its alias clause.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-tool-gating` — the member-surface enumeration drops the open-window alias clause; the alias requirement is restated in its closed form (app-plane toggle pair; everything else unknown-tool).
- `grocery-list` — the old single-patch form's conversion scenario becomes a rejection.
- `data-write-tools` / `cooking-history` — `log_cooked`'s type contract loses the conversion shim (rejection; historical-row read semantics unchanged).
- `meal-plan-proposal` — the retired `new_for_me` key rejects as unknown.

## Impact

- `packages/worker/src/`: `write-tools.ts` (toggle aliases → app-plane), `grocery-tools.ts` (alias unregisters + old-form branch removal), `tools.ts`/`guidance.ts` (`list_guidance` unregister), `cooking-write.ts` (shim → rejection), `meal-plan-proposal-tool.ts` + `meal-plan-widget.ts` (schema key removal).
- Tests: alias-absence + app-plane assertions in the gating matrix; old-form rejection; `ready_to_eat` rejection; `new_for_me` unknown-key.
- Docs: `docs/TOOLS.md`. Plugin republish rides the deploy (persona already references only the fused names — no persona change).
- No migrations. The operator briefs the two other members (waiver acknowledged in this proposal).

## Why

`place_order` silently undercounts by-the-each produce. Two compounding causes:

1. **`menu_needs[].quantity` is dead.** The tool's schema accepts `menu_needs: [{ name, quantity?, for_recipes? }]` and `MenuNeed.quantity` is typed, but `computeToBuy` never reads it — package quantity comes *only* from a separate `quantities` map keyed by name. So the natural way to say "buy 4 anaheim peppers" (`menu_needs: [{ name, quantity: 4 }]`) is silently dropped and defaults to 1. No test covers the field.
2. **The default-1 assumption is invisible.** Package count defaults to one with no signal, so a recipe needing 2–4 peppers/tomatillos resolves to a single unit and the agent gets no indication it assumed anything. The design's "default 1 **package**" stance assumed packaged goods; by-the-each produce breaks it.

Observed live (the 2026-06-09 session): fresh poblano/Anaheim/serrano went to cart defaulted, undercounting the recipe.

## What Changes

- **Honor `menu_needs[].quantity`** in `computeToBuy` as the package count, with the explicit `quantities` map taking precedence as an override. The obvious path to set a quantity now works.
- **Surface the assumption, don't guess produce.** Each to-buy line carries `assumed_quantity: boolean` — `true` when no numeric package count was supplied from either source (the line defaulted to 1). This is a deterministic *fact* threaded onto resolved lines and into the (preview) result; the tool does **not** try to classify "by-the-each produce" from noisy `size` strings. The LLM applies that judgment — the same "facts from the tool, judgment from the LLM" split used for freshness in Change 08.
- **Strengthen the order flow (AGENT_INSTRUCTIONS):** at the existing `place_order(preview=true)` step, reconcile `assumed_quantity` lines that are by-the-each produce against the recipe (read the required amount) and set explicit quantities before the real flush. The undercount is blocked by the existing preview gate plus honest surfacing — no new blocking checkpoint, no over-prompting on produce that legitimately needs 1.

**Non-Goals:** tool-side "by-the-each produce" detection or portion math (stays LLM judgment; the no-portion-tracking stance holds); a hard blocking checkpoint (the soft flag was chosen); conflating `grocery_list` items' string `quantity` (a human need-annotation like "2 lbs") with the numeric package count.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `order-placement`: `menu_needs[].quantity` is honored as the package count (override precedence to the `quantities` map); to-buy/resolved lines carry `assumed_quantity`; the order flow reconciles assumed-quantity by-the-each produce at preview.

## Impact

- **Code:** `worker/src/order.ts` (`computeToBuy` quantity precedence + `assumed_quantity`; `ToBuyItem`/`ResolvedLine` shapes), `worker/test/order.test.ts`.
- **Docs/instructions:** `docs/TOOLS.md` (`place_order` — `menu_needs.quantity` honored, `assumed_quantity` in returns), `AGENT_INSTRUCTIONS.md` (order-placement flow: reconcile assumed produce at preview).
- **Behavior:** the per-need quantity path works; defaulted lines are visible; recipe-derived produce stops silently undercounting. No return-shape removals (additive field).

## Context

`place_order` computes the buy set in `computeToBuy` (worker/src/order.ts), then `placeOrder` resolves each line and flushes. Quantity is a **package count** (a number) and defaults to 1 ([order.ts:95](worker/src/order.ts:95)). Two facts from the code:

- The menu-needs merge loop ([order.ts:76-81](worker/src/order.ts:76)) reads only `name` + `for_recipes` — `need.quantity` is never consulted. Quantity comes solely from the `quantities` map ([order.ts:92](worker/src/order.ts:92)). `MenuNeed.quantity` and the schema field are dead.
- `GroceryItem.quantity` is a **string** ("2 lbs") — a human need-annotation, not a package count — so list items also default to 1 package at order time.

The order flow already front-loads `place_order(preview=true)` (per AGENT_INSTRUCTIONS), surfacing checkpoints/partials before the real write. That preview step is the natural place to catch an assumed quantity.

## Goals / Non-Goals

**Goals:**
- The per-need quantity path (`menu_needs[].quantity`) works.
- A defaulted package count is *visible*, so recipe-derived produce isn't silently undercounted.
- Keep the tool deterministic; keep produce/portion judgment with the LLM.

**Non-Goals:**
- Tool-side "by-the-each produce" classification (from `size`/PLU) or any portion math — the no-portion-tracking stance holds.
- A hard blocking checkpoint — the soft, non-blocking flag was chosen.
- Treating `grocery_list` string `quantity` as a package count.

## Decisions

### D1: Honor `menu_needs[].quantity`; the `quantities` map overrides it

Precedence per normalized name: explicit `quantities[name]` (the disposition override) → else `menu_needs[].quantity` → else default 1. When several menu needs merge to one name, take the **max** quantity (safer against undercount). A non-positive value is treated as not-supplied (matches the existing `q > 0` guard). The `quantities` map stays the override channel used by the place-for-real call after a preview disposition; `menu_needs[].quantity` becomes the ordinary way to state a need's count.

### D2: `assumed_quantity` is a deterministic fact, not a produce verdict

Each `ToBuyItem`/`ResolvedLine` gains `assumed_quantity: boolean` = `true` iff no numeric package count was supplied from either source (the line fell back to 1). The tool reports *only* this fact. It deliberately does **not** infer "by-the-each produce" from `size` strings (noisy: PLUs are often `null`/"each"/"1 ct"; bulk-by-lb and single-count packaged goods collide) — that classification is the LLM's job. This mirrors the Change 08 freshness split: the tool surfaces the metadata, the LLM decides which items warrant action. Over-flagging is cheap because the flag is informational at preview, not a block.

**Alternative considered — tool flags by-the-each produce and/or blocks:** rejected. Detection is heuristic, it can't compute the right count anyway (the agent must read the recipe), and a hard block over-prompts on the abundant produce that needs exactly 1.

### D3: Soft surfacing over a blocking checkpoint

`assumed_quantity` is non-blocking. The undercount is caught by the *existing* `preview=true` step plus AGENT_INSTRUCTIONS discipline: the agent inspects assumed-quantity lines at preview, reads the recipe for any by-the-each produce, and sets explicit quantities (via `menu_needs[].quantity` or the `quantities` map) before the real flush. This blocks the undercount without a new checkpoint kind and without prompting on legitimately-single produce.

### D4: `grocery_list` string quantity stays a need-annotation

No conflation: the list's `quantity` ("2 lbs") remains human-readable need context, never reinterpreted as a package count. List-only items with no numeric override are `assumed_quantity: true` like any other default.

## Risks / Trade-offs

- **Soft flag relies on the agent acting on it** → mitigated by the AGENT_INSTRUCTIONS change making preview-reconciliation explicit for by-the-each produce, and by the flag being right where the agent already looks (preview).
- **Over-flagging packaged goods that need 1** → acceptable; the flag is informational, and the LLM ignores assumed-quantity lines that obviously need a single package.
- **`max` on merged menu needs could over-buy** if two recipes genuinely want different counts of the same item → rare; over-buy is the safer error than undercount for fresh produce, and the agent sees the assumption at preview regardless.

## Migration Plan

1. `computeToBuy`: quantity precedence (`quantities` > `need.quantity` > 1) + `assumed_quantity`; thread it onto `ResolvedLine` and the result.
2. Tests: `menu_needs.quantity` honored; `quantities` map overrides it; `assumed_quantity` true when defaulted / false when supplied.
3. `docs/TOOLS.md` + `AGENT_INSTRUCTIONS.md` updates.
4. Additive field → backward-compatible; CD deploys on push to `worker/**`. Rollback = revert; no data migration.

## Open Questions

- Should a future iteration let `menu_needs[].quantity` accept the recipe's stated amount string (e.g. "4") and parse it, or keep it a strict package-count number? Current decision: strict number; string-amount parsing stays out of scope (the LLM converts a recipe amount to a package count).

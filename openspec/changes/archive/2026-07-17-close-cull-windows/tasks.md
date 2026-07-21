# Tasks — close-cull-windows

## 1. Alias closure

- [x] 1.1 `packages/worker/src/write-tools.ts`: `toggle_favorite`/`toggle_reject` re-register app-plane-only (`registerAppTool`, `_meta.ui.visibility: ["app"]`); behavior/handlers unchanged (the recipe-card bridge calls them).
- [x] 1.2 `packages/worker/src/grocery-tools.ts`: unregister the `add_to_grocery_list`/`remove_from_grocery_list` aliases; delete the old single-patch `update_grocery_list` shape-detection branch (retired shape → `malformed_data` naming the ops form).
- [x] 1.3 Unregister the `list_guidance` alias (`tools.ts`/`guidance.ts`).

## 2. Shim closure

- [x] 2.1 `packages/worker/src/cooking-write.ts`: `type: "ready_to_eat"` → `validation_failed` (narrow the zod enum / drop the conversion branch); historical-row read semantics untouched.
- [x] 2.2 `packages/worker/src/meal-plan-proposal-tool.ts` + `meal-plan-widget.ts`: remove `new_for_me` from the input schema (unknown-key rejection).

## 3. Tests

- [x] 3.1 Gating matrix: the three closed aliases absent from every plane's list except the toggle pair present app-plane-only; member model-visible set matches the enumeration with no alias names.
- [x] 3.2 Rejections: old single-patch grocery form → `malformed_data`; `log_cooked` `ready_to_eat` → `validation_failed` (update the shim tests); `new_for_me` → unknown-key/schema rejection.

## 4. Docs + verification

- [x] 4.1 `docs/TOOLS.md`: remove the three fusion-alias rows + their removal-condition paragraph + the `log_cooked` shim row + the `new_for_me` row; the registration-model alias sentence and any "for one window" mentions of these names go; note the toggle pair as app-plane ops beside the grocery snapshot family.
- [x] 4.2 `aube run typecheck`; worker suite; plugin `--check` + tests (persona unchanged); `openspec validate close-cull-windows --strict`; archive AFTER single-slot-discovery archives.

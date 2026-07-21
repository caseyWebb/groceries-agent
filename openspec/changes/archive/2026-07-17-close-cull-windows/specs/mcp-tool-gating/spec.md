# mcp-tool-gating — delta

## MODIFIED Requirements

### Requirement: The member surface is the enumerated target set

A member connector's model-visible surface SHALL be exactly: reads `read_user_profile`, `read_pantry`, `read_to_buy`, `read_meal_plan`, `search_recipes`, `read_recipe`, `read_recipe_notes`; engine `propose_meal_plan`; widgets `display_recipe`, `display_meal_plan`, `display_grocery_list`; writes `update_meal_plan`, `update_pantry`, `update_grocery_list`, `log_cooked`, `set_recipe_disposition`, `add_recipe_note`, `add_meal_vibe`, `import_recipe`, `add_store`, `add_store_note`; config `update_preferences`, `update_taste`, `update_diet_principles`; signals `list_new_for_me`, `retrospective`; narration `read_guidance`; escape `report_bug` — plus the Kroger-gated and Instacart-gated sets when configured, plus any registrations owned by other in-flight changes (the ready-to-eat tools until `remove-ready-to-eat` lands; the `add_night_vibe`-family aliases until `remove-meal-dimension-shims` closes). This enumeration is the acceptance fixture: a live member session's tool list SHALL match it.

#### Scenario: The live tool list is the acceptance fixture

- **WHEN** the deployed Worker serves a member MCP session on a Kroger-configured deployment
- **THEN** the model-visible tool list equals the member base set plus the five Kroger-gated tools (and the Instacart tool when configured), with no extras beyond the documented in-flight and alias registrations

## REMOVED Requirements

### Requirement: One-window dispatch aliases cover only semantics-identical fusions

**Reason**: the operator waived the cull's deprecation windows (three-member deployment, operator-assisted migration); the aliases are removed rather than window-gated.

**Migration**: stale callers receive unknown-tool rejections and are hand-migrated; the toggle pair's app-plane destination ships in the ADDED requirement.

## ADDED Requirements

### Requirement: The fusion windows are closed

The cull's one-window dispatch aliases SHALL be closed (operator-waived — a three-member deployment with operator-assisted migration): `add_to_grocery_list`, `remove_from_grocery_list`, and `list_guidance` SHALL NOT be registered on any plane (a stale call receives the generic unknown-tool rejection), and `toggle_favorite`/`toggle_reject` SHALL register **app-plane-only** (`_meta.ui.visibility: ["app"]` — the recipe-card widget calls them by name; they never appear model-visible). Every other removed tool remains a hard removal with no shim. The deprecation convention itself is unchanged for future changes; this closure is a recorded operator waiver, not a repeal.

#### Scenario: A closed alias is an unknown tool

- **WHEN** a stale caller invokes `add_to_grocery_list`, `remove_from_grocery_list`, or `list_guidance`
- **THEN** the call receives the generic unknown-tool rejection

#### Scenario: The toggle pair serves the widget only

- **WHEN** the recipe-card widget calls `toggle_favorite` through the app bridge and a member session lists tools
- **THEN** the call succeeds and neither toggle name appears in the model-visible list

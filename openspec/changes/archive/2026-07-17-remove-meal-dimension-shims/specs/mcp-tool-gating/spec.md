# mcp-tool-gating — delta

## MODIFIED Requirements

### Requirement: The member surface is the enumerated target set

A member connector's model-visible surface SHALL be exactly: reads `read_user_profile`, `read_pantry`, `read_to_buy`, `read_meal_plan`, `search_recipes`, `read_recipe`, `read_recipe_notes`; engine `propose_meal_plan`; widgets `display_recipe`, `display_meal_plan`, `display_grocery_list`; writes `update_meal_plan`, `update_pantry`, `update_grocery_list`, `log_cooked`, `set_recipe_disposition`, `add_recipe_note`, `add_meal_vibe`, `import_recipe`, `add_store`, `add_store_note`; config `update_preferences`, `update_taste`, `update_diet_principles`; signals `list_new_for_me`, `retrospective`; narration `read_guidance`; escape `report_bug` — plus the Kroger-gated and Instacart-gated sets when configured, plus any registrations owned by other in-flight changes (the ready-to-eat tools until `remove-ready-to-eat` lands). This enumeration is the acceptance fixture: a live member session's tool list SHALL match it.

#### Scenario: The live tool list is the acceptance fixture

- **WHEN** the deployed Worker serves a member MCP session on a Kroger-configured deployment
- **THEN** the model-visible tool list equals the member base set plus the five Kroger-gated tools (and the Instacart tool when configured), with no extras beyond the documented in-flight and alias registrations

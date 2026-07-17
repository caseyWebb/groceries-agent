# single-slot-discovery

## Why

New discoveries are taking over the week: every resolvable `new_for_me` slug force-places (above overdue vibes), and the agent both reads `list_new_for_me` at plan time and authors discoveries into the week — so a productive sweep floods a proposal. Discovery placement should be engine-internal (like weather and at-risk pantry already are), lower priority than the palette's own overdue debt, and capped at one slot.

## What Changes

- **BREAKING (engine behavior)** — the palette path derives its discovery seed **internally**: `runProposeMealPlan` reads the caller's new-for-me set (the same op behind `list_new_for_me`) and places **at most one** discovery, the most recent resolvable one (visible, embedded, not rejected/excluded/locked). The ephemeral path stays discovery-free (caller-authored weeks are never seeded uninvited).
- **BREAKING (priority)** — the discovery tier moves **below overdue** in `sampleWeek` (pinned → overdue → discovery → sampled): a week whose slots are claimed by overdue vibes carries no discovery, instead of discoveries displacing the palette's debt.
- **`new_for_me` is retired from the request contract** — accepted and ignored for one deprecation window (the `nights`-alias posture: no error, no effect; a docs/TOOLS.md Deprecations row), then rejected as an unknown key. Applies to `propose_meal_plan` and `display_meal_plan` (shared shape).
- **The persona's plan flow stops reasoning about discoveries**: `list_new_for_me` leaves the plan skill's context reads and the fold-in guidance; the tool itself stays on the surface for conversational "anything new for me?" asks.
- Docs follow (`docs/TOOLS.md`: both tool sections, the `list_new_for_me` section's plan-time note, the Deprecations row).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `weather-bucket-planning` — the force-placement tier: internal derivation, single seed, below-overdue priority.
- `meal-plan-proposal` — `new_for_me` retired from the retained-params list (accept-and-ignore window); the ephemeral-inertness requirement restated over internal derivation.

## Impact

- `packages/worker/src/night-vibe-schedule.ts` (`sampleWeek` tier order + comments), `packages/worker/src/meal-plan-proposal-tool.ts` (internal derivation via `readNewForMe`, single-seed cap, param accept-and-ignore), `packages/plugin/AGENT_INSTRUCTIONS.md` (plan steps 1–2) → plugin republish on deploy (census unchanged).
- Tests: sampler tier-order + cap; internal-derivation path (palette vs ephemeral); param-ignored assertion; persona build `--check`.
- Docs: `docs/TOOLS.md`. No migrations, bindings, or routes.

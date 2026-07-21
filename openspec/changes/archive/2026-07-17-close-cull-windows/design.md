# close-cull-windows — design

## Context

The cull's shims exist to keep stale plugin bundles working across the marketplace re-pull lag. This deployment has three members, all reachable by the operator, all on the republished bundle; the windows protect no one.

## Goals / Non-Goals

**Goals:** the model surface equals the target enumeration exactly — no aliases, no conversion shims from the cull. **Non-Goals:** `remove-meal-dimension-shims` (its column drops are data-convergence-gated: the retired `lunch_strategy`/`ready_to_eat_default_action` pair must be verified NULL across production D1 before the frozen columns drop — a production check, not a waiver); any behavior change beyond removals.

## Decisions

- **Toggle pair flips to app-plane, not deletion** — the recipe-card widget calls `toggle_favorite`/`toggle_reject` through the bridge (D18); this was always the window-close destination per the gating spec. *Alternative rejected:* migrating the widget to `set_recipe_disposition` — a widget-contract change for zero behavioral gain.
- **Waiver is operator-scoped, recorded here** — the deprecation convention stays the repo's default for future changes; this change closes specific named windows on the operator's explicit call, it does not repeal the convention.
- **`new_for_me` closes in the release it opened** — `single-slot-discovery` ships the accept-and-ignore posture its spec promised; this change (same PR, ordered after) supersedes it to unknown-key. The archive order records the sequence honestly.

## Risks / Trade-offs

- [A member on a genuinely stale bundle] → three known members, operator-assisted; the failure mode is a clear unknown-tool/validation error, not silent misbehavior.

## Migration Plan

Worker deploy ships the removals; the already-current plugin references only fused names. Rollback = revert.

## Open Questions

None.

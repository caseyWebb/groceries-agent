# single-slot-discovery — design

## Context

Discovery placement is currently caller-fed (`new_for_me` slugs), placed above overdue vibes, uncapped. The sweep imports generously, so palette weeks skew toward discoveries; the agent's plan flow also reads and folds discoveries, doubling the pressure.

## Goals / Non-Goals

**Goals:** discoveries season a week, never drive it — one slot, after the palette's debt is honored; zero agent reasoning at plan time. **Non-Goals:** changing the sweep, `list_new_for_me`'s contract, or ephemeral-path semantics (authored weeks stay fully caller-owned).

## Decisions

- **Internal derivation, palette path only** — `runProposeMealPlan` calls `readNewForMe` (the `list_new_for_me` op, same recency window) when no ephemeral set drives, takes the first slug that resolves through the existing candidate rules (visible, embedded, not rejected/excluded/locked), and passes ≤1 seed to `sampleWeek`. *Alternative rejected:* keeping the param with a server-side cap — leaves the agent in the loop and two sources of truth for "what's new."
- **Cap at the derivation site, priority in the sampler** — `sampleWeek` stays generic (places the seeds it's given, in order); its discovery block moves below the overdue block, so overdue quota math runs over post-pinned slots and the seed ledger runs over post-overdue remainder. The rollover/bucket-quota semantics carry unchanged.
- **`new_for_me` retires accept-and-ignore** (the `nights` posture — the tool carries no `warnings` array and a read-shaped call needs no steering write): present ⇒ ignored without error for one window, then unknown-key rejection. A stale plugin's palette-path call gets the internally derived seed anyway — strictly better behavior than what it asked for.

## Risks / Trade-offs

- [A member who loved discovery-heavy weeks] → the palette's own vibes now win; discoveries remain one slot per proposal and fully available via search/locks; the web app's propose surface behaves identically (shared op).
- [Sampler surgery] → tier move is mechanical; the existing quota/rollover tests pin bucket behavior and gain tier-order cases.

## Migration Plan

Worker deploy ships engine + shim; plugin republish ships the persona. Rollback = revert.

## Open Questions

None.

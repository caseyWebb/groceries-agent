## ADDED Requirements

### Requirement: Deterministic cadence-tighten proposals

The deterministic signal pass SHALL draft a **tighten** proposal — the sibling of the existing defer-driven stretch — for a cadence vibe the member repeatedly satisfies well before its stated period: given the vibe's satisfaction dates (slot provenance from the cooking log), when the vibe has at least three satisfactions, each of its two most recent satisfaction intervals is at most half its `cadence_days`, and the vibe is currently on-track (days since last satisfied are under one period), the pass SHALL draft an `adjust_cadence` proposal suggesting the observed interval (the rounded mean of those recent intervals, floored at 3 days), and only when the suggestion is strictly below the current cadence. Tighten SHALL reuse the existing `adjust_cadence` kind, queue, stable-id dedupe (value-bucketed, so a rejected tighten near the same value is not re-surfaced while a materially different later suggestion is a new proposal), confirmation, and apply path — no new consumer surface — with the direction expressed in the rationale and the observed intervals in the evidence. Tighten and stretch SHALL be mutually exclusive for one vibe in one pass by construction (stretch requires the current interval to run long; tighten requires on-track). Like every deterministic signal, it SHALL draft with no model call and write nothing without member confirmation.

#### Scenario: Repeated early satisfaction proposes a tighter cadence

- **WHEN** a vibe with `cadence_days: 14` has been satisfied three times with its last two intervals at 6 and 7 days and is currently on-track
- **THEN** the pass drafts an `adjust_cadence` proposal suggesting ~7 days, with the observed intervals in its evidence, and writes nothing to the palette

#### Scenario: An overdue vibe is never tightened

- **WHEN** a vibe's historical intervals were tight but its current interval since last satisfaction has exceeded its cadence
- **THEN** no tighten proposal is drafted for it

#### Scenario: A rejected tighten is not re-surfaced

- **WHEN** a member rejects a tighten proposal and the next signal pass observes the same behavior
- **THEN** the re-drafted proposal resolves to the same stable id and is not re-enqueued, while a later, materially different suggested cadence yields a new proposal

#### Scenario: Accepting a tighten uses the existing apply path

- **WHEN** a member accepts a tighten proposal from either surface
- **THEN** the existing `adjust_cadence` apply updates the vibe's `cadence_days` to the suggested value, with no tighten-specific apply logic

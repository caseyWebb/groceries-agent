# ingredient-normalization

## ADDED Requirements

### Requirement: Identity-keyed food-category memo with scheduled convergence

The system SHALL memoize a food category per canonical ingredient identity — a nullable
`category` column on `ingredient_identity` holding one of the controlled food taxonomy
(`produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices |
baking | frozen | snacks | beverages`) or `household` (the non-food catch-all, so
classification always terminates and no identity is permanently unmappable). The memo is the
ONE deterministic item→department derivation source (DECISIONS.md D17): pantry category
autofill, waste-event department stamping, and the sibling spend-capture change SHALL all read
it through the identity funnel (surface form → canonical id → representative → category),
never re-deriving per surface. A dedicated scheduled job (`ingredient-category`) SHALL
converge it in bounded, idempotent phases per tick: (1) classify unclassified concrete
survivor identities in batched model calls routed through the `runAi` gateway under a
dedicated `AiActivity`, leaving NULL on a transient failure or unparseable answer for retry;
(2) fill NULL pantry `category` values from the memo — writing only food-taxonomy values and
NEVER overwriting a non-NULL (member-set values are pinned); (3) stamp NULL (`pending`)
waste-event `department` values from the memo — a NULL→value fill only, never rewriting a
stamped department. The job SHALL self-terminate to a cheap no-op once the backlog drains, and
SHALL record `job_health` and `job_runs` under its own name like every scheduled job.

#### Scenario: An identity is classified once and reused everywhere

- **WHEN** the identity `cilantro` is classified `produce` by the scheduled pass
- **THEN** every subsequent capture-time stamp and autofill for any surface form resolving to
  `cilantro` reads `produce` from the memo with no further model call

#### Scenario: The pantry backfill never clobbers a member-set category

- **WHEN** the backfill phase runs over a pantry row whose `category` is already `condiments`
- **THEN** the row is untouched, even if the identity memo disagrees

#### Scenario: A pending waste event is stamped on a later tick

- **WHEN** a waste event was captured with `department` NULL because its identity was not yet
  classified, and the identity classifies on a later tick
- **THEN** that event's `department` is filled from the memo exactly once and is never
  rewritten thereafter

#### Scenario: Non-food identities terminate as household

- **WHEN** the classifier evaluates a non-food identity (e.g. a stray kitchen-supply item)
- **THEN** it memoizes `household` — the identity leaves the backlog, the pantry row's
  `category` stays NULL (the pantry vocabulary is food-only), and a waste event for it stamps
  `household`

#### Scenario: The job self-terminates

- **WHEN** every concrete survivor identity carries a category and no NULL pantry categories
  or pending events remain resolvable
- **THEN** a tick performs no model calls and no writes, recording a no-op run

# weather-bucket-planning — delta

## MODIFIED Requirements

### Requirement: Force-placement respects bucket quotas without producing mismatches

Pinned night vibes SHALL remain force-placed regardless of weather category, as today. **The new-for-me discovery seed** SHALL be derived **engine-internally** on the palette path — `runProposeMealPlan` reads the caller's new-for-me set (the same operation behind `list_new_for_me`) and seeds **at most one** discovery, the most recent one that resolves under the existing candidate rules (visible, embedded, not rejected, excluded, or locked) — and SHALL be force-placed as a tier **below pinned and below overdue**: the palette's own debt claims its slots first, and the discovery claims one remaining slot within its weather-bucket quota (falling to a flex/`mild` slot when its bucket has none), rolling over rather than force-placing into a contradicting bucket or an already-full week. This placement is a **palette-path** mechanism; when a caller-authored ephemeral vibe set drives the week, no discovery is seeded (see `meal-plan-proposal`). An overdue night vibe (per the existing `forceDueAt` tier) SHALL still be eventually force-placed once sufficiently overdue, but an overdue vibe whose bucket's category has a zero quota for the current planning window SHALL roll over rather than being opportunistically force-placed into a slot outside its bucket, unless and until it crosses the existing overdue escape hatch. Discovery placement SHALL obey the same rule — it SHALL NOT place a discovery into a slot whose bucket its facets contradict. Force-placement SHALL remain seed-deterministic and SHALL NEVER produce an empty slot for lack of a weather-matching vibe.

#### Scenario: A pinned vibe is force-placed regardless of weather

- **WHEN** a pinned vibe's weather category has no quota in the window
- **THEN** the pinned vibe is still force-placed, as today

#### Scenario: One discovery seasons a week after the palette's debt is honored

- **WHEN** the palette path proposes a week while the caller's new-for-me set holds several resolvable discoveries and some slots remain after pinned and overdue placement
- **THEN** exactly one discovery — the most recent resolvable one — claims a remaining slot within its weather-bucket quota, and the rest of the new-for-me set places nothing

#### Scenario: A debt-saturated week carries no discovery

- **WHEN** pinned and overdue vibes consume every slot of the week
- **THEN** the internally derived discovery rolls over — it never displaces an overdue vibe

#### Scenario: A discovery with no matching quota rolls over rather than mismatching

- **WHEN** the derived discovery's bucket has a zero quota for the window and no flex/`mild` slot exists
- **THEN** it rolls over — it is never force-placed into a contradicting bucket, and no slot is left empty for it

#### Scenario: An overdue vibe outside its bucket quota rolls over

- **WHEN** an overdue vibe's weather category has a zero quota for the current window and it has not crossed the overdue escape hatch
- **THEN** it rolls over rather than being force-placed into a slot outside its bucket

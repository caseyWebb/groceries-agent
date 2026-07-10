# data-write-tools

## ADDED Requirements

### Requirement: Pantry rows carry orthogonal location and category vocabularies

Pantry rows SHALL carry two orthogonal, controlled-vocabulary fields: `location` — where the
item is kept (`fridge | freezer | pantry | spice_rack | counter | cabinet`) — and `category` —
the food taxonomy (`produce | dairy | meat | seafood | grains | bakery | canned | condiments |
oils | spices | baking | frozen | snacks | beverages`). Both are optional on write and nullable
in storage; readers SHALL treat NULL as unassigned/uncategorized, never an error (a NULL
`category` is filled over time by the identity-keyed classification pass, never blocked on).
Write validation SHALL run in the shared pantry apply operation so the MCP tool and the `/api`
pantry area enforce identical rules: an off-vocabulary `location` is a per-op **conflict**,
never a silent write; a legacy location-flavored `category` value
(`pantry | fridge | freezer | spices`) is **transposed onto `location`** (category left unset)
for one deprecation window; any other off-vocabulary `category` is **accepted-and-dropped** —
the operation applies with `category` stored NULL and a `warnings` entry
(`{ op, name, field, reason }`) reporting the drop — never a `validation_failed`, so a stale
plugin or the shipped app's free-text writes keep working while the classifier converges the
NULL.

#### Scenario: A legacy category write is transposed onto location

- **WHEN** `update_pantry` applies `{ op: "add", item: { name: "peas", category: "freezer" } }`
  during the deprecation window
- **THEN** the row is stored with `location: "freezer"` and `category` NULL, and the op reports
  applied

#### Scenario: An off-vocabulary location is a conflict, never a silent write

- **WHEN** an add carries `location: "garage"`
- **THEN** that operation is reported as a conflict naming the field and the row is not
  written with an off-vocabulary location

#### Scenario: An off-vocabulary category is accepted-and-dropped with a warning

- **WHEN** an add carries `category: "other"` (the shipped app's free-text default)
- **THEN** the op applies, the stored `category` is NULL, and the result's `warnings` names
  the dropped field — the write is never rejected for it

### Requirement: Pantry removal by disposition captures waste events and never asks value

`update_pantry` (and the `/api` pantry ops route, through the same shared operation) SHALL
support a `dispose` operation — `{ op: "dispose", name, disposition: "used" | "waste",
reason?, event_id?, occurred_at? }` — that removes the named row. `disposition: "used"`
(consumed) SHALL be pure removal recording nothing. `disposition: "waste"` SHALL additionally
persist exactly one row in the per-tenant `waste_events` table carrying: the event id
(client-minted idempotency key when supplied — the member app mints a ULID at tap time;
server-minted when absent), the row's display name and stored canonical ingredient id, its
`prepared_from` and loose `quantity` snapshots, `occurred_at` (caller-stamped ISO date,
defaulting to today), the `reason`, and the analytics `department` stamped at capture with the
precedence: `prepared_from` rows → `leftovers`; else the row's in-vocabulary `category`; else
the ingredient-identity category memo; else NULL (pending), filled once by the classification
pass and NEVER rewritten after it is set. `reason` SHALL be required for `waste` and SHALL be
one of the single canonical enum `spoiled | moldy | over_ripe | expired | freezer_burned |
stale | forgot | bought_too_much | never_opened | other`; shape violations (missing
disposition, waste without reason, unknown reason, malformed event id or date) are
`validation_failed`. The operation SHALL accept **no value, price, or cost input of any kind**,
and the tool description SHALL state that value is never asked at capture (it is derived later
from spend history). A `dispose` whose `event_id` already exists SHALL report applied and
write nothing (replay convergence); a `dispose` of an absent row with an unknown event id is a
per-op conflict. The row delete and event insert SHALL ride one D1 batch, written through the
`src/db.ts` helpers (structured `storage_error`, no throws). The plain `remove` op SHALL
remain, recording nothing — corrections and cleanup are not waste.

#### Scenario: A waste disposition removes the row and records one event

- **WHEN** `update_pantry` applies `{ op: "dispose", name: "cilantro", disposition: "waste",
  reason: "over_ripe" }` for a non-prepared row whose category is `produce`
- **THEN** the pantry row is deleted and one `waste_events` row exists with
  `department: "produce"`, the row's canonical id, the reason, and a server-minted event id

#### Scenario: A replayed offline waste disposition converges to one event

- **WHEN** a dispose with client-minted `event_id` "01J…" is delivered, and the same
  operation is replayed after reconnect
- **THEN** exactly one `waste_events` row exists under `(tenant, "01J…")` and the replay
  reports applied, not a conflict

#### Scenario: A tossed leftover stamps the leftovers department

- **WHEN** a row with `prepared_from: "salmon-with-rice"` is disposed as waste
- **THEN** its event's `department` is `leftovers`, regardless of any category on the row

#### Scenario: Used is pure removal

- **WHEN** `{ op: "dispose", name: "eggs", disposition: "used" }` is applied
- **THEN** the row is removed and no `waste_events` row is written

#### Scenario: Value is never asked

- **WHEN** the dispose operation's input schema and tool description are inspected
- **THEN** no value/price/cost parameter exists and the description states value is derived
  from spend history later, never prompted for at capture

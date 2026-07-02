# operator-admin — delta for audit-pass-card-burndown

## MODIFIED Requirements

### Requirement: Normalize area has an Audits tab showing audit convergence

The Normalize area SHALL have an **Audits** sub-nav tab (deep-linkable by query param) presenting the self-healing audit pipeline as a convergence surface, server-rendered with no client JS. It SHALL show: (1) a **backlog-burndown hero** with the live count of unaudited alias rows and unaudited edge rows (`source='auto' AND audited_at IS NULL`), each with a short recent burndown series derived from the audit jobs' run history; (2) **pass cards** — alias audit, edge audit, sku-cache re-key, and a compact disjunction-sweep card — each with its latest-run summary counts from the job's `job_runs` summary, a per-tick worked-rows sparkline (audit passes), and **its own burndown status**: the pass's remaining-backlog count, a compact burndown-trend sparkline, and a converging/converged state chip driven by that backlog (converged = the green positive terminal state); (3) a **restorations log** of `edge_restore` decisions, each linking the origin decision it revisits (via the structured `replay_of` detail); and (4) a **merge-rejection table** over `ingredient_coresolution_rejection` (pair, rejected-at, backoff expiry). A fully drained backlog (both counts zero) SHALL render as a **positive terminal state** (green, "holds at zero" language) — never as a dead zero or a failure.

Per-pass burndown semantics: the **alias** and **edge** cards SHALL reuse the hero's live unaudited counts and back-summed series (no re-query). The **edge** card SHALL additionally surface the one-shot replay's state from the un-replayed `edge_drop` backlog (a SQL-bounded probe re-validated by the replay's own selection predicate, display-capped): a pending count while drops await replay, and an explicit done-state at zero. The **sku-cache re-key** card (stampless) SHALL gauge its backlog as the live plan size — pending re-key groups plus eligible alias retargets from the pass's own pure planners over current resolver state — rendered with a capped overflow display (e.g. "200+") and never an unbounded number. The **disjunction-sweep** card SHALL show the live count of concrete disjunctive ids the sweep will actually flip/fold — the sweep's quiesce predicate mirrored at family level (human rows and human-pinned families excluded, bases merged elsewhere not counted), so the count reaches zero exactly when the sweep quiesces — burning to zero, with a trend back-summed from the normalize job's persisted `disjunction*` run counters and the latest run's counters as summary chips; it SHALL NOT alter the hero's or the Status row's converged semantics (those remain alias+edge only).

#### Scenario: Draining backlog renders as converging

- **WHEN** unaudited alias or edge rows remain
- **THEN** the Audits tab shows the live per-table counts with a falling burndown series and "draining" language, and each affected pass card shows its latest-run summary counts, its own remaining-backlog count and trend, and a converging-state chip

#### Scenario: Cleared backlog renders green, not dead

- **WHEN** both unaudited counts are zero
- **THEN** the hero renders the converged (green/positive) state with "holds at zero" language, and the pass cards whose backlog is zero render the converged (green positive) chip and zero-floor treatment

#### Scenario: A pass card carries its own burndown status

- **WHEN** a pass has remaining backlog (an unaudited alias/edge row backlog, or a non-empty sku live plan)
- **THEN** that pass's card shows the remaining count, a compact burndown sparkline of its recent trend, and the converging chip — while a sibling pass with zero backlog simultaneously shows the converged chip

#### Scenario: Edge card surfaces the replay state

- **WHEN** un-replayed pre-calibration `edge_drop` rows remain
- **THEN** the edge audit card shows the pending replay count (capped display); **WHEN** none remain **THEN** it shows the replay done-state

#### Scenario: Disjunction sweep card burns to zero

- **WHEN** live concrete disjunctive ids remain
- **THEN** the disjunction-sweep card shows the live count with converging language; **WHEN** the count is zero **THEN** the card renders the converged state with the normalize job's latest disjunction counters as chips

#### Scenario: A restoration links back to its origin decision

- **WHEN** an `edge_restore` log row carries a `replay_of` reference to the original `edge_drop` decision
- **THEN** the restorations log renders the restored edge with its verdict and a pointer to the origin decision id

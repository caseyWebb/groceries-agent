# Proposal: audit-pass-card-burndown

## Why

The Audits tab's three pass cards show this-tick activity only (worked/changed spark + latest summary chips); the burndown status — how much backlog each pass still has and whether it has converged — lives only in the aggregate hero above them. The operator wants each pass card to carry its own current burndown status, and the cards to reflect what the passes now do after the replay/structural counters (#192) and the disjunction sweep landed.

## What Changes

- **Per-pass burndown on every pass card**: remaining backlog count, a recent-trend mini burndown sparkline (reusing the hero's `BurndownSpark` component and `au-*` vocabulary), and the pass's own converging/converged state chip (converged = the green positive terminal state, same two-state language as the hero and the reconcile cards).
  - **alias audit card**: un-audited alias rows + the back-summed series already computed for the hero (reused, not re-queried) + state.
  - **edge audit card**: un-audited edge rows + series + state, plus the one-shot replay's done-state (un-replayed `edge_drop` backlog, cheaply counted).
  - **sku-cache re-key card**: this pass is stampless — its backlog is the live plan size (sku groups whose resolution differs + eligible alias retargets), gauged by a cheap bounded read with capped overflow display.
- **Disjunction convergence status**: a compact fourth mini-card in the pass grid showing the live-concrete-disjunctive-id count burning to zero (the shape sweep's own quiesce predicate), driven by the normalize job's `disjunction*` run summaries for its trend.
- **Reader extension** (`audit-admin.ts`): `AuditPass` grows per-pass backlog/series/state; new bounded gauges for the sku plan size, the replay backlog, and the disjunction count. Display-side only — no job summary shapes change, no new D1 columns.
- **Playwright**: NormalizePage audits methods + seed fixtures extended so each card's burndown state is asserted (at least one converging pass and one converged pass); screenshots regenerated.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `operator-admin`: the Normalize › Audits tab requirement — pass cards additionally carry their own backlog burndown status (count + trend + state), the edge card surfaces the replay backlog, the sku card a bounded live-plan gauge, and the pass grid gains the disjunction-convergence mini-card.

## Impact

- `packages/worker/src/audit-admin.ts` — reader/derivation extension (new fields on `AuditPass`, new bounded reads).
- `packages/worker/src/admin/pages/audits.tsx` — pass-card rendering (SSR only, existing `au-*` classes; no new colors/primitives, no client JS).
- `packages/worker/src/admin/styles.css` — only if a small layout rule is genuinely missing for the per-card burndown row.
- `packages/worker/admin/visual/` — NormalizePage page-object methods, seed fixtures, normalize spec, regenerated screenshots.
- `packages/worker/test/audit-admin.test.ts` — unit coverage for the new derivations.
- Docs: none expected — `docs/SCHEMAS.md` untouched unless a summary shape changes (it does not; this is reader/display-side).

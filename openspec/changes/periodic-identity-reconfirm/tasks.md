# Tasks

## 1. Schema + eligibility

- [ ] 1.1 Migration: add `reconfirmed_at INTEGER` (nullable) to `ingredient_identity`. No other shape change.
- [ ] 1.2 `src/corpus-db.ts`: `readReconfirmBatch(env, limit)` — select eligible nodes (`source='auto' AND concrete=1 AND reconfirmed_at IS NULL` AND no row in `ingredient_edge` with the id as `from_id` or `to_id`), oldest `decided_at` first, plus their stored embedding. `stampReconfirmed(env, id, now)` sets `reconfirmed_at`. Both throw-mapped through `db()`.

## 2. The re-confirm pass

- [ ] 2.1 `src/ingredient-reconfirm.ts` — `reconfirmIdentities(deps)` mirroring `reconcileNormalization`: drain a bounded batch, retrieve nearest neighbors per node (cosine over the identity embeddings, excluding self), run `confirmIdentity`, and apply:
  - proposed edges → commit (additive only);
  - `same` → `mergeIdentities(loser=node, survivor=match)` (conservative; never a human loser);
  - `specialization` → add a `general` edge to the matched base if it's a known node; do NOT change the node's id;
  - `novel` → commit any edges only.
  Stamp `reconfirmed_at` after each node. Bounded by `RECONFIRM_MAX_PER_TICK`.
- [ ] 2.2 Failure handling: a transient `env.AI`/D1 error skips the node leaving the stamp null (retried next tick), no partial write; a contract-invalid confirm fails safe to no-op (stamp, change nothing). Reuse the capture job's structured-error discipline.
- [ ] 2.3 `runReconfirmJob` + `buildReconfirmDeps` (mirror `runNormalizeJob`): record the `ingredient-reconfirm` `job_health` + `job_run` rows with a `{ reconfirmed, edges_added, merged, still_novel }` summary; rethrow so the platform cron status reflects a failure.
- [ ] 2.4 Log each decision to `ingredient_normalization_log` with a marker distinguishing a re-confirm from an initial capture (a dedicated outcome-variant or boolean column — pick the lower-churn option and reflect it in `readNormalizationPage`'s `DecisionKind`).

## 3. Wire + tests

- [ ] 3.1 Wire `runReconfirmJob(env, buildReconfirmDeps(env))` into `scheduled()` Phase 1 (after the capture pass, so it sees the freshest registry), in the existing `Promise.allSettled`.
- [ ] 3.2 Unit tests (`test/ingredient-reconfirm.test.ts`, harness like `ingredient-normalize.test.ts`): an edgeless auto node gains a proposed edge + is stamped; a stamped/edged/human node is skipped; a `same` merges via representative (auto loser only); a transient error leaves the stamp null (retried); a contract-invalid confirm no-ops (stamped, unchanged); a `specialization` adds a general edge but does NOT change the id.
- [ ] 3.3 `readReconfirmBatch` eligibility test (edgeless + auto + concrete + un-stamped only) against the fake D1.

## 4. Observability + docs

- [ ] 4.1 Status page: the `ingredient-reconfirm` job appears in the Background jobs list (reuses `job_health`; no new page). Distinguish re-confirm decisions in the Normalization **Decisions** view per the `DecisionKind` marker.
- [ ] 4.2 **Design handoff:** the visual treatment of the re-confirm decision marker + the related Normalization-area surfaces (reconcile-observability, the node/relationship edges view) come from the companion Claude Design project as one consolidated bundle — translate that bundle into Basecoat markup rather than hand-designing here.
- [ ] 4.3 Docs: `docs/ARCHITECTURE.md` (the ingredient-normalization capture section gains the re-confirm pass — eligibility, enrich-first, one-shot/quiescent, human-immune) and `docs/SCHEMAS.md` (`ingredient_identity.reconfirmed_at` + the re-confirm log marker).

## 5. Open questions (resolve during apply or defer explicitly)

- [ ] 5.1 Re-eligibility (design D1): keep one-shot, or clear the stamp when the registry has grown by a large factor since it was set? Default one-shot; note the deferral.
- [ ] 5.2 The log marker shape (5.x above): a new `reconfirm`-flavored outcome vs a boolean `is_reconfirm` column — pick the one that least disturbs `readNormalizationPage` + the Decisions UI.

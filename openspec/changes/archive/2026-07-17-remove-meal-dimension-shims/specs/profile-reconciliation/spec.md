# profile-reconciliation — delta

## REMOVED Requirements

### Requirement: Preference retirement converges through a seeding signal producer

**Reason**: this pass existed to converge the retired `lunch_strategy` / `ready_to_eat_default_action` preferences onto seeded meal-vibe suggestions and NULL both columns — the deprecation-window column-drop gate. Tonight's operator-directed production query confirms that convergence is complete (both columns NULL on every profile row), and this change's D1 migration drops the two columns the pass's own `SELECT` names. Leaving the pass registered would fail its query (`no such column`) on every future `scheduled()` tick; the pass's own contract already promised termination once converged, and convergence is verified.

**Migration**: none needed. The pass reached its documented terminating no-op state before this change ships (converged tenants match nothing on later ticks, per its own contract), so there are no in-flight suggestions or partially-converged tenants to carry forward. `runPrefRetirementSeedJob`, its module, and its `scheduled()` registration are deleted as dead-code removal; its dedicated test (which seeds rows through the now-dropped columns) is removed with it.

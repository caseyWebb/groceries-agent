## MODIFIED Requirements

### Requirement: Shared reference data

The reference-data file `aliases.toml` SHALL live in the shared corpus and be read by all tenants. `substitutions.toml` SHALL default to the shared corpus, with an optional per-tenant override layer so a tenant can carry personal substitution rules; where a tenant override exists it SHALL take precedence over the shared rule for that tenant only. (`ingredients.toml` is removed — see the design doc and the `data-read-tools` delta; freshness is LLM-judged, not driven by a shelf-life table.)

#### Scenario: Shared aliases apply to all tenants

- **WHEN** any tenant normalizes an ingredient term
- **THEN** the shared `aliases.toml` is consulted, identically for every tenant

#### Scenario: Per-tenant substitution override wins for that tenant

- **WHEN** a tenant has a personal substitution rule for an ingredient that also has a shared rule
- **THEN** the tenant's override is applied for that tenant, while other tenants still see the shared rule

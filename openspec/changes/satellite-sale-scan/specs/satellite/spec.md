## RENAMED Requirements

- FROM: `### Requirement: The satellite declares its capabilities; recipe-scrape is the only capability`
- TO: `### Requirement: The satellite declares its capabilities; recipe-scrape and sale-scan are defined`

## MODIFIED Requirements

### Requirement: The satellite declares its capabilities; recipe-scrape and sale-scan are defined

A satellite SHALL declare one or more **capabilities** it runs, and every push or claim SHALL carry the `capability` it reports/claims under. Two capabilities are defined: `recipe-scrape` (extract functional recipe facts from an authenticated source, delivered by the satellite **pushing** observations) and `sale-scan` (observe in-store/loyalty sale prices at a store the Worker has no API for, delivered by the satellite **claiming** operator-scope work over the pull channel and reporting `sale` observations). The capability set SHALL remain a closed, extensible enumeration so a later capability can be added without redefining the envelope. The Worker SHALL reject a batch whose declared `capability` it does not implement, and the pull channel SHALL hand a satellite only task kinds matching its declared capabilities.

#### Scenario: A recipe-scrape batch declares its capability

- **WHEN** a satellite pushes recipes it extracted
- **THEN** the batch declares `capability: "recipe-scrape"` and the Worker processes it

#### Scenario: A sale-scan satellite claims and reports under its capability

- **WHEN** a satellite that declares `sale-scan` claims a `sale-scan` task and reports its scan
- **THEN** it claims and reports under the `sale-scan` capability, and the Worker processes the `sale` observations it returns

#### Scenario: An unknown capability is rejected

- **WHEN** a batch declares a `capability` the Worker does not implement
- **THEN** the Worker rejects the batch (nothing persisted) rather than guessing how to process it

### Requirement: The push wire contract is capability-tagged with observation items as a discriminated union

The push payload SHALL be a **capability-tagged batch envelope** carrying the reported `capability`, the human-readable `source` provenance, the machine's `satellite_version`, the targeted `contract_version`, and an array of **observation items**. The observation items SHALL be a **discriminated union keyed by an item `kind`**: `kind: "recipe"` for `recipe-scrape` (functional recipe facts) and `kind: "sale"` for `sale-scan` (raw store/product/`{ regular, promo }` price facts), so a later item kind can be added without breaking a consumer that handles only the existing kinds. The `contract_version` SHALL be `"v2"`. The batch envelope SHALL carry no more than `MAX_BATCH_ITEMS` observation items. The wire contract SHALL be defined once in the shared, runtime-agnostic contract package that both the Worker and the satellite import, so the shape can never drift between the two runtimes.

#### Scenario: A v2 batch is a capability-tagged discriminated union

- **WHEN** a satellite constructs a push
- **THEN** it sends `{ capability, source, satellite_version, contract_version: "v2", observations: [{ kind: "recipe", ... }, ...] }` validated against the shared contract before sending

#### Scenario: A sale observation is a defined member of the union

- **WHEN** a satellite reports a `sale` observation
- **THEN** it is a `{ kind: "sale", store, locationId, productId, description, regular, promo, ... }` member of the same discriminated union, validated against the shared contract, and a consumer that handles only `recipe` continues to validate and process `recipe` batches unchanged

#### Scenario: A new observation kind does not break existing consumers

- **WHEN** the discriminated union gains a new `kind` in a later capability
- **THEN** a consumer that handles only the prior kinds continues to validate and process batches of those kinds unchanged

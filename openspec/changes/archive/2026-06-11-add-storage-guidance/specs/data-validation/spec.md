## MODIFIED Requirements

### Requirement: Parse-check scope for data TOMLs

The system SHALL parse-check every tracked `.toml` file for validity, but SHALL NOT enforce deep schema validation on non-index data files (`pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `stockup.toml`, `feeds.toml`, `skus/kroger.toml`) beyond their being parseable. The `storage_guidance/*.md` files are prose and are not parse-checked as data (they are validated only for existence, like other curated markdown).

#### Scenario: Valid-but-sparse data TOML passes

- **WHEN** `pantry.toml` parses as valid TOML but omits fields the Worker would later expect
- **THEN** the build does not fail on that file

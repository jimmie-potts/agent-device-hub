## ADDED Requirements

### Requirement: Tidbyt storage uses SDK full-disk classification
The Tidbyt module SHALL classify storage errors with the SDK full-disk helper while preserving explicit `SdkError` codes. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL retain the existing storage-capacity diagnostic and recovery behavior.

#### Scenario: Wrapped ENOSPC while persisting a tile
- **WHEN** tile persistence fails with an error caused by `ENOSPC`
- **THEN** the module records the existing WARN capacity diagnostic and recovers through its existing storage path

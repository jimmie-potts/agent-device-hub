## ADDED Requirements

### Requirement: Core storage classifies wrapped full-disk errors
The core store SHALL use the SDK full-disk classifier for errors raised while opening its tables and committing a transaction. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL follow the existing full-disk path, preserving durable admission, no-publication-before-commit, and recovery behavior. The core's separate lease `SQLITE_BUSY` retry SHALL remain unchanged.

#### Scenario: Wrapped ENOSPC while opening the core store
- **WHEN** creating the core store tables fails with an error caused by `ENOSPC`
- **THEN** startup reports storage unavailable and the core records the existing full-disk failure state

#### Scenario: Wrapped ENOSPC during a core transaction
- **WHEN** a core transaction fails with an error caused by `ENOSPC`
- **THEN** the change is refused as full, no observation is published or committed, and the core retains its existing recovery behavior

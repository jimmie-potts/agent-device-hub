## ADDED Requirements

### Requirement: Playback storage uses SDK full-disk classification
The playback module SHALL classify storage errors with the SDK full-disk helper while preserving explicit `SdkError` codes. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL retain the existing capacity response and no-command-before-durable-intent behavior. SQLite `BUSY` and `LOCKED` SHALL remain unavailable.

#### Scenario: Wrapped ENOSPC refuses command intent
- **WHEN** recording a command intent fails with an error caused by `ENOSPC`
- **THEN** the command receives the existing capacity response and the speaker receives no command

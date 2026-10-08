## ADDED Requirements

### Requirement: LIFX storage uses SDK full-disk classification
The LIFX module SHALL classify storage errors with the SDK full-disk helper. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL retain the existing `capacity` refusal and diagnostic behavior, including refusal before any bulb effect.

#### Scenario: Wrapped ENOSPC refuses command admission
- **WHEN** persisting a command fails with an error caused by `ENOSPC`
- **THEN** the module replies with `capacity`, records no accepted command or outcome, and sends no packet

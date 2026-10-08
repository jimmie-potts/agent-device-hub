## ADDED Requirements

### Requirement: Routed mode owner identifier

The `mode/2.0` record's `id` SHALL satisfy the existing routing identifier contract so it can be addressed as `bunny.state.mode.<id>` and `bunny.cmd.mode-set.<id>`. The Hub owner SHALL remain `hub`.

#### Scenario: Invalid mode owner identifier
- **WHEN** a mode record names `Hub.Owner` as its owner
- **THEN** the family validator refuses it as `invalid-message`

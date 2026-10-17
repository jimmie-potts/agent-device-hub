## MODIFIED Requirements

### Requirement: Honest operating limits and compatibility
Weekly schedules SHALL require the Hub to run and the selected target path to be available. No offline, installed or physical guarantee SHALL be inferred from source/simulated success. Source delivery SHALL keep schedules inactive in the established installation until the owning procedure verifies the actual releases and assesses affected schedule storage changes with focused evidence. Existing event rules, settings and log entries SHALL retain their behavior and data.

#### Scenario: Hub was down at a boundary
- **WHEN** the Hub was not running at an on or off boundary
- **THEN** it performs no retrospective device action and the user is not told that the missed action succeeded

#### Scenario: Runtime recovery retains new schedule data
- **WHEN** recovery is proposed after schedule definitions exist
- **THEN** that operation needs compatibility evidence for those actual definitions and duplicate guards; an older release's event-only reader is not assumed compatible

## ADDED Requirements

### Requirement: Save artwork sent in an owner message

Art SHALL promote the exact validated draft to the library on an authorized attachment Send. Repeated requests for that artwork SHALL preserve a single durable item and the original still or GIF. The save result SHALL be available independently of display preparation or presentation.

#### Scenario: The save succeeds and the display becomes unavailable

- **WHEN** a sent attachment has been saved and the requested display fails or becomes unavailable
- **THEN** the exact saved artwork remains playable from the library
- **AND** a definitive display failure can be retried without another save

#### Scenario: A draft cannot be promoted

- **WHEN** the draft is invalid, absent or expired before promotion
- **THEN** the save reports its supported failure and the Send issues no display command

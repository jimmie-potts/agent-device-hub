## ADDED Requirements

### Requirement: Temporary local Tidbyt GIFs

Art SHALL accept a bounded owner-selected 64×32 animated GIF through the authenticated module upload API and forward its exact bytes to the configured art-capable Tidbyt for staging. Successful staging SHALL require the writer's confirmation. Only an explicit Show now request for the confirmed, unexpired reference and the same target MAY start a 30-second Tidbyt moment. The ordinary moment controls, release and outcome semantics SHALL apply.

#### Scenario: Compare two local animations

- **WHEN** the owner uploads two different valid animations and later shows each temporary reference in sequence
- **THEN** the uploads produce zero display pushes, provider calls and gallery entries, and each show uses its exact animation for a 30-second moment.

#### Scenario: Refused or interrupted work

- **WHEN** input is oversized or invalid, or staging has expired, failed or has an uncertain outcome
- **THEN** the system refuses playback of that reference and never automatically resends a command.

#### Scenario: Duplicate upload or show

- **WHEN** an accepted request is submitted again
- **THEN** its recorded identity prevents a second effect and changed content under the same request identity conflicts.

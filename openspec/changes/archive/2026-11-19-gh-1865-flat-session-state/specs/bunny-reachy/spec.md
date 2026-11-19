## MODIFIED Requirements

### Requirement: Optional live status expression
Automatic expression SHALL default off, require the current core mode and an opportunity that still matches its session through the contracts package's opportunity match (the same generation, identity and turn, and the attention item still present or the notice still present and not acknowledged by `reachy-mini`), honor Quiet and takeover, have one active and one pending candidate, expire candidates after five seconds and space automatic gestures at least 30 seconds apart. No session freshness or restart term SHALL apply.
#### Scenario: Recovery and snapshots
- **WHEN** the module starts, resyncs, reconnects or returns from Quiet
- **THEN** past opportunities and stored intent produce no motion
#### Scenario: Guard changes between stages
- **WHEN** expiry, Quiet, stale observations, source invalidation or takeover occurs during an automatic gesture
- **THEN** the active task is cancelled once and no next stage is sent
#### Scenario: Notice evidence
- **WHEN** a bare turn ends without a current unacknowledged notice
- **THEN** no gesture is created and no success is inferred
#### Scenario: Unconfirmed work does not refuse a waiting question
- **WHEN** a session whose work turned unconfirmed after five minutes of silence raises an approval
- **THEN** the approval's opportunity is eligible while it matches, and unconfirmed work alone does not refuse it

## ADDED Requirements

### Requirement: Status tools read controllers at 1.1
The per-device `status` tool SHALL read its controller through the negotiated 1.1 read. For a controller that serves 1.1 it SHALL return the validated 1.1 snapshot, including `capabilities.moments` and `state.moment`, and for a 1.0-only controller it SHALL return the 1.0 snapshot unchanged. Its input, scope, read-only annotations and error mapping SHALL stay the same. Command tools SHALL keep sending API 1.0 requests, and the tool SHALL send no command.

#### Scenario: Moment state through status
- **WHEN** a read principal calls `status` for an alias whose controller serves 1.1
- **THEN** the result carries the `moments` capability and the `moment` state

#### Scenario: 1.0-only controller
- **WHEN** the controller answers the versioned read with `invalid-request`
- **THEN** `status` returns the 1.0 snapshot and the controller has received no command

## ADDED Requirements

### Requirement: Standby external admission

An exact standby core selection SHALL keep the external gateway closed by default.
If a bounded status capability is supplied, the gateway SHALL admit it only with
an ordinary read-only bearer and the existing listener, origin and proxy checks.
Status input and the delivered JSON SHALL be bounded, and the response SHALL
exclude protected data. General reads, dashboard assets, browser sessions,
launcher and MCP SHALL stay closed. Local health SHALL keep its existing behavior.

Recognized command, approval recovery, Automation write and upload requests SHALL
keep existing authentication and structural errors. A well-formed request from
an admitted reader SHALL receive the shared `unavailable` refusal with fixed
detail before owner invocation, command tracking, upload staging or execution.
After an awaited request or status read, the gateway SHALL re-admit the original
bearer under its current grants while the gateway is still open.

#### Scenario: Standby writes have no effects
- **WHEN** a read-only bearer submits a structurally valid mutation
- **THEN** the gateway refuses before it invokes an owner, stages content or tracks work

#### Scenario: Pending admission changes
- **WHEN** a bearer is revoked or rotated during a body or status read, or the gateway closes
- **THEN** the old request cannot receive the status payload or proceed to mutation handling

### Requirement: Standby inbound credentials

A configured standby SHALL validate the private credential list before preparing
state, even with the edge off. Each credential SHALL have exactly the read
scope and no role or robot identifier. Reload SHALL apply the same whole-list
validation before changing effective grants or disconnecting clients. An
unconfigured standby SHALL read no credential file at startup or reload.

#### Scenario: Replacement contains write authority
- **WHEN** a standby credential list contains a control, ingest, admin or role grant
- **THEN** startup refuses before state preparation or reload refuses with its prior grants intact

## ADDED Requirements

### Requirement: Retired standby control is refused

The entrypoint and operator SHALL refuse `BUNNY_CONTROL=standby` before
starting a runtime. Normal production and private access retain their existing
control admission.

#### Scenario: A container has stale standby control

- **WHEN** an operator requests a start for a running or stopped container configured for standby
- **THEN** the operator refuses without starting or stopping the container

#### Scenario: Stopped maintenance on a legacy container

- **WHEN** an operator requests backup or restore for a stopped container with valid legacy production or private-proxy standby metadata
- **THEN** the operator uses the existing stopped maintenance checks and isolated worker

## REMOVED Requirements

### Requirement: Explicit core standby container

**Reason**: ADR 0016 superseded the two-host settings replication design.

**Migration**: Use the existing private API of the authoritative runtime.

### Requirement: Standby credential precheck

**Reason**: ADR 0016 superseded the two-host settings replication design.

**Migration**: Use the existing private API of the authoritative runtime.

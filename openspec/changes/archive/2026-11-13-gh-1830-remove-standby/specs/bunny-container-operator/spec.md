## ADDED Requirements

### Requirement: Retired standby control is refused

The entrypoint and operator SHALL refuse `BUNNY_CONTROL=standby` before
starting a runtime. Normal production and private access retain their existing
control admission.

#### Scenario: A stopped container has stale standby control

- **WHEN** an operator requests a start for a container configured for standby
- **THEN** the operator refuses before Docker starts the container

## REMOVED Requirements

### Requirement: Explicit core standby container

**Reason**: ADR 0016 superseded the two-host settings replication design.

**Migration**: Use the existing private API of the authoritative runtime.

### Requirement: Standby credential precheck

**Reason**: ADR 0016 superseded the two-host settings replication design.

**Migration**: Use the existing private API of the authoritative runtime.

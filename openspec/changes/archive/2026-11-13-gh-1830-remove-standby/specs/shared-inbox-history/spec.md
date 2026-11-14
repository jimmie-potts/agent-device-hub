## ADDED Requirements

### Requirement: Retired settings history modes are refused

The filtered history route SHALL refuse snapshot and page mode parameters
with the existing invalid filter response.

#### Scenario: An authenticated reader requests a retired mode

- **WHEN** a read caller requests `settings=snapshot` or `settings=page`
- **THEN** the route returns `invalid-request` and no history payload

## REMOVED Requirements

### Requirement: Committed core settings read

**Reason**: ADR 0016 superseded the two-host settings replication design.

**Migration**: Use the existing private API of the authoritative runtime.

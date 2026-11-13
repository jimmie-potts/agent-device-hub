## ADDED Requirements

### Requirement: Standby credential precheck

The shipped standby container entrypoint SHALL validate any configured inbound
credential file before bootstrap. It SHALL admit only ordinary credentials with
exactly read scope and no role or robot identifier. Startup SHALL use the
validated snapshot through bootstrap. Subsequent file changes SHALL be checked
on reload. The shipped standby SHALL keep its external gateway off.

#### Scenario: Standby credential file requests authority
- **WHEN** a configured standby file is missing, malformed or contains a grant beyond ordinary read
- **THEN** the entrypoint refuses before bootstrap or runtime startup

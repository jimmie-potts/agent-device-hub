## ADDED Requirements

### Requirement: Optional unattended transition deadline

Upgrade and rollback MAY accept an explicit finite deadline. When supplied, the native operation SHALL require at least 600 seconds remaining before entering its operation and immediately before durable mutation intent, after staging and compatibility checks. Insufficient reserve SHALL refuse before service stop. An admitted switch and recovery SHALL retain the existing native completion path rather than be killed at the admission deadline. Plan and status SHALL reject a mutation deadline argument; ordinary authorized manual operations without it SHALL keep their existing behavior.

#### Scenario: Staging exhausts transition reserve
- **WHEN** a deadline-bound operation has enough reserve at entry but less than 600 seconds immediately before mutation intent
- **THEN** it produces a refusal without stopping or switching the service

#### Scenario: Invalid deadline argument
- **WHEN** a non-finite deadline is supplied, or plan/status receives a mutation deadline
- **THEN** argument validation rejects it without operating on the installation

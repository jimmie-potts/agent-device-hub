## ADDED Requirements

### Requirement: Dormant helper retention
While BB-8 is hibernated, normal build and verification SHALL omit its Windows helper. No scan, Connect, wake, robot command or helper start SHALL be selected for hibernation. Its private configuration, receipt files and stored-format source SHALL remain retained without migration.

#### Scenario: Hibernate an existing enrolled helper
- **WHEN** the owner ends BB-8 work
- **THEN** the helper remains stopped and its unit/native/package checks are absent from ordinary CI

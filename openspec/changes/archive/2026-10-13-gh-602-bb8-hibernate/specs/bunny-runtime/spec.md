## ADDED Requirements

### Requirement: Dormant modules are excluded from active composition
The build SHALL exclude packages explicitly marked hibernated from runtime and browser registrations. Normal verification SHALL exclude their module scenarios and feature-specific checks while retaining checks for active modules and required storage metadata.

#### Scenario: Build with a retained dormant package
- **WHEN** a package declares hibernation
- **THEN** its registration and frontend are absent from generated active lists and its feature tests are not scheduled

## ADDED Requirements

### Requirement: Owner-selected indefinite hibernation
While BB-8 is hibernated, its earlier active-use and verification requirements SHALL remain historical and inactive. Default unit, scenario, browser and CI runs SHALL execute no BB-8 feature checks. Source, dormant tests and private state SHALL remain retained; resumption SHALL require a new owner decision.

#### Scenario: Other product work runs CI
- **WHEN** ordinary project checks run during hibernation
- **THEN** they execute no BB-8 module, package, browser or shared BB-8 behavior cases

#### Scenario: Installed integration is disabled
- **WHEN** hibernation is applied to the established installation
- **THEN** its BB-8 configuration and helper grant are inactive and the helper remains stopped without clearing its stores

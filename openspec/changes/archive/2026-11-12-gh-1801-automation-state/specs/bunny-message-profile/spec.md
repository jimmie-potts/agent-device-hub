## ADDED Requirements

### Requirement: Core automation definition payloads

The message profile SHALL register `automation-rule/2.0`, `automation-routine/2.0`, `automation-settings/2.0` and `automation-interrupt-set/2.0` as core-owned state. Each SHALL carry its entity ID and core revision. Each SHALL declare an empty bookkeeping list and accept only the fields of its saved definition. Rule and routine deletion SHALL use the existing profile removal with the same family and ID as their state.

#### Scenario: Definition facts validate

- **WHEN** the core's rule, routine, settings and interrupt-set messages and rule and routine removals are validated
- **THEN** the messages are accepted
- **AND** a state with an extra member, mismatched subject or foreign source is refused

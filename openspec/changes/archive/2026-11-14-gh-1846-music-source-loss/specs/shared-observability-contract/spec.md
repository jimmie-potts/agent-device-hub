## ADDED Requirements

### Requirement: Profile 1.12 Music capture checkpoints

Profile 1.12 SHALL define closed events, scopes and fields for the producer, core and Nanoleaf checkpoints. Earlier profiles SHALL refuse the new records, and existing record admissions and the legacy producer default SHALL be preserved.

#### Scenario: A synthetic checkpoint carries an unregistered value

- **WHEN** a checkpoint contains an unregistered cause, invalid sequence or field outside its declared scope
- **THEN** the contract refuses the invalid declared value or scope and excludes unregistered attributes according to the current contract

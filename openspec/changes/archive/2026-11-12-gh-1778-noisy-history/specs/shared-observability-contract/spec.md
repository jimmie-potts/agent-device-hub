## ADDED Requirements

### Requirement: Profile 1.9 registers the history change warning

Profile 1.9 SHALL add the WARN event `history.entity.noisy` under the runtime's core module scope. The record SHALL require the participant source, a bounded family, a contract-designated neutral entity ID, the count, threshold and UTC hour start in milliseconds. The producer SHALL use designated machine identities and SHALL exclude labels, addresses, generic subject fallbacks and history payloads. Earlier profiles SHALL reject the new event and attributes. The default producer profile SHALL stay at 1.1.

#### Scenario: A private consumer queries the warning
- **WHEN** TypeScript and Python process the warning fixture
- **THEN** both validate the canonical record and retain its registered fields in OTLP, and an existing private diagnostics query can select the alarm for a UTC hour by registered metadata
- **AND** an older profile, wrong scope, invalid identity or missing required attribute is refused

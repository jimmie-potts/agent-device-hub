## ADDED Requirements

### Requirement: Music capture payload families

The event contract SHALL define closed profile 2.0 families for music capture endpoint registration, capture work, reliable lifecycle observations, derived feature observations, endpoint loss, operator control and current capture state. Capture progress and features SHALL be attributable to their authenticated endpoint and session generation. Endpoint-loss observations SHALL name the endpoint even if no capture session has started. The schemas SHALL exclude PCM, credentials, track metadata and arbitrary diagnostic text.

#### Scenario: Valid bounded feature
- **WHEN** a registered producer publishes a finite bounded feature with matching routing subject, generation and ordered timing
- **THEN** it validates under its registered family and existing profile 2.0 envelope

#### Scenario: Undeclared or unsafe content
- **WHEN** a feature contains PCM, extra properties, invalid timing, nonfinite values or a different schema's shape
- **THEN** validation refuses it before it enters the runtime bus

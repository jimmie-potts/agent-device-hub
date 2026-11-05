## MODIFIED Requirements

### Requirement: Music capture payload families

The event contract SHALL define closed profile 2.0 families for music capture endpoint registration, capture work, reliable lifecycle observations, derived feature observations, endpoint loss, operator control and current capture state. Capture progress and features SHALL be attributable to their authenticated endpoint and session generation. Endpoint-loss observations SHALL name the endpoint even if no capture session has started. The schemas SHALL exclude PCM, credentials, track metadata, native device UIDs and arbitrary diagnostic text. Endpoint, work, features, control and state SHALL register additive `/2.1` selected-microphone schemas alongside unchanged `/2.0`; progress and lost SHALL retain `/2.0`. The new schemas SHALL keep old Music-shaped values valid and require a bounded alias for microphone selections.

#### Scenario: Valid bounded feature
- **WHEN** a registered producer publishes a finite bounded feature with matching routing subject, selected input, generation and ordered timing
- **THEN** it validates under its registered family and existing profile 2.0 envelope

#### Scenario: Undeclared or unsafe content
- **WHEN** a feature contains PCM, a native device UID, extra properties, invalid timing, nonfinite values or a different schema's shape
- **THEN** validation refuses it before it enters the runtime bus

#### Scenario: Old Music producer remains valid
- **WHEN** an existing producer registers, receives Music work and publishes progress/features using `/2.0`
- **THEN** the upgraded runtime accepts those unchanged records and sends Music start and stop work it understands

#### Scenario: Both versions and one state producer
- **WHEN** bundled consumers receive a valid `/2.0` or `/2.1` capture record
- **THEN** they accept the supported shape and key it by family; the upgraded core publishes and syncs one `/2.1` current-state record without a second `/2.0` projection

#### Scenario: Undeclared microphone selection
- **WHEN** a `/2.0` payload contains microphone fields, or a `/2.1` microphone start omits or exceeds the alias bound
- **THEN** validation refuses the message rather than silently applying Music semantics

## ADDED Requirements

### Requirement: Atomic acknowledgment of all configured consumers
The state owner SHALL offer one serialized operation that acknowledges the selected latest retained notice for every configured consumer in one durable save. It SHALL preserve read, attention, lifecycle evidence, freshness and consumer configuration. An already acknowledged selected notice SHALL commit no session mutation, and an older selected notice SHALL be refused after a newer notice arrives.

#### Scenario: Every configured consumer in one save
- **WHEN** an authorized host selects the current notice
- **THEN** one save records each configured consumer's acknowledgment, preserving existing acknowledgments and all independent evidence

#### Scenario: A newer notice intervenes
- **WHEN** the serialized owner operation sees a newer latest notice than the selection
- **THEN** it refuses the old selection without acknowledging the new notice

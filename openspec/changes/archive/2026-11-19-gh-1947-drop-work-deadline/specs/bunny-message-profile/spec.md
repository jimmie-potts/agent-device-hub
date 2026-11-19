## MODIFIED Requirements

### Requirement: Full-record state families

Each state event SHALL carry the complete current record of one entity, and its envelope `subject` SHALL be the entity's `id`. A `session/3.0` record SHALL carry its identity and parent, its turn, its status as a closed class (`needs-owner`, `working`, `finished`, `quiet` or `unknown`) with an open kebab-case detail, its work, attention, outcome and relationship claims, each with its evidence time and confidence, the work claim's reasons being only `restart`, `ambiguous` or `lost` (Hub #1947 removed `deadline`), its unavailable evidence, ordering, evidence instants, its generation, and any label, title, project, project ID and host session ID. It SHALL carry no freshness and no restart uncertainty. A session's `id` SHALL be the lowercase hex SHA-256 of its identity as compact JSON with sorted keys, in UTF-8. The owner SHALL publish a new revision when a session's public meaning or the playback availability changes; a session's evidence time is part of its meaning at the core's one-minute resolution. A session record SHALL be refused when:
- its status differs from the status function of its claims;
- its work claim names a reason other than `restart`, `ambiguous` or `lost`;
- its read evidence or receipt provenance does not match the current finished turn of an idle or interrupted root;
- it carries a host session ID below a known parent;
- its generation is after its revision;
- it repeats a notice ID or an unavailable dimension;
- or its `id` is not the identity key.

An inbox item SHALL be a failed or uncertain operation, which MAY carry its outcome's evidence. A finished turn SHALL stay on its session record and SHALL NOT be an inbox item: an `inbox-item` whose item is a turn-ended notice SHALL be refused with `invalid-message` (owner decision 7, 2026-10-06; Hub #782). A label SHALL carry its origin. The display title SHALL be the label, then the title, then the consumer's neutral fallback.

#### Scenario: Record rules
- **WHEN** a session record reports a status its claims do not give, read provenance on another turn, a host session ID on a child, a generation after its revision, a repeated notice or unavailable dimension, or an `id` or `subject` that is not the identity key
- **THEN** it is refused with `invalid-message` and a detail naming the failing field

#### Scenario: Freshness follows the envelope time
- **WHEN** a `session/3.0` record that needs the owner is validated at an envelope time an hour after its last evidence
- **THEN** it is accepted, and a record that still carries `freshness` or `restartUncertain` is refused

#### Scenario: Display precedence
- **WHEN** a record has a user label and a provider title, an agent label and no title, only a title, or neither
- **THEN** the display title is the label, the label, the title, or undefined for the consumer's fallback

#### Scenario: A turn-ended inbox item
- **WHEN** an `inbox-item` state names a turn-ended notice of a session in place of an operation
- **THEN** it is refused with `invalid-message`, and the fixtures hold failed and uncertain operations only

#### Scenario: The retired work reason
- **WHEN** a `session/3.0` record whose running work is unconfirmed carries the reason `deadline`
- **THEN** it is refused with `invalid-message`, and the shared read function reads it as nothing

### Requirement: Shared session read function

The package SHALL provide one read function that every session reader uses: it SHALL validate a session state message and return a version-independent view, holding the identity, parent, turn, generation, revision, status, claims, notices, read evidence, receipt provenance, unavailable evidence and display metadata, or nothing for a message it does not accept. It SHALL read `session/3.0` only, whose record is the view; a `session/2.0` or `session/2.1` record stays a valid retained document that no reader reads, so a reader from an older release finds no record it accepts until it is updated. The package SHALL also provide the status function the core uses, the record builder the core publishes with, which makes active work unconfirmed after a restart or for ambiguous or lost activity evidence, never from silence, and never makes other work unconfirmed, a per-consumer function that retires `finished` to `quiet` under a consumer's acknowledgment and read policy, and an opportunity match that requires the same generation, identity and turn and the attention item or unacknowledged notice the opportunity names. A detail the reader does not know SHALL fall back to its class, and an unknown detail SHALL never make an action eligible.

#### Scenario: A waiting session past its deadline
- **WHEN** a `session/3.0` record with an approval whose running work has been silent for an hour, long past the five minutes the retired deadline allowed, is read, a working record a restart left unconfirmed, and a `session/2.0` record of the same session
- **THEN** the first view needs the owner with its attention and work confirmed whatever its age, the second reads as working with unconfirmed work and reason `restart`, and the `session/2.0` record reads as nothing

#### Scenario: An unknown detail
- **WHEN** a record's status is `finished` with a detail the reader does not know
- **THEN** the view shows `finished`, and an opportunity match that depends on the detail is refused

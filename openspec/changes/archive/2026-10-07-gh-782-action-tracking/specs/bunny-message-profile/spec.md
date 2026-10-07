## ADDED Requirements

### Requirement: Outcome acknowledgment

The profile SHALL define the core family `outcome-recorded`, an occurrence of type `org.bunny.outcome.recorded` whose payload is `{source, id}`: the core tells the module whose `source` it names that it recorded that module's outcome with message `id` (ADR 0012, "Acknowledging outcomes"). It SHALL travel on `bunny.event.outcome-recorded.<module>`, where `<module>` is the last segment of the outcome's source (`outcomeRecordedKey(source)`), and its envelope `subject` SHALL be the outcome's `id`. Only the core, `bunny/core` (`CORE_SOURCE`), SHALL send it: the validator SHALL refuse one from any other source, and one whose `subject` is not its `id`, with `invalid-message`.

#### Scenario: The core's acknowledgment
- **WHEN** `bunny/core` sends `outcome-recorded` naming `bunny/modules/pixoo` and an outcome's `id` as its subject
- **THEN** it is accepted, and its key is `bunny.event.outcome-recorded.pixoo`

#### Scenario: An acknowledgment from another participant
- **WHEN** a module sends `outcome-recorded`, or the core sends one whose subject is another outcome's ID or that names no outcome
- **THEN** each is refused with `invalid-message`, naming the envelope's `source`, its `subject` or the missing `id`

## MODIFIED Requirements

### Requirement: Core payload families

The profile SHALL define the core payload families, each a closed schema built from the shared blocks, registered under `https://bunny.invalid/events/<family>/2.0` and bound to one kind and one type:
- state: `session`, `mode`, `inbox-item` and `playback`, as `org.bunny.<family>.updated`;
- occurrence: `lifecycle` as `org.bunny.lifecycle.observed`, plus `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended`, `moment-ended` and `outcome-recorded`, as `org.bunny.attention.raised`, `org.bunny.attention.cleared`, `org.bunny.turn.ended`, `org.bunny.session.ended`, `org.bunny.moment.ended` and `org.bunny.outcome.recorded`;
- command: `mode-set` as `org.bunny.mode.set.requested`, `moment-play` as `org.bunny.moment.play.requested`, `notice-acknowledge` as `org.bunny.notice.acknowledge.requested`, `approval-recover` as `org.bunny.approval.recover.requested` and `playback-control` as `org.bunny.playback.control.requested`.

A message of a core family that uses another kind or type SHALL be refused with `invalid-message`. No core family SHALL carry a device-specific payload.

#### Scenario: A valid message of every family
- **WHEN** the shared fixtures' valid messages are validated, including a reply and an outcome for each command family
- **THEN** each is accepted, and every core family and every message kind has at least one

#### Scenario: Wrong kind or type for a family
- **WHEN** a session record is sent as an occurrence, or under a type other than `org.bunny.session.updated`
- **THEN** it is refused with `invalid-message` and a detail naming the envelope's `kind` or `type`

### Requirement: Full-record state families

Each state event SHALL carry the complete current record of one entity, and its envelope `subject` SHALL be the entity's `id`. A session record SHALL carry its identity and parent, its turn, activity, attention and notices, its read and unavailable evidence, ordering, evidence instants, freshness, restart uncertainty and child counts, its generation, and any label, title, project, project ID and host session ID. A session's `id` SHALL be the lowercase hex SHA-256 of its identity as compact JSON with sorted keys, in UTF-8. A session's freshness SHALL be `uncertain` exactly when the owner restarted since the last evidence, or five minutes or more have passed since it by the envelope `time`. The owner SHALL publish a new revision when a session's freshness or the playback availability changes. A record SHALL be refused when:
- its read evidence is not from Codex Desktop;
- it carries a host session ID below a known parent;
- its freshness disagrees with the rule above;
- its generation is after its revision;
- it repeats a notice ID or an unavailable dimension;
- or its `id` is not the identity key.

An inbox item SHALL be a failed or uncertain operation, which MAY carry its outcome's evidence. A finished turn SHALL stay on its session record and SHALL NOT be an inbox item: an `inbox-item` whose item is a turn-ended notice SHALL be refused with `invalid-message` (owner decision 7, 2026-10-06; Hub #782). A label SHALL carry its origin. The display title SHALL be the label, then the title, then the consumer's neutral fallback.

#### Scenario: Record rules
- **WHEN** a session record reports read evidence for Claude, a host session ID on a child, current freshness while restart-uncertain, a generation after its revision, a repeated notice or unavailable dimension, or an `id` or `subject` that is not the identity key
- **THEN** it is refused with `invalid-message` and a detail naming the failing field

#### Scenario: Freshness follows the envelope time
- **WHEN** five minutes pass without evidence for a session
- **THEN** the owner publishes the record with `uncertain` freshness at a new revision, and a record that claims `current` freshness five minutes or more after its last evidence, or `uncertain` before that without a restart, is refused with `invalid-message`

#### Scenario: Display precedence
- **WHEN** a record has a user label and a provider title, an agent label and no title, only a title, or neither
- **THEN** the display title is the label, the label, the title, or undefined for the consumer's fallback

#### Scenario: A turn-ended inbox item
- **WHEN** an `inbox-item` state names a turn-ended notice of a session in place of an operation
- **THEN** it is refused with `invalid-message`, and the fixtures hold failed and uncertain operations only

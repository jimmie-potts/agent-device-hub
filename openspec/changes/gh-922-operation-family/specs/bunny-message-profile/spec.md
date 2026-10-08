## MODIFIED Requirements

### Requirement: Core payload families

The profile SHALL define the core payload families, each a closed schema built from the shared blocks, registered under `https://bunny.invalid/events/<family>/2.0` and bound to one kind and one type:
- state: `session`, `mode`, `inbox-item`, `playback` and `operation`, as `org.bunny.<family>.updated`;
- occurrence: `lifecycle` as `org.bunny.lifecycle.observed`, plus `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended`, `moment-ended` and `outcome-recorded`, as `org.bunny.attention.raised`, `org.bunny.attention.cleared`, `org.bunny.turn.ended`, `org.bunny.session.ended`, `org.bunny.moment.ended` and `org.bunny.outcome.recorded`;
- command: `mode-set` as `org.bunny.mode.set.requested`, `moment-play` as `org.bunny.moment.play.requested`, `notice-acknowledge` as `org.bunny.notice.acknowledge.requested`, `approval-recover` as `org.bunny.approval.recover.requested` and `playback-control` as `org.bunny.playback.control.requested`.

A message of a core family that uses another kind or type SHALL be refused with `invalid-message`. No core family SHALL carry a device-specific payload.

#### Scenario: A valid message of every family
- **WHEN** the shared fixtures' valid messages are validated, including a reply and an outcome for each command family
- **THEN** each is accepted, and every core family and every message kind has at least one

#### Scenario: Wrong kind or type for a family
- **WHEN** a session record is sent as an occurrence, or under a type other than `org.bunny.session.updated`
- **THEN** it is refused with `invalid-message` and a detail naming the envelope's `kind` or `type`

## ADDED Requirements

### Requirement: Operation records

The `operation` state family SHALL carry the latest state of one action the core tracks (Hub #922, #782): its `id`, which SHALL be `operationEntityId(requestId)`, the lowercase hex SHA-256 of its request ID; its `revision`, `requestId`, `kind` (`device`, `moment` or `mode`), `family`, `command`, which SHALL be its family's type, `target` (a routing ID), `requestedBy` (a participant source), `status` (`sent`, `accepted`, `rejected`, `expired`, `uncertain`, `completed` or `conflict`), `sentAtMs`, `updatedAtMs` and `deadlineAtMs`, and, when known, `result`, `evidence`, `error` and the owner's `reply`. A record whose status is `sent` or `accepted` SHALL carry no `result`, and any other SHALL carry one; a failed result SHALL carry its error, and a succeeded one `transmitted` or `observed` evidence and no error. A record SHALL carry no command payload. Removal of an operation SHALL use the profile's removal with reason `retired`. The inbox (#923) SHALL point at an operation by its request ID.

#### Scenario: Valid operation records
- **WHEN** an accepted record, a completed one with observed evidence and the removal of a retired one are validated, and a consumer applies them in order
- **THEN** each is accepted, and the consumer's copy holds no operation

#### Scenario: Records the profile refuses
- **WHEN** an operation's `id` is not its request ID's, its command is another family's type, a pending one carries a result, a settled one has none, a failed one has no error or a succeeded one has evidence `none`
- **THEN** each is refused with `invalid-message`, naming the identity, the command, the result, the result, the error and the evidence in turn

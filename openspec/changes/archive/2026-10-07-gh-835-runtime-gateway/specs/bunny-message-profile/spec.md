## MODIFIED Requirements

### Requirement: Core payload families

The profile SHALL define the core payload families, each a closed schema built from the shared blocks, registered under `https://bunny.invalid/events/<family>/2.0` and bound to one kind and one type:
- state: `session`, `mode`, `inbox-item` and `playback`, as `org.bunny.<family>.updated`;
- occurrence: `lifecycle` as `org.bunny.lifecycle.observed`, plus `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended` and `moment-ended`, as `org.bunny.attention.raised`, `org.bunny.attention.cleared`, `org.bunny.turn.ended`, `org.bunny.session.ended` and `org.bunny.moment.ended`;
- command: `mode-set` as `org.bunny.mode.set.requested`, `moment-play` as `org.bunny.moment.play.requested`, `notice-acknowledge` as `org.bunny.notice.acknowledge.requested`, `approval-recover` as `org.bunny.approval.recover.requested` and `playback-control` as `org.bunny.playback.control.requested`.

A message of a core family that uses another kind or type SHALL be refused with `invalid-message`. No core family SHALL carry a device-specific payload.

#### Scenario: A valid message of every family
- **WHEN** the shared fixtures' valid messages are validated, including a reply and an outcome for each command family
- **THEN** each is accepted, and every core family and every message kind has at least one

#### Scenario: Wrong kind or type for a family
- **WHEN** a session record is sent as an occurrence, or under a type other than `org.bunny.session.updated`
- **THEN** it is refused with `invalid-message` and a detail naming the envelope's `kind` or `type`

## ADDED Requirements

### Requirement: Approval recovery command

The profile SHALL define `approval-recover`, a core command sent as `org.bunny.approval.recover.requested` with a `requestId`, a `turnId` and an `expectedRevision`, the session record's revision that the operator read, and nothing else. Its envelope subject SHALL be the session's entity ID, a SHA-256 hash. It carries the old Hub's `recover-approval` operation (Hub #835): the core retires the one approval marker without an attention ID that the session holds on that turn, and approves or denies nothing at the agent. Its reply SHALL use the profile's payload.

#### Scenario: A valid recovery and its refusals
- **WHEN** the shared fixtures validate an approval recovery, one whose subject is not a session ID, one without `expectedRevision`, and one that names a decision
- **THEN** the first is accepted and the others are refused with `invalid-message` and a detail naming the subject, the missing revision or the extra member

### Requirement: A command sent again is a duplicate

The registry's `duplicate-conflict` SHALL mean a message that reuses `(source, id)` with different content, or a command that was already sent and is sent again before its expiry. Its flag SHALL stay `retryable` false.

#### Scenario: The registry's meaning
- **WHEN** the registry file is read
- **THEN** `duplicate-conflict` is not retryable and its meaning names both a reused `(source, id)` and a command sent again

### Requirement: A message's subject is its key's routing ID

ADR 0012's routing keys, `bunny.<state|event|cmd>.<family>.<id>`, end in the routing ID of the entity they are about, and an entity's routing ID is its `id`, so a command's envelope `subject`, the entity it is for, SHALL be the last token of its routing key. A state, removal, occurrence or outcome that a remote part publishes SHALL meet the same rule. The SDK SHALL refuse a command that breaks it, on every transport, and a remote edge a publish that breaks it, with `invalid-message` before any responder or subscriber has the message, so that a grant of a key covers exactly the entity its responder acts on (Hub #835). A device command's subject is the device's ID, a `playback-control` command's the `playback` record's `id`, and a core command's the session's.

#### Scenario: A command for another entity than its key's
- **WHEN** a command on `bunny.cmd.power-set.pendant-1` names `beam` in its subject, and one on `bunny.cmd.playback-control.living-room` names another speaker
- **THEN** the SDK refuses each with `invalid-message`, and no responder has it

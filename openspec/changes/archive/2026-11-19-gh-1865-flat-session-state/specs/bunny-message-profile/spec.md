## MODIFIED Requirements

### Requirement: Core payload families

The profile SHALL define the core payload families, each a closed schema built from the shared blocks, registered under `https://bunny.invalid/events/<family>/2.0` and bound to one kind and one type:
- state: `session`, `mode`, `inbox-item`, `playback` and `operation`, as `org.bunny.<family>.updated`;
- occurrence: `lifecycle` as `org.bunny.lifecycle.observed`, plus `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended`, `moment-ended` and `outcome-recorded`, as `org.bunny.attention.raised`, `org.bunny.attention.cleared`, `org.bunny.turn.ended`, `org.bunny.session.ended`, `org.bunny.moment.ended` and `org.bunny.outcome.recorded`;
- command: `mode-set` as `org.bunny.mode.set.requested`, `moment-play` as `org.bunny.moment.play.requested`, `notice-acknowledge` as `org.bunny.notice.acknowledge.requested`, `approval-recover` as `org.bunny.approval.recover.requested` and `playback-control` as `org.bunny.playback.control.requested`.

The `session` family SHALL also register `session/3.0`, its current major, under the same kind and type; `session/2.0` and `session/2.1` SHALL stay registered for reading retained documents. A message of a core family that uses another kind or type SHALL be refused with `invalid-message`. No core family SHALL carry a device-specific payload.

#### Scenario: A valid message of every family
- **WHEN** the shared fixtures' valid messages are validated, including a reply and an outcome for each command family and a `session/3.0` state
- **THEN** each is accepted, and every core family and every message kind has at least one

#### Scenario: Wrong kind or type for a family
- **WHEN** a session record is sent as an occurrence, or under a type other than `org.bunny.session.updated`
- **THEN** it is refused with `invalid-message` and a detail naming the envelope's `kind` or `type`

### Requirement: Full-record state families

Each state event SHALL carry the complete current record of one entity, and its envelope `subject` SHALL be the entity's `id`. A `session/3.0` record SHALL carry its identity and parent, its turn, its status as a closed class (`needs-owner`, `working`, `finished`, `quiet` or `unknown`) with an open kebab-case detail, its work, attention, outcome and relationship claims, each with its evidence time and confidence, its unavailable evidence, ordering, evidence instants, its generation, and any label, title, project, project ID and host session ID. It SHALL carry no freshness and no restart uncertainty. A session's `id` SHALL be the lowercase hex SHA-256 of its identity as compact JSON with sorted keys, in UTF-8. The owner SHALL publish a new revision when a session's public meaning or the playback availability changes. A session record SHALL be refused when:
- its status differs from the status function of its claims;
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

### Requirement: Shared agent status

The package SHALL provide `sessionState`, `highestStatus` and `STATUS_COLORS` over the shared session read function's view. A root session SHALL rank attention over working over done, a working child SHALL make its root working, unconfirmed work SHALL NOT hide the owner's state, and read evidence SHALL NOT retire done. A finished turn's notice SHALL count until a known later turn supersedes it, so missing or conflicting turn evidence never hides a recorded outcome (owner decision, 2026-11-18). Acknowledgments are recorded per consumer, and each caller's policy decides which ones count: by default any consumer's acknowledgment SHALL retire done, as LIFX and Tidbyt use it today, and a caller that names acknowledging consumers SHALL count only theirs. `highestStatus` SHALL read a consumer's copy of the session family and SHALL return `unknown` for no copy, a copy that has not synced or one whose sync failed. Every device SHALL use the same colors as the 1.x helper.

#### Scenario: The copied status cases on session records
- **WHEN** the 1.x status tests, each notice on its session's own turn, and the shared case set run against the view
- **THEN** they pass, including the acknowledging-consumer cases, and a copy that has not synced reads as `unknown`

#### Scenario: Today's acknowledgment scope
- **WHEN** Pixoo acknowledges a session's only notice, and one caller names no consumers while another names Nanoleaf
- **THEN** the first sees no `done` and the second still sees `done`

#### Scenario: The same colors and ranking as 1.x
- **WHEN** the shared and 1.x helpers judge the same sessions and their colors are compared
- **THEN** they agree, except that a notice a known later turn superseded is not `done` over the view

#### Scenario: A superseded notice
- **WHEN** a root session's unacknowledged notice belongs to a known turn, and the session's known turn is a later one
- **THEN** the view shows no `done` for it, LIFX and the Tidbyt tile show none, and a notice whose turn or session turn is unknown still shows `done`

### Requirement: Versioned session output retains explicit receipt provenance

A `session/3.0` record's outcome claim SHALL carry explicit read provenance when positive non-Desktop read evidence is present: the exact finished notice, receipt observation time, authenticated source and receipt. Provenance SHALL match the session's known turn and notice and SHALL apply only to an idle or interrupted root session. It SHALL carry no content or credential fields.

Lifecycle/2.1 SHALL remain an explicit intake selection. `session/2.0`, `session/2.1`, lifecycle/2.0 and retained 1.x schemas SHALL retain their existing acceptance rules.

#### Scenario: Qualified Claude output
- **WHEN** the owner publishes a read Claude session with matching receipt provenance under `session/3.0`
- **THEN** current consumers read it through the shared function without relabeling its identity
- **AND** a `session/3.0` record with positive non-Desktop read evidence and no provenance is refused

#### Scenario: Invalid provenance
- **WHEN** read provenance has an unknown or mismatched turn or notice, belongs to a child or active session, omits its source, or contains undeclared fields
- **THEN** validation refuses the record

## ADDED Requirements

### Requirement: One supported-source definition

The package SHALL define each supported agent source once, its provider, its clients and the hook names it maps, and SHALL derive from that definition the `Identity` type, the provider and client enums of the `lifecycle` and `session/3.0` schemas, and the source check of the runtime's hook adapter. A contract test SHALL fail when any of them differs from the definition. A new source SHALL be one entry in the definition and a new minor version of the families whose enums it widens. The retained 1.x packages SHALL keep their own lists.

#### Scenario: A schema that drifts
- **WHEN** the `session/3.0` schema's provider enum names a provider the definition does not
- **THEN** the contract test fails and names the enum

### Requirement: Shared session read function

The package SHALL provide one read function that every session reader uses: it SHALL validate a session state message and return a version-independent view, holding the identity, parent, turn, generation, revision, status, claims, notices, read evidence, receipt provenance, unavailable evidence and display metadata, or nothing for a message it does not accept. It SHALL read `session/3.0` only, whose record is the view; a `session/2.0` or `session/2.1` record stays a valid retained document that no reader reads, so a reader from an older release finds no record it accepts until it is updated. The package SHALL also provide the status function the core uses, the record builder the core publishes with, which makes active work unconfirmed for its deadline, a restart or ambiguous or lost activity evidence and never makes other work unconfirmed, a per-consumer function that retires `finished` to `quiet` under a consumer's acknowledgment and read policy, and an opportunity match that requires the same generation, identity and turn and the attention item or unacknowledged notice the opportunity names. A detail the reader does not know SHALL fall back to its class, and an unknown detail SHALL never make an action eligible.

#### Scenario: A waiting session past its deadline
- **WHEN** a `session/3.0` record with an approval whose running work is unconfirmed for its deadline is read, and a `session/2.0` record of the same session
- **THEN** the first view needs the owner and its attention stays confirmed whatever its age, a working record unconfirmed for its deadline reads as working with unconfirmed work, and the `session/2.0` record reads as nothing

#### Scenario: An unknown detail
- **WHEN** a record's status is `finished` with a detail the reader does not know
- **THEN** the view shows `finished`, and an opportunity match that depends on the detail is refused

### Requirement: Shared session case set

The package SHALL ship a synthetic session case set. Each case SHALL hold an input sequence of observations, commands, clock advances and restarts; the expected records and the expected occurrence sequence; and the expected output of each reader's policy. The core's tests and every session reader's tests SHALL run it. It SHALL hold no real session identifiers, titles, prompts or host names.

#### Scenario: Every reader runs the cases
- **WHEN** a reader's test suite runs
- **THEN** it loads the shared cases through the package's loader and checks its own expected output for each

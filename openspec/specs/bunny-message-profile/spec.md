# bunny-message-profile Specification

## Purpose
Define profile 2.0, the single message format for every B.U.N.N.Y. component under ADR 0012: one envelope for every message kind, shared payload building blocks, one error body and code registry, and module payload schema registration. It is a source contract and claims no transport, store or installed runtime.

## Requirements

### Requirement: One envelope for every message kind

Profile 2.0 SHALL define one CloudEvents 1.0 structured JSON envelope for every B.U.N.N.Y. message. The kinds are `state`, `removal`, `occurrence`, `command`, `reply`, `outcome`, `sync-request` and `sync-completed`. The envelope SHALL require:
- `bunnyprofile` `2.0`;
- `id`, `source`, `type` and `subject`;
- `time`, with millisecond precision in UTC;
- `kind` and `datacontenttype`;
- an absolute `dataschema` URI;
- a nonzero W3C `traceparent`.

It SHALL refuse undeclared attributes and impossible dates. Commands and sync requests SHALL carry `expiresat`, and no other kind may carry it. The `type` suffix SHALL match the kind: a command's type names an entity and a verb before `.requested`, and only sync messages may use `org.bunny.sync.requested` and `org.bunny.sync.completed`. Replies, outcomes, removals and sync messages SHALL use the payload schemas the profile owns.

#### Scenario: A valid message of each kind
- **WHEN** the shared fixtures' valid message for each of the eight kinds is validated
- **THEN** each is accepted

#### Scenario: Envelope violations
- **WHEN** a message lacks `traceparent`, has an all-zero trace or parent ID, uses a non-URI `dataschema`, adds an undeclared attribute, omits milliseconds from `time` or names an impossible date, carries `expiresat` on a state event, omits `expiresat` from a command, uses a `type` suffix that does not match its kind, or uses a sync type for another kind
- **THEN** it is refused with `invalid-message` and a detail naming where the check failed

#### Scenario: Unsupported profile or payload version
- **WHEN** a message names another `bunnyprofile`, or a version of a registered payload family that is not registered
- **THEN** it is refused with `unsupported-version`

#### Scenario: Unknown payload family
- **WHEN** a message names a payload family that nobody registered
- **THEN** it is refused with `unknown-schema`

### Requirement: Size, expiry and retry identity

A message SHALL be at most 256 KiB as UTF-8 JSON, checked before any schema check. Input that is not a plain JSON object, including `null`, SHALL be refused with `invalid-message` without throwing. When the reader passes its clock, a command or sync request at or past `expiresat` SHALL be refused. Retry identity SHALL be `(source, id)`: the same identity with the same content is a duplicate, and with different content a conflict.

#### Scenario: Oversized message
- **WHEN** a message is over 256 KiB
- **THEN** it is refused with `too-large`

#### Scenario: Expired command
- **WHEN** a command is validated with a clock at or after its `expiresat`
- **THEN** it is refused with `expired`, and the same command is accepted with an earlier clock

#### Scenario: Duplicate and conflicting retries
- **WHEN** a message arrives again with the same `(source, id)`
- **THEN** identical content is classified as a duplicate and different content as a conflict

### Requirement: Shared building blocks

The profile SHALL publish building blocks that payload schemas reference by URI:
- identifiers;
- `<name>AtMs` instants and revisions as nonnegative safe integers;
- the `{epoch, sequence}` ticket;
- ordering, which is unknown, or known with an authority, epoch and sequence;
- tagged unknown values;
- kebab-case enum values;
- entity references;
- the error body.

#### Scenario: Block violations in a payload
- **WHEN** a payload has a negative ticket sequence, a non-integer instant, known ordering without an authority, an enum value that is not kebab-case or an error code that is not kebab-case
- **THEN** the message is refused with `invalid-message`

### Requirement: Completed outcomes and replies

A reply SHALL either accept a request or carry an error body. A completed outcome SHALL report `succeeded`, `failed` or `uncertain` with `transmitted`, `observed` or `none` evidence. Evidence `none` SHALL mean that there is no evidence that anything reached the device, as after a failure before sending or a lost answer. A failed outcome SHALL carry an error, a succeeded outcome SHALL carry no error, and a succeeded outcome SHALL report `transmitted` or `observed` evidence.

#### Scenario: Inconsistent outcome or reply
- **WHEN** a reply has both an accepted status and an error, a failed outcome has no error or a succeeded outcome reports no evidence
- **THEN** the message is refused with `invalid-message`

#### Scenario: An answer lost after sending
- **WHEN** a module sent a request but never got its answer, and reports an `uncertain` outcome with `none` evidence and the `uncertain-result` error
- **THEN** the outcome is accepted

### Requirement: One error body and code registry

Every boundary SHALL report errors as `{"error":{"code","retryable","requestId"?,"traceId"?,"detail"?}}`. Codes SHALL come from one registry, which sets `retryable` for each code. Building an error body with an unregistered code SHALL fail, and a received message whose error body has an unregistered code or a `retryable` flag that disagrees with the registry SHALL be refused with `invalid-message`.

#### Scenario: Error body from the registry
- **WHEN** an error body is built for `capacity` and for `uncertain-result`
- **THEN** `retryable` is true for `capacity` and false for `uncertain-result`, and an unregistered code throws

#### Scenario: Received error body outside the registry
- **WHEN** a reply carries an unregistered code, or an outcome marks `capacity` as not retryable
- **THEN** the message is refused with `invalid-message`

### Requirement: Module payload schemas

A module SHALL register its payload schemas under `https://bunny.invalid/events/<family>/<major>.<minor>`, built from the shared blocks. Registration SHALL refuse reserved families, malformed identifiers and duplicates. A registration MAY include a check for a rule the schema cannot state, such as two fields that must agree. The check SHALL run only after the payload schema passes. A message that fails it SHALL be refused with `invalid-message` and a detail that names where it failed. A check that throws, or answers with an empty or non-string detail, SHALL still refuse the message with `invalid-message` and a bounded detail, and validation SHALL NOT throw.

#### Scenario: Registering a module schema
- **WHEN** a module registers a payload schema and validates a message that uses it
- **THEN** a conforming message is accepted and a nonconforming payload is refused, and registering the same identifier, a reserved family or a malformed identifier throws

#### Scenario: A registered check
- **WHEN** a module registers a payload schema with a check, and validates a message whose payload passes the schema but breaks the check
- **THEN** the message is refused with `invalid-message` and the check's detail, and a payload that breaks the schema is refused with the schema's detail first

#### Scenario: A misbehaving check
- **WHEN** a registered check throws, returns an empty or non-string detail, or returns a detail over 1,024 characters
- **THEN** validation returns `invalid-message` with a detail of 1 to 1,024 characters and does not throw

### Requirement: Core payload families

The profile SHALL define the core payload families, each a closed schema built from the shared blocks, registered under `https://bunny.invalid/events/<family>/2.0` and bound to one kind and one type:
- state: `session`, `mode`, `inbox-item` and `playback`, as `org.bunny.<family>.updated`;
- occurrence: `lifecycle` as `org.bunny.lifecycle.observed`, plus `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended` and `moment-ended`, as `org.bunny.attention.raised`, `org.bunny.attention.cleared`, `org.bunny.turn.ended`, `org.bunny.session.ended` and `org.bunny.moment.ended`;
- command: `mode-set` as `org.bunny.mode.set.requested` and `moment-play` as `org.bunny.moment.play.requested`.

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

A turn-ended inbox item's `session` SHALL be its identity's key, and an operation item MAY carry its outcome's evidence. A label SHALL carry its origin. The display title SHALL be the label, then the title, then the consumer's neutral fallback.

#### Scenario: Record rules
- **WHEN** a session record reports read evidence for Claude, a host session ID on a child, current freshness while restart-uncertain, a generation after its revision, a repeated notice or unavailable dimension, or an `id` or `subject` that is not the identity key
- **THEN** it is refused with `invalid-message` and a detail naming the failing field

#### Scenario: Freshness follows the envelope time
- **WHEN** five minutes pass without evidence for a session
- **THEN** the owner publishes the record with `uncertain` freshness at a new revision, and a record that claims `current` freshness five minutes or more after its last evidence, or `uncertain` before that without a restart, is refused with `invalid-message`

#### Scenario: Display precedence
- **WHEN** a record has a user label and a provider title, an agent label and no title, only a title, or neither
- **THEN** the display title is the label, the label, the title, or undefined for the consumer's fallback

### Requirement: Lifecycle evidence is preserved

The `lifecycle` family SHALL carry every field of a lifecycle 1.x observation: identity, turn, parent, the native event ID, the event with its attention, acknowledgment, read or unavailable evidence, the observation and occurrence instants, ordering, project ID, label, title, project and host session ID. Event kinds SHALL be kebab-case. A known parent in another provider, client, host or source, or with the same session ID, SHALL be refused with `invalid-message`. This applies to session records and lifecycle observations alike. Known ordering SHALL name the identity's `sourceId` as its authority.

#### Scenario: Cross-source parentage
- **WHEN** a session record or lifecycle observation names a known parent in another source or provider, or itself as parent
- **THEN** it is refused with `invalid-message` and a detail naming `/parent/identity`

#### Scenario: 1.x corpora convert without loss
- **WHEN** every valid lifecycle 1.0, 1.1 and 1.2 fixture and every valid snapshot session fixture is converted by the mapping rules
- **THEN** each result is accepted, and each 1.x per-record or per-observation refusal in the selected list is refused in 2.0 too

### Requirement: Occurrence families

Agent occurrences SHALL name the session's `id` and identity, the observation's turn, instants and ordering and the owner revision that committed them. `attention-raised` and `attention-cleared` SHALL carry the whole attention item: its ID, its kind and the turn it was raised on. A raised item's turn SHALL be the observation's turn. A cleared item's turn MAY differ from it, as when a newer turn retires the item's turn. `attention-cleared` SHALL name its cause: `resolved`, `turn-ended`, `turn-retired` or `recovered`. `turn-ended` MAY name the retained notice. `session-ended` SHALL precede the removals of the retired records. `moment-ended` SHALL name the request, the moment, its ending (`completed`, `preempted`, `superseded` or `interrupted`) and its instant.

#### Scenario: Occurrence rules
- **WHEN** an occurrence names a session `id` that is not its identity's key, uses another subject, names ordering under another authority, raises an item on a turn other than the observation's, or gives an unknown clearing cause or moment ending
- **THEN** it is refused with `invalid-message`

#### Scenario: An approval from an earlier turn
- **WHEN** a `turn-started` observation selects turn T2 and retires turn T1, which holds an approval without a request ID
- **THEN** `attention-cleared` names the observation's turn T2, the item's turn T1 and cause `turn-retired`, and is accepted

### Requirement: Device-neutral requests

`mode-set` SHALL request a Hub mode of `work`, `free` or `quiet`, with an optional expected revision. `moment-play` SHALL request one moment:
- its moment ID and a kebab-case mood;
- an optional palette of 1 to 8 colors;
- a duration of 1,000 to 300,000 ms;
- a priority class and whether it covers status;
- a wall-clock `startAtMs`, at most 60,000 ms after the envelope `time`, and a tolerance of up to 60,000 ms.

A module SHALL convert `startAtMs` to a deadline on its own monotonic clock when the request arrives. Neither payload SHALL name a device, controller, ticket or controller clock. A flourish SHALL NOT cover status. Their replies and outcomes SHALL use the profile's reply and outcome payloads.

#### Scenario: A request that names a device
- **WHEN** a mode or moment request carries a `deviceId`, a `controllerId` or a controller-monotonic `start`
- **THEN** it is refused with `invalid-message`

#### Scenario: Moment limits
- **WHEN** a flourish covers status, a duration is under 1,000 ms, a tolerance is over 60,000 ms or a start is more than 60,000 ms after the envelope `time`
- **THEN** the request is refused with `invalid-message`

### Requirement: Removal, expiry and sync membership

An owner SHALL remove an entity with a removal event whose reason is `expired` for an expired session, `retired` for each record of a retired subtree, and `deleted` for a deleted entity such as a handled inbox item. A sync SHALL replace the consumer's membership of the synced families at the sync's revision. A consumer SHALL NOT keep an entity that a removal or a sync dropped. It SHALL NOT restore an entity from a state event at or below the removal's revision or the sync's revision. An entity whose revision is above the sync's revision arrived live during the sync and SHALL be kept.

#### Scenario: Expiry, retirement and deletion
- **WHEN** a consumer holding sessions and inbox items applies an expired removal, the retired removals of a subtree at one revision, or a deleted removal
- **THEN** it holds exactly the remaining entities, and a later state event with an older revision does not restore a removed one

#### Scenario: A sync drops a held entity
- **WHEN** a consumer that missed a retirement syncs the session family, and the owner's `sync.completed` lists only its current members
- **THEN** the consumer drops the entities it still held that are not members, keeps other families, and holds what the owner holds

#### Scenario: An entity above the sync revision
- **WHEN** a consumer holding session A at revision 5 starts a sync, receives session Y at revision 15 live, and the sync completes at revision 14 with members A
- **THEN** the consumer keeps both A and Y

#### Scenario: A removal during a sync
- **WHEN** a consumer starts a sync, receives the removal of session Y at revision 16 live, the sync completes at revision 14 with Y among its members, and a late state of Y at revision 15 arrives afterwards
- **THEN** the consumer does not hold Y

#### Scenario: A real owner's expiry and retirement
- **WHEN** an agent-state owner expires a session after 24 hours without evidence, or retires a parent and its known descendants on a runtime end, and its changes are published as 2.0 messages
- **THEN** each message is valid, the removals carry `expired` or `retired` at one revision, and a live consumer and a consumer that synced afterwards both hold exactly the owner's records

### Requirement: 1.x field mapping

The package SHALL publish a mapping from every 1.x field to its 2.0 home. It covers the agent-state session record and snapshot, the lifecycle observation, the controller receipt and the moment command. A 2.0 home is a family field, an envelope attribute, a profile-owned payload, a derived value or the owner's own store. A field with no 2.0 home SHALL have a recorded disposition. A 1.x receipt with `possible` prior effects SHALL map to an `uncertain` outcome with `none` evidence and the `uncertain-result` error, whatever its 1.x outcome, with the 1.x code in the error's detail. A `failed` receipt with confirmed transmission and the `uncertain-result` or `transport-failure` code was sent and then lost its answer; it SHALL map to an `uncertain` outcome with `transmitted` evidence and the `uncertain-result` error, with the 1.x code in the detail.

#### Scenario: Every field is named
- **WHEN** the field paths of the 1.x snapshot session, durable stored session, snapshot, lifecycle 1.2 envelope, controller receipts and moment command schemas are compared with the mapping
- **THEN** every path appears in its section

#### Scenario: Every receipt converts
- **WHEN** every receipt in the controller corpus, and every receipt shape the 1.1 schema accepts, is converted by the mapping rules
- **THEN** each becomes a valid reply or outcome with a registered error code, every shape with `possible` prior effects, `failed` and `cancelled` included, becomes `uncertain` with `none` evidence and `uncertain-result`, and every lost-answer shape becomes `uncertain` with `transmitted` evidence and `uncertain-result`

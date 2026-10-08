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

It SHALL define no `tracestate` or baggage attribute, and SHALL refuse undeclared attributes, `tracestate` included, and impossible dates. Commands and sync requests SHALL carry `expiresat`, and no other kind may carry it. The `type` suffix SHALL match the kind: a command's type names an entity and a verb before `.requested`, and only sync messages may use `org.bunny.sync.requested` and `org.bunny.sync.completed`. A sync request's `subject` SHALL name its requested families joined by commas, in the order requested, and its `sync.completed` SHALL carry the same subject. Replies, outcomes, removals and sync messages SHALL use the payload schemas the profile owns.

#### Scenario: A valid message of each kind
- **WHEN** the shared fixtures' valid message for each of the eight kinds is validated
- **THEN** each is accepted

#### Scenario: Envelope violations
- **WHEN** a message lacks `traceparent`, has an all-zero trace or parent ID, uses a non-URI `dataschema`, adds an undeclared attribute such as `tracestate`, omits milliseconds from `time` or names an impossible date, carries `expiresat` on a state event, omits `expiresat` from a command, uses a `type` suffix that does not match its kind, or uses a sync type for another kind
- **THEN** it is refused with `invalid-message` and a detail naming where the check failed

#### Scenario: Unsupported profile or payload version
- **WHEN** a message names another `bunnyprofile`, or a version of a registered payload family that is not registered
- **THEN** it is refused with `unsupported-version`

#### Scenario: Unknown payload family
- **WHEN** a message names a payload family that nobody registered
- **THEN** it is refused with `unknown-schema`

#### Scenario: Sync subjects
- **WHEN** the shared fixtures' sync requests and `sync.completed` messages are read
- **THEN** each subject is the requested families joined by commas, such as `session`

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
- routing IDs: identifiers that are also SDK routing-key tokens, of lowercase letters and digits with single hyphens and at most 128 characters;
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

Every boundary SHALL report errors as `{"error":{"code","retryable","requestId"?,"traceId"?,"detail"?}}`. Codes SHALL come from one registry, which sets `retryable` for each code. The contracts package SHALL also give the registry's codes as a literal type, `ErrorCode`, and each code's fixed flag in `RETRYABLE`, kept equal to the registry code for code and flag for flag. A code outside the registry SHALL fail to compile wherever an `ErrorCode` is expected, including `errorBody`'s code. Building an error body with an unregistered code SHALL fail, and a received message whose error body has an unregistered code or a `retryable` flag that disagrees with the registry SHALL be refused with `invalid-message`.

#### Scenario: Error body from the registry
- **WHEN** an error body is built for `capacity` and for `uncertain-result`
- **THEN** `retryable` is true for `capacity` and false for `uncertain-result`, and an unregistered code throws

#### Scenario: Received error body outside the registry
- **WHEN** a reply carries an unregistered code, or an outcome marks `capacity` as not retryable
- **THEN** the message is refused with `invalid-message`

#### Scenario: Typed codes
- **WHEN** a typed caller passes a code outside the registry where an `ErrorCode` is expected, or the typed table's codes or flags differ from the registry's
- **THEN** the typecheck fails, or the parity test fails naming the difference

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

### Requirement: Lifecycle evidence is preserved

The `lifecycle` family SHALL carry every field of a lifecycle 1.x observation except the acknowledgment: identity, turn, parent, the native event ID, the event with its attention, read or unavailable evidence, the observation and occurrence instants, ordering, project ID, label, title, project and host session ID. A 1.x `notice.acknowledged` observation SHALL become a `notice-acknowledge` command, and the `lifecycle` family SHALL refuse a `notice-acknowledged` event. Event kinds SHALL be kebab-case. A known parent in another provider, client, host or source, or with the same session ID, SHALL be refused with `invalid-message`. This applies to session records and lifecycle observations alike. Known ordering SHALL name the identity's `sourceId` as its authority.

#### Scenario: Cross-source parentage
- **WHEN** a session record or lifecycle observation names a known parent in another source or provider, or itself as parent
- **THEN** it is refused with `invalid-message` and a detail naming `/parent/identity`

#### Scenario: 1.x corpora convert without loss
- **WHEN** every valid lifecycle 1.0, 1.1 and 1.2 fixture and every valid snapshot session fixture is converted by the mapping rules
- **THEN** each result is accepted, an acknowledgment becomes a valid `notice-acknowledge` command when it names a SHA-256 notice ID, and each 1.x per-record or per-observation refusal in the selected list is refused in 2.0 too

### Requirement: Occurrence families

Agent occurrences SHALL name the session's `id` and identity, the observation's turn, instants and ordering and the owner revision that committed them. `attention-raised` and `attention-cleared` SHALL carry the whole attention item: its ID, its kind and the turn it was raised on. A raised item's turn SHALL be the observation's turn. A cleared item's turn MAY differ from it, as when a newer turn retires the item's turn. `attention-cleared` SHALL name its cause: `resolved`, `turn-ended`, `turn-retired` or `recovered`. `turn-ended` MAY name the retained notice. `session-ended` SHALL precede the removals of the retired records. A clearing that no observation started, an explicit approval recovery (`recovered`) or the startup settlement of approvals on retired turns (`turn-retired`), SHALL carry the session's current turn when the owner cleared the item, the owner's instant of the change as `observedAtMs`, unknown ordering and no `occurredAtMs`. `moment-ended` SHALL name the request, the moment, its ending (`completed`, `preempted`, `superseded` or `interrupted`) and its instant.

#### Scenario: Occurrence rules
- **WHEN** an occurrence names a session `id` that is not its identity's key, uses another subject, names ordering under another authority, raises an item on a turn other than the observation's, or gives an unknown clearing cause or moment ending
- **THEN** it is refused with `invalid-message`

#### Scenario: An approval from an earlier turn
- **WHEN** a `turn-started` observation selects turn T2 and retires turn T1, which holds an approval without a request ID
- **THEN** `attention-cleared` names the observation's turn T2, the item's turn T1 and cause `turn-retired`, and is accepted

#### Scenario: An owner-started clearing
- **WHEN** the owner recovers an approval without a request ID explicitly, or settles one on a retired turn at startup
- **THEN** `attention-cleared` with cause `recovered` or `turn-retired` names the session's current turn, the owner's instant and unknown ordering, and is accepted

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

The package SHALL publish a mapping from every 1.x field to its 2.0 home. It covers the agent-state session record and snapshot, the lifecycle observation, the controller receipt, the moment command, the controller snapshot with its capabilities, the controller request with each kind of its general command union, and the 1.x status helper. A 2.0 home is a family field, an envelope attribute, a profile-owned payload, a derived value or the owner's own store. A field with no 2.0 home SHALL have a recorded disposition. A 1.x receipt with `possible` prior effects SHALL map to an `uncertain` outcome with `none` evidence and the `uncertain-result` error, whatever its 1.x outcome, with the 1.x code in the error's detail. A `failed` receipt with confirmed transmission and the `uncertain-result` or `transport-failure` code was sent and then lost its answer; it SHALL map to an `uncertain` outcome with `transmitted` evidence and the `uncertain-result` error, with the 1.x code in the detail.

#### Scenario: Every field is named
- **WHEN** the field paths of the 1.x snapshot session, durable stored session, snapshot, lifecycle 1.2 envelope, controller receipts, moment command, controller snapshots 1.0 and 1.1 with their capabilities, and controller request schemas are compared with the mapping
- **THEN** every path appears in its section, and each kind of the general command union has one row that names all of its fields and one device command family

#### Scenario: Every receipt converts
- **WHEN** every receipt in the controller corpus, and every receipt shape the 1.1 schema accepts, is converted by the mapping rules
- **THEN** each becomes a valid reply or outcome with a registered error code, every shape with `possible` prior effects, `failed` and `cancelled` included, becomes `uncertain` with `none` evidence and `uncertain-result`, and every lost-answer shape becomes `uncertain` with `transmitted` evidence and `uncertain-result`

#### Scenario: Every controller snapshot and command converts
- **WHEN** every controller snapshot and general command in the 1.x corpus is converted by the mapping rules
- **THEN** each becomes a valid `device` record or command, desired values come only from 1.x desired state and observed values only from 1.x observations, and `commandSupported` agrees with every 1.x admission case that queued a command or refused it as `unsupported-capability`

### Requirement: Device state family

The profile SHALL define `device`, a state family registered under `https://bunny.invalid/events/device/2.0` and sent as `org.bunny.device.updated`, whose message carries the full record of one device and whose envelope subject is the device `id`. The module that controls the device SHALL publish it. The record SHALL carry:
- the device's `id`, a routing ID because it is also the device's routing-key token, unique across modules, its `revision` and kebab-case `kind`, and an optional owner label with the session family's display-text checks;
- `availability`: `unknown`, `available`, `degraded` or `unavailable`, where `unavailable` means the module cannot reach the device;
- the `configurationRevision` and the `generation` ticket that commands guard on;
- capabilities for power, brightness, native modes, moments, media, scenes, zones and preview, each `{supported: false}` or `{supported: true}` with its constraints, none optional;
- `desired` power, brightness and native mode, each a tagged unknown or known value;
- `observed`: unknown, or known with its evidence time `observedAtMs` and tagged power and brightness;
- the `pending` command count and `pendingKinds`, the command families among them, each once;
- the `lastOutcome` as the profile's outcome payload or unknown;
- `lastTransmission`: unknown, or the last send that reached the device's transport with its time `transmittedAtMs`, the operation IDs it sent and, when it served a command, its `requestId`;
- `externalControl`: unknown, or owned by the module or an external party with its evidence time.

A module SHALL set `lastTransmission` for every transmitted send, including paints it makes itself, which never reach the tracker. A known desired mode SHALL be one the device advertises. An observation, external-control reading or transmission after the envelope `time` SHALL be refused, and so SHALL pending kinds that are empty while commands are pending or outnumber them. No device record SHALL carry an address, credential, private path or the Hub's mode. Missing evidence SHALL be a tagged unknown, never `false` or off, and a transport acknowledgment SHALL NOT be reported as an observation.

The family's minor version 2.1 (Hub #975), registered under `https://bunny.invalid/events/device/2.1` beside 2.0 and sent with the same type, SHALL be the 2.0 record with one more optional member, `held`, and SHALL keep every 2.0 rule. `held` SHALL be present exactly while the module holds the device after a write that may have reached it but went unanswered, which ADR 0012 never retries. It SHALL carry the `requestId` of the operation whose uncertain write holds the device, and `heldAtMs`, when the hold began, and nothing else. The module SHALL omit it once it releases the hold, after a person's later command to the device or a later definitive outcome for that operation. A hold that begins after the envelope `time` SHALL be refused, and so SHALL a held device that is `available`. `device/2.0` SHALL stay registered and unchanged, so a record without `held` stays valid under either version, and a `device/2.0` record that carries `held` SHALL be refused. Each producer SHALL choose one version for its records.

#### Scenario: Valid device records
- **WHEN** an available Nanoleaf wall, a degraded Pixoo and an unreachable LIFX device with an old observation are validated
- **THEN** each is accepted, the unreachable device keeps its last observation with its evidence time, and its later transmission, a paint with no request, stays apart from that observation

#### Scenario: Device record rules
- **WHEN** a record has an `id` with a dot, an uppercase letter, an underscore or more than 128 characters, omits any one of the eight capabilities, gives an unsupported capability constraints or brightness another range than 0 to 100, lacks the core moods for supported moments, desires a mode it does not advertise, carries an observation without its evidence time or after the message time, a transmission after the message time or with an observed value, pending kinds that disagree with the pending count, a pending count over 1,024, a label over 80 characters, an address or a token, uses 1.x service health or controller ownership, or is sent under another subject, kind or type
- **THEN** it is refused with `invalid-message` and a detail naming where

#### Scenario: A held device record
- **WHEN** a degraded Nanoleaf wall whose `held` names the request of a lost brightness write and the time the hold began is validated as `device/2.1`, and the 2.0 fixtures are validated as `device/2.1` without `held`
- **THEN** each is accepted, the 2.0 fixtures stay valid as `device/2.0`, and a record at a version the profile does not register, such as `device/2.2`, is refused with `unsupported-version`

#### Scenario: Held record rules
- **WHEN** a `device/2.1` record's `held` lacks its `requestId` or `heldAtMs`, carries another member, a request ID that is not an identifier or a boolean in place of the object, begins after the message time, or belongs to an `available` device, or a `device/2.0` record carries `held`
- **THEN** it is refused with `invalid-message` and a detail naming where

#### Scenario: Version 2.1 is 2.0 plus `held`
- **WHEN** the 2.1 schema is compared with the 2.0 schema without `held`, its `$id` and its description
- **THEN** they are equal, and both versions register through `registerDeviceFamilies`

### Requirement: General device commands

The profile SHALL define one command family for each kind of controller contract v1's closed command union: `power-set` (`on`), `brightness-set` (`percent`, 0 to 100), `scene-activate` (`sceneId`), `zone-power-set` (`zoneId`, `on`), `media-start` (`playlistId`), `media-control` (`action`) and `device-mode-set` (a native `mode`). Each SHALL be sent as `org.bunny.<entity>.<verb>.requested`, whose verb is the family's last word, and SHALL carry a `requestId` and optional `expectedConfigurationRevision` and `expectedGeneration` guards. The dashboard and MCP SHALL send both guards on a person's command, copied from the device record they showed; a module SHALL refuse a stale guard with `revision-conflict` before changing anything; and the Hub-mode fan-out SHALL send none. The envelope subject of every general command and of `moment-play` SHALL name the target device by its device ID, a routing ID unique across modules, and no payload SHALL name a device, controller, address, credential or raw protocol. Their replies and outcomes SHALL use the profile's reply and outcome payloads. `registerDeviceFamilies` SHALL register the device families after the core families. `commandSupported(capabilities, command)` SHALL report a command, `moment-play` included, as supported only when its capability is supported and the named scene, zone, playlist, action, native mode or mood is advertised, and a moment fits the device's maximum duration.

#### Scenario: Each command reaches a device that supports it
- **WHEN** each general command fixture is checked against its target device's capabilities
- **THEN** it is valid and supported, and each command family has a valid reply and outcome

#### Scenario: Unsupported commands
- **WHEN** a command names an unsupported capability, an unlisted scene, zone, playlist or action, a native mode the device does not advertise, or a moment with an undeclared mood or an over-long duration
- **THEN** `commandSupported` returns false, so the module refuses it with `unsupported-capability`

#### Scenario: Unroutable subjects
- **WHEN** any general command, a `moment-play` request or a `playback-control` request goes to a subject with a dot, an uppercase letter, an underscore or more than 128 characters
- **THEN** it is refused with `invalid-message` and a detail naming the envelope subject

#### Scenario: Malformed commands
- **WHEN** a command names a device, a controller or a raw protocol, misses its request ID, goes to a subject that is not a device ID, misses its value, sets a brightness over 100 or a fractional one, names a playlist by a path, uses a media action outside the union, a 1.x mode spelling, a 1.x ticket as its request ID, or another kind or type
- **THEN** it is refused with `invalid-message` and a detail naming where

### Requirement: Notice acknowledgment

The profile SHALL define `notice-acknowledge`, a core command sent as `org.bunny.notice.acknowledge.requested` with a `requestId`, a `consumerId` and a SHA-256 `noticeId`. Its envelope subject SHALL be the session's entity ID. A consumer SHALL send it to the core to acknowledge one turn-ended notice for its own consumer ID. The core SHALL add that consumer to the notice's `acknowledgedBy`. Acknowledgments are recorded per consumer, and each consumer's policy SHALL decide which acknowledgments clear what it shows, as today. An acknowledgment SHALL NOT be taken as readership, success or a cleared attention item. A consumer SHALL acknowledge for its own consumer ID only: the core SHALL refuse an acknowledgment whose sender's source does not end in that consumer ID with `forbidden`. The core SHALL reply `accepted` for an acknowledgment it recorded or had recorded, `not-found` for an unknown session or notice, `invalid-request` for a consumer it does not record acknowledgments for, and `capacity` when its store is full. It SHALL commit the acknowledgment before it replies, and SHALL publish the session record at a new revision, in the command's trace, and no outcome. Its reply SHALL use the profile's payload.

#### Scenario: A consumer acknowledges a notice
- **WHEN** Pixoo sends `notice-acknowledge` for a session's notice with its own consumer ID, and the core accepts it
- **THEN** the command and the reply are valid, and a reply refusing an unknown notice carries a registered error code

#### Scenario: Acknowledgment rules
- **WHEN** an acknowledgment names a subject that is not a session ID, including one of 63 hexadecimal characters, a neutral notice ID that is not a SHA-256 hash, no consumer or a read state, or is sent as an occurrence or as a `lifecycle` event
- **THEN** it is refused with `invalid-message`

#### Scenario: Another consumer's acknowledgment
- **WHEN** the Nanoleaf module sends `notice-acknowledge` for Pixoo's consumer ID, and then Pixoo acknowledges for itself twice
- **THEN** the first is `forbidden` and changes nothing, Pixoo's is `accepted` and records Pixoo alone at a new revision, and the repeat is `accepted` and changes nothing

### Requirement: Playback control

The profile SHALL define `playback-control`, a core command sent as `org.bunny.playback.control.requested` to the owner of the `playback` record, whose envelope subject is that record's `id`. The record's `id`, and so the subject, SHALL be a routing ID. It SHALL carry a `requestId`, an `action` of `play`, `pause`, `next` or `previous`, and an optional `expectedRevision`. The owner SHALL send it once to the source presented at admission, never redirect or retry it, and answer with the profile's reply and outcome payloads.

#### Scenario: Pausing the presented source
- **WHEN** a `playback-control` request pauses the presented source, and its owner accepts and completes it
- **THEN** the request, the reply and the outcome are valid

#### Scenario: Playback control rules
- **WHEN** a request asks for an action outside the four, names a speaker, goes to a subject that is not a routing ID, or uses another type, or a `playback` record has an `id` that is not a routing ID
- **THEN** it is refused with `invalid-message`

### Requirement: Hub-mode table

The package SHALL publish one fixed table from the Hub's mode to each participating device kind's native mode, in its README and as `HUB_MODE_TABLE` with `nativeMode(kind, mode)`. Nanoleaf SHALL map Work, Quiet and Free one to one; Pixoo SHALL map Work and Quiet to Monitor and Free to Media. LIFX, Tidbyt and playback SHALL NOT take part. The table SHALL map only from the Hub's mode to a native mode, and a device's native mode SHALL NOT be stored as the Hub's mode.

#### Scenario: Each participating device kind
- **WHEN** each Hub mode is mapped for Nanoleaf and for Pixoo
- **THEN** each result is a native mode the device advertises, and the README table equals the code's

#### Scenario: Devices outside the Hub mode
- **WHEN** a Hub mode is mapped for LIFX, Tidbyt or playback
- **THEN** there is no native mode

#### Scenario: A native mode is never the Hub's mode
- **WHEN** a Pixoo mode is stored in the Hub's `mode` record, or the Hub's Work is requested from a Pixoo as a native mode
- **THEN** the record is refused with `invalid-message` and the command is unsupported, and Monitor stands for both Work and Quiet

### Requirement: Shared agent status

The package SHALL provide `sessionState`, `highestStatus` and `STATUS_COLORS` for `session/2.0` records, copied from `@jimmie-potts/agent-status` with provenance notes. A root session SHALL rank attention over working over done, an active child SHALL make its root working, uncertain freshness SHALL NOT hide the owner's state, and read evidence SHALL NOT retire done. Acknowledgments are recorded per consumer, and each caller's policy decides which ones count: by default any consumer's acknowledgment SHALL retire done, as LIFX and Tidbyt use it today, and a caller that names acknowledging consumers SHALL count only theirs. `highestStatus` SHALL read a consumer's copy of the session family and SHALL return `unknown` for no copy, a copy that has not synced or one whose sync failed. Every device SHALL use the same colors as the 1.x helper.

#### Scenario: The copied status cases on session records
- **WHEN** the 1.x status tests run against valid `session/2.0` records
- **THEN** they pass, including the acknowledging-consumer cases, and a copy that has not synced reads as `unknown`

#### Scenario: Today's acknowledgment scope
- **WHEN** Pixoo acknowledges a session's only notice, and one caller names no consumers while another names Nanoleaf
- **THEN** the first sees no `done` and the second still sees `done`

#### Scenario: The same colors and ranking as 1.x
- **WHEN** the 2.0 and 1.x helpers judge the same sessions and their colors are compared
- **THEN** they agree

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

ADR 0012's routing keys, `bunny.<state|event|cmd>.<family>.<id>`, end in the routing ID of the entity they are about, and an entity's routing ID is its `id`, so a command's envelope `subject`, the entity it is for, SHALL be the last token of its routing key. A state or removal SHALL meet the same rule wherever it is published, and an occurrence or outcome that a remote part publishes SHALL too. The SDK SHALL refuse a command, state or removal that breaks it, on every transport, and a remote edge a publish that breaks it, with `invalid-message` before any responder or subscriber has the message, so that a grant of a key covers exactly the entity its responder acts on (Hub #835). A device command's subject is the device's ID, a `playback-control` command's the `playback` record's `id`, and a core command's the session's.

#### Scenario: A command for another entity than its key's
- **WHEN** a command on `bunny.cmd.power-set.pendant-1` names `beam` in its subject, and one on `bunny.cmd.playback-control.living-room` names another speaker
- **THEN** the SDK refuses each with `invalid-message`, and no responder has it

### Requirement: Outcome acknowledgment

The profile SHALL define the core family `outcome-recorded`, an occurrence of type `org.bunny.outcome.recorded` whose payload is `{source, id}`: the core tells the module whose `source` it names that it recorded that module's outcome with message `id` (ADR 0012, "Acknowledging outcomes"). It SHALL travel on `bunny.event.outcome-recorded.<module>`, where `<module>` is the last segment of the outcome's source (`outcomeRecordedKey(source)`), and its envelope `subject` SHALL be the outcome's `id`. Only the core, `bunny/core` (`CORE_SOURCE`), SHALL send it: the validator SHALL refuse one from any other source, and one whose `subject` is not its `id`, with `invalid-message`.

#### Scenario: The core's acknowledgment
- **WHEN** `bunny/core` sends `outcome-recorded` naming `bunny/modules/pixoo` and an outcome's `id` as its subject
- **THEN** it is accepted, and its key is `bunny.event.outcome-recorded.pixoo`

#### Scenario: An acknowledgment from another participant
- **WHEN** a module sends `outcome-recorded`, or the core sends one whose subject is another outcome's ID or that names no outcome
- **THEN** each is refused with `invalid-message`, naming the envelope's `source`, its `subject` or the missing `id`

### Requirement: Operation records

The `operation` state family SHALL carry the latest state of one action the core tracks (Hub #922, #782): its `id`, which SHALL be `operationEntityId(requestId)`, the lowercase hex SHA-256 of its request ID; its `revision`, `requestId`, `kind` (`device`, `moment` or `mode`), `family`, `command`, which SHALL be its family's type, `target` (a routing ID), `requestedBy` (a participant source), `status` (`sent`, `accepted`, `rejected`, `expired`, `uncertain`, `completed` or `conflict`), `sentAtMs`, `updatedAtMs` and `deadlineAtMs`, and, when known, `result`, `evidence`, `error` and the owner's `reply`. A record whose status is `sent` or `accepted` SHALL carry no `result`, and any other SHALL carry one; a failed result SHALL carry its error, and a succeeded one `transmitted` or `observed` evidence and no error. Its `kind` SHALL retain the tracker's existing category and deadline class, without implying a physical target; `family` and `target` SHALL identify the action, including tracked core-local metadata changes. Evidence SHALL describe the action's transmitted or observed effect. A record SHALL carry no command payload. Removal of an operation SHALL use the profile's removal with reason `retired`. The inbox (#923) SHALL point at an operation by its request ID.

#### Scenario: Valid operation records
- **WHEN** an accepted record, a completed one with observed evidence and the removal of a retired one are validated, and a consumer applies them in order
- **THEN** each is accepted, and the consumer's copy holds no operation

#### Scenario: Records the profile refuses
- **WHEN** an operation's `id` is not its request ID's, its command is another family's type, a pending one carries a result, a settled one has none, a failed one has no error or a succeeded one has evidence `none` or absent
- **THEN** each is refused with `invalid-message`, naming the identity, the command, the result, the result, the error and the evidence (including missing evidence) in turn

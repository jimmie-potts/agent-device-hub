## MODIFIED Requirements

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

### Requirement: Core payload families

The profile SHALL define the core payload families, each a closed schema built from the shared blocks, registered under `https://bunny.invalid/events/<family>/2.0` and bound to one kind and one type:
- state: `session`, `mode`, `inbox-item` and `playback`, as `org.bunny.<family>.updated`;
- occurrence: `lifecycle` as `org.bunny.lifecycle.observed`, plus `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended` and `moment-ended`, as `org.bunny.attention.raised`, `org.bunny.attention.cleared`, `org.bunny.turn.ended`, `org.bunny.session.ended` and `org.bunny.moment.ended`;
- command: `mode-set` as `org.bunny.mode.set.requested`, `moment-play` as `org.bunny.moment.play.requested`, `notice-acknowledge` as `org.bunny.notice.acknowledge.requested` and `playback-control` as `org.bunny.playback.control.requested`.

A message of a core family that uses another kind or type SHALL be refused with `invalid-message`. No core family SHALL carry a device-specific payload.

#### Scenario: A valid message of every family
- **WHEN** the shared fixtures' valid messages are validated, including a reply and an outcome for each command family
- **THEN** each is accepted, and every core family and every message kind has at least one

#### Scenario: Wrong kind or type for a family
- **WHEN** a session record is sent as an occurrence, or under a type other than `org.bunny.session.updated`
- **THEN** it is refused with `invalid-message` and a detail naming the envelope's `kind` or `type`

### Requirement: Lifecycle evidence is preserved

The `lifecycle` family SHALL carry every field of a lifecycle 1.x observation except the acknowledgment: identity, turn, parent, the native event ID, the event with its attention, read or unavailable evidence, the observation and occurrence instants, ordering, project ID, label, title, project and host session ID. A 1.x `notice.acknowledged` observation SHALL become a `notice-acknowledge` command, and the `lifecycle` family SHALL refuse a `notice-acknowledged` event. Event kinds SHALL be kebab-case. A known parent in another provider, client, host or source, or with the same session ID, SHALL be refused with `invalid-message`. This applies to session records and lifecycle observations alike. Known ordering SHALL name the identity's `sourceId` as its authority.

#### Scenario: Cross-source parentage
- **WHEN** a session record or lifecycle observation names a known parent in another source or provider, or itself as parent
- **THEN** it is refused with `invalid-message` and a detail naming `/parent/identity`

#### Scenario: 1.x corpora convert without loss
- **WHEN** every valid lifecycle 1.0, 1.1 and 1.2 fixture and every valid snapshot session fixture is converted by the mapping rules
- **THEN** each result is accepted, an acknowledgment becomes a valid `notice-acknowledge` command when it names a SHA-256 notice ID, and each 1.x per-record or per-observation refusal in the selected list is refused in 2.0 too

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

## ADDED Requirements

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

#### Scenario: Valid device records
- **WHEN** an available Nanoleaf wall, a degraded Pixoo and an unreachable LIFX device with an old observation are validated
- **THEN** each is accepted, the unreachable device keeps its last observation with its evidence time, and its later transmission, a paint with no request, stays apart from that observation

#### Scenario: Device record rules
- **WHEN** a record has an `id` with a dot, an uppercase letter, an underscore or more than 128 characters, omits any one of the eight capabilities, gives an unsupported capability constraints or brightness another range than 0 to 100, lacks the core moods for supported moments, desires a mode it does not advertise, carries an observation without its evidence time or after the message time, a transmission after the message time or with an observed value, pending kinds that disagree with the pending count, a pending count over 1,024, a label over 80 characters, an address or a token, uses 1.x service health or controller ownership, or is sent under another subject, kind or type
- **THEN** it is refused with `invalid-message` and a detail naming where

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

The profile SHALL define `notice-acknowledge`, a core command sent as `org.bunny.notice.acknowledge.requested` with a `requestId`, a `consumerId` and a SHA-256 `noticeId`. Its envelope subject SHALL be the session's entity ID. A consumer SHALL send it to the core to acknowledge one turn-ended notice for its own consumer ID. The core SHALL add that consumer to the notice's `acknowledgedBy`. Acknowledgments are recorded per consumer, and each consumer's policy SHALL decide which acknowledgments clear what it shows, as today. An acknowledgment SHALL NOT be taken as readership, success or a cleared attention item. Its reply and outcome SHALL use the profile's payloads.

#### Scenario: A consumer acknowledges a notice
- **WHEN** Pixoo sends `notice-acknowledge` for a session's notice with its own consumer ID, and the core accepts it
- **THEN** the command and the reply are valid, and a reply refusing an unknown notice carries a registered error code

#### Scenario: Acknowledgment rules
- **WHEN** an acknowledgment names a subject that is not a session ID, including one of 63 hexadecimal characters, a neutral notice ID that is not a SHA-256 hash, no consumer or a read state, or is sent as an occurrence or as a `lifecycle` event
- **THEN** it is refused with `invalid-message`

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

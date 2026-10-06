## MODIFIED Requirements

### Requirement: Module payload schemas

A module SHALL register its payload schemas under `https://bunny.invalid/events/<family>/<major>.<minor>`, built from the shared blocks. Registration SHALL refuse reserved families, malformed identifiers and duplicates. A registration MAY include a check for a rule the schema cannot state, such as two fields that must agree. The check SHALL run only after the payload schema passes. A message that fails it SHALL be refused with `invalid-message` and a detail that names where it failed.

#### Scenario: Registering a module schema
- **WHEN** a module registers a payload schema and validates a message that uses it
- **THEN** a conforming message is accepted and a nonconforming payload is refused, and registering the same identifier, a reserved family or a malformed identifier throws

#### Scenario: A registered check
- **WHEN** a module registers a payload schema with a check, and validates a message whose payload passes the schema but breaks the check
- **THEN** the message is refused with `invalid-message` and the check's detail, and a payload that breaks the schema is refused with the schema's detail first

## ADDED Requirements

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

Each state event SHALL carry the complete current record of one entity, and its envelope `subject` SHALL be the entity's `id`. A session record SHALL carry its identity and parent, its turn, activity, attention and notices, its read and unavailable evidence, ordering, evidence instants, freshness, restart uncertainty and child counts, its generation, and any label, title, project, project ID and host session ID. A session's `id` SHALL be the lowercase hex SHA-256 of its identity with sorted keys. A record SHALL be refused when its read evidence is not from Codex Desktop, it carries a host session ID below a known parent, restart uncertainty claims current freshness, it repeats a notice ID or an unavailable dimension, or its `id` is not the identity key. A label SHALL carry its origin. The display title SHALL be the label, then the title, then the consumer's neutral fallback.

#### Scenario: Record rules
- **WHEN** a session record reports read evidence for Claude, a host session ID on a child, current freshness while restart-uncertain, a repeated notice or unavailable dimension, or an `id` or `subject` that is not the identity key
- **THEN** it is refused with `invalid-message` and a detail naming the failing field

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

Agent occurrences SHALL name the session's `id` and identity, the turn, the observation's instants and ordering and the owner revision that committed them. `attention-raised` SHALL name the attention item. `attention-cleared` SHALL name it and its cause: `resolved`, `turn-ended`, `turn-started` or `recovered`. `turn-ended` MAY name the retained notice. `session-ended` SHALL precede the removals of the retired records. `moment-ended` SHALL name the request, the moment, its ending (`completed`, `preempted`, `superseded` or `interrupted`) and its instant.

#### Scenario: Occurrence rules
- **WHEN** an occurrence names a session `id` that is not its identity's key, uses another subject, or gives an unknown clearing cause or moment ending
- **THEN** it is refused with `invalid-message`

### Requirement: Device-neutral requests

`mode-set` SHALL request a Hub mode of `work`, `free` or `quiet`, with an optional expected revision. `moment-play` SHALL request one moment:
- its moment ID and a kebab-case mood;
- an optional palette of 1 to 8 colors;
- a duration of 1,000 to 300,000 ms;
- a priority class and whether it covers status;
- a wall-clock `startAtMs`, at most 60,000 ms after the envelope `time`, and a tolerance of up to 60,000 ms.

Neither payload SHALL name a device, controller, ticket or controller clock. A flourish SHALL NOT cover status. Their replies and outcomes SHALL use the profile's reply and outcome payloads.

#### Scenario: A request that names a device
- **WHEN** a mode or moment request carries a `deviceId`, a `controllerId` or a controller-monotonic `start`
- **THEN** it is refused with `invalid-message`

#### Scenario: Moment limits
- **WHEN** a flourish covers status, a duration is under 1,000 ms, a tolerance is over 60,000 ms or a start is more than 60,000 ms after the envelope `time`
- **THEN** the request is refused with `invalid-message`

### Requirement: Removal, expiry and sync membership

An owner SHALL remove an entity with a removal event whose reason is `expired` for an expired session, `retired` for each record of a retired subtree, and `deleted` for a deleted entity such as a handled inbox item. A sync SHALL replace the consumer's membership of the synced families. A consumer SHALL NOT keep an entity that a removal or a sync dropped. It SHALL NOT restore an entity from a state event at or below the removal's revision or the sync's revision.

#### Scenario: Expiry, retirement and deletion
- **WHEN** a consumer holding sessions and inbox items applies an expired removal, the retired removals of a subtree at one revision, or a deleted removal
- **THEN** it holds exactly the remaining entities, and a later state event with an older revision does not restore a removed one

#### Scenario: A sync drops a held entity
- **WHEN** a consumer that missed a retirement syncs the session family, and the owner's `sync.completed` lists only its current members
- **THEN** the consumer drops the entities it still held that are not members, keeps other families, and holds what the owner holds

#### Scenario: A real owner's expiry and retirement
- **WHEN** an agent-state owner expires a session after 24 hours without evidence, or retires a parent and its known descendants on a runtime end, and its changes are published as 2.0 messages
- **THEN** each message is valid, the removals carry `expired` or `retired` at one revision, and a live consumer and a consumer that synced afterwards both hold exactly the owner's records

### Requirement: 1.x field mapping

The package SHALL publish a mapping from every 1.x field to its 2.0 home. It covers the agent-state session record and snapshot, the lifecycle observation, the controller receipt and the moment command. A 2.0 home is a family field, an envelope attribute, a profile-owned payload, a derived value or the owner's own store. A field with no 2.0 home SHALL have a recorded disposition.

#### Scenario: Every field is named
- **WHEN** the field paths of the 1.x snapshot session, durable stored session, snapshot, lifecycle 1.2 envelope, controller receipts and moment command schemas are compared with the mapping
- **THEN** every path appears in its section

#### Scenario: Every receipt converts
- **WHEN** every receipt in the controller corpus, and every receipt shape the 1.1 schema accepts, is converted by the mapping rules
- **THEN** each becomes a valid reply or outcome with a registered error code

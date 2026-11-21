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

### Requirement: Bookkeeping members of state families

Each state family SHALL declare its bookkeeping members (Hub #1771): the members that may change while the state the record describes does not, such as a reading, paint or update time. A declaration SHALL be by family, not by version, as JSON pointers to object members at any depth, beside the family's schema: the contracts package's `v2/bookkeeping` for the families it defines, and a module's registration for the module's own families. A family with no bookkeeping member SHALL declare an empty list, which is a deliberate answer that every member counts. The declaration SHALL be metadata only: it SHALL change no message, schema, payload, wire value or validation result, and SHALL NOT be a family version.

A pointer SHALL be refused unless it names an object member, never an array position, that holds a number, or a number or null, in every registered version of the family: every alternative found through `$ref`, `allOf`, `oneOf` and `anyOf`, at any depth, SHALL be an `integer` or `number` type, with its bounds and notes, or null, and at least one SHALL be a number. An `enum`, a `const` other than null, a `boolean` or `string`, an object or array, an unconstrained schema and any other keyword SHALL be refused wherever they appear. A pointer through `__proto__`, `constructor` or `prototype` SHALL be refused. A pointer SHALL be refused when any of its members is one that is never bookkeeping: `id`, `revision`, `availability`, `generation`, `configurationRevision`, `held`, `status`, `power`, `brightness`, `desired`, `pending`, `pendingKinds`, `lastOutcome`, `requestId`, `operationIds`, `enabled`, `durationMs`, `settingsRevision`, `startedAtMs`, `deadlineMs`, `lastAttempt`, `showing`, `freshness` or `failing`. A settings family (`mode`, the lighting, playback and home layouts, `art-schedule`, `preference-state`, `pixoo-playlist` and the Nanoleaf animations, reactive presets and shows) SHALL declare none. Two records of one family SHALL hold the same state when they are equal once the value of each bookkeeping member that is present and not null, and of `id` and `revision`, is set aside. A bookkeeping member that is absent, null or holds a value SHALL be three different states, so its appearing, disappearing or becoming null is a change and only its value never counts. A change of any other leaf alone SHALL make them differ.

The declared members SHALL be: `device` `/observed/observedAtMs`, `/lastTransmission/transmittedAtMs` and `/externalControl/observedAtMs`; `power-limit` `/observedAtMs` and `/updatedAtMs`; `playback` `/observedAtMs`; `pixoo-display` `/monitor/page`; `roborock-vacuum` `/observedAtMs/value`; and `lifx-light` `/observed/observedAtMs`. Every other state family, `session` included, SHALL declare none. History's own rule for a `session` state whose only changes are its evidence instants (bunny-runtime "Core history", Hub #1947) SHALL NOT be a declaration here, since `session/2.0` and `2.1` have no claims for its pointers.

#### Scenario: Every state family is classified
- **WHEN** the tests compare a checked-in classification of every state family and version of the core and of every registered module with the families the contracts package and the registrations define, and with the declarations
- **THEN** each state family and version is listed with exactly its declared members, and a family or version added without an entry fails

#### Scenario: A member that is never bookkeeping
- **WHEN** a declaration names a member that is never bookkeeping, at the top, nested, or as the parent of another member
- **THEN** it is refused and the refusal names that member

#### Scenario: A pointer the schema does not declare
- **WHEN** a declaration names a member that some version of the family's schema does not declare, an array position, a member that holds other members, or a member that may hold anything but a number or null, such as a state enumeration hidden in any alternative
- **THEN** it is refused

#### Scenario: Every other leaf still counts
- **WHEN** each leaf of a declared family's fixture record that is not a bookkeeping member, `id` or `revision` is changed alone
- **THEN** the changed record does not hold the same state as the fixture, nor does one in which a bookkeeping member became null or absent, and a record whose only changes are the values of its bookkeeping members does

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

It SHALL refuse undeclared attributes. Commands and sync requests SHALL carry `expiresat`, and no other kind may carry it. The `type` suffix SHALL match the kind. Replies, outcomes, removals and sync messages SHALL use the payload schemas the profile owns.

#### Scenario: A valid message of each kind
- **WHEN** the shared fixtures' valid message for each of the eight kinds is validated
- **THEN** each is accepted

#### Scenario: Envelope violations
- **WHEN** a message lacks `traceparent`, has an all-zero trace ID, uses a non-URI `dataschema`, adds an undeclared attribute, omits milliseconds from `time`, carries `expiresat` on a state event, omits `expiresat` from a command or uses a `type` suffix that does not match its kind
- **THEN** it is refused with `invalid-message` and a detail naming where the check failed

#### Scenario: Unsupported profile or payload version
- **WHEN** a message names another `bunnyprofile`, or a version of a registered payload family that is not registered
- **THEN** it is refused with `unsupported-version`

#### Scenario: Unknown payload family
- **WHEN** a message names a payload family that nobody registered
- **THEN** it is refused with `unknown-schema`

### Requirement: Size, expiry and retry identity

A message SHALL be at most 256 KiB as UTF-8 JSON, checked before any schema check. Input that is not plain JSON data SHALL be refused without throwing. When the reader passes its clock, a command or sync request at or past `expiresat` SHALL be refused. Retry identity SHALL be `(source, id)`: the same identity with the same content is a duplicate, and with different content a conflict.

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

A reply SHALL either accept a request or carry an error body. A completed outcome SHALL report `succeeded`, `failed` or `uncertain` with `transmitted`, `observed` or `none` evidence. A failed outcome SHALL carry an error, a succeeded outcome SHALL carry no error, and a succeeded outcome SHALL report `transmitted` or `observed` evidence.

#### Scenario: Inconsistent outcome or reply
- **WHEN** a reply has both an accepted status and an error, a failed outcome has no error or a succeeded outcome reports no evidence
- **THEN** the message is refused with `invalid-message`

### Requirement: One error body and code registry

Every boundary SHALL report errors as `{"error":{"code","retryable","requestId"?,"traceId"?,"detail"?}}`. Codes SHALL come from one registry, which sets `retryable` for each code. Building an error body with an unregistered code SHALL fail.

#### Scenario: Error body from the registry
- **WHEN** an error body is built for `capacity` and for `uncertain-result`
- **THEN** `retryable` is true for `capacity` and false for `uncertain-result`, and an unregistered code throws

### Requirement: Module payload schemas

A module SHALL register its payload schemas under `https://bunny.invalid/events/<family>/<major>.<minor>`, built from the shared blocks. Registration SHALL refuse reserved families, malformed identifiers and duplicates.

#### Scenario: Registering a module schema
- **WHEN** a module registers a payload schema and validates a message that uses it
- **THEN** a conforming message is accepted and a nonconforming payload is refused, and registering the same identifier, a reserved family or a malformed identifier throws

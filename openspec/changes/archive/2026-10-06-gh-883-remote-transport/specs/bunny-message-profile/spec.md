## MODIFIED Requirements

### Requirement: One envelope for every message kind

Profile 2.0 SHALL define one CloudEvents 1.0 structured JSON envelope for every B.U.N.N.Y. message. The kinds are `state`, `removal`, `occurrence`, `command`, `reply`, `outcome`, `sync-request` and `sync-completed`. The envelope SHALL require:
- `bunnyprofile` `2.0`;
- `id`, `source`, `type` and `subject`;
- `time`, with millisecond precision in UTC;
- `kind` and `datacontenttype`;
- an absolute `dataschema` URI;
- a nonzero W3C `traceparent`.

It SHALL refuse undeclared attributes and impossible dates. Commands and sync requests SHALL carry `expiresat`, and no other kind may carry it. The `type` suffix SHALL match the kind: a command's type names an entity and a verb before `.requested`, and only sync messages may use `org.bunny.sync.requested` and `org.bunny.sync.completed`. A sync request's `subject` SHALL name its requested families joined by commas, in the order requested, and its `sync.completed` SHALL carry the same subject. Replies, outcomes, removals and sync messages SHALL use the payload schemas the profile owns.

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

#### Scenario: Sync subjects
- **WHEN** the shared fixtures' sync requests and `sync.completed` messages are read
- **THEN** each subject is the requested families joined by commas, such as `session`

## ADDED Requirements

### Requirement: Profile 1.3 registers the runtime's decision records and spans

The artifact SHALL be version 1.3.0 with profiles 1.0, 1.1, 1.2 and 1.3, and producers SHALL still default to profile 1.1. Profile 1.3 SHALL be profile 1.2 plus:
- under `bunny.runtime`, the bus's decisions `runtime.command.admitted`, `runtime.command.refused`, `runtime.command.cancelled`, `runtime.command.replied` and `runtime.command.uncertain`, the sync decisions `runtime.sync.served`, `runtime.sync.refused` and `runtime.sync.restarted`, the edge's `runtime.edge.failed`, and `runtime.tracing.failed` when the runtime's span recording cannot start;
- under `bunny.module`, `outcome.published`, `outbox.deferred`, `device.unavailable` and `device.available`;
- the attributes `bunny.routing.key`, an SDK routing key of at most 512 characters, `bunny.outbox.waiting_count` and `bunny.attempt_count`;
- the span names `bunny.outcome.publish` and `bunny.device.call`.

Profiles 1.0, 1.1 and 1.2 SHALL reject every profile 1.3 event and attribute, and the catalog SHALL list the span names each profile adds. A profile SHALL register every span name but those a later profile adds, so the TypeScript host adapter and the Python helper SHALL record no span whose name the profile of its metadata does not register. `bunny.request.id` SHALL keep its profile 1.0 pattern. The Python helper SHALL validate and convert profile 1.3 records.

#### Scenario: Additions closed to earlier profiles
- **WHEN** a record uses a profile 1.3 event or attribute and claims profile 1.0, 1.1 or 1.2
- **THEN** it is invalid, and projecting it to 1.2 fails, while a 1.2 record projects to 1.3

#### Scenario: Cross-language profile 1.3 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the runtime's decision, outbox and device records and their negative controls: an event under the wrong scope, a module record without its name, a routing key that is a pattern or a URL, an error message in `error.type`, a negative count, and a 1.3 record labeled 1.2
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus against the installed archive

#### Scenario: Schema and catalog agree
- **WHEN** the schema's enums and attribute definitions are compared with the catalog, and the catalog with profile 1.0's vocabulary plus each profile's additions
- **THEN** they list the same versions, services, scopes, events, bodies, attributes and span names

## MODIFIED Requirements

### Requirement: Profile 1.2 registers the B.U.N.N.Y. runtime

The artifact SHALL hold profiles 1.0, 1.1 and 1.2 from version 1.2.0 on, and producers SHALL still default to profile 1.1. Profile 1.2 SHALL be profile 1.1 plus the runtime's vocabulary: the `runtime` service; the `bunny.runtime` scope for the runtime's own records and one `bunny.module` scope for every module's records; the runtime's events; the module events `message.received`, `outbox.republished` and `outbox.acknowledged`; and the attributes they use, among them `bunny.module`, `bunny.participant`, `bunny.pattern`, `bunny.code`, `bunny.phase`, `bunny.route`, `server.port`, `error.type` and `error.code`. A record SHALL carry a listener's port, never its URL, and an edge refusal SHALL carry its registry code's fixed reason in the existing `bunny.reason`, never free text. `error.type` and `error.code` SHALL be identifiers of at most 64 characters. Profiles 1.0 and 1.1 SHALL reject every profile 1.2 addition. The catalog SHALL list each profile's additions and, for each runtime scope, the services and events it allows. Both runtime scopes SHALL belong to the `runtime` service; a `bunny.module` record SHALL name its module in `bunny.module` and use only the events listed for that scope; the runtime's own events SHALL appear only under `bunny.runtime`. A new runtime or module event or attribute SHALL be a catalog change with fixtures, contract review and the packaged-consumer checks. A built record SHALL keep only the attributes its own profile registers, in TypeScript and Python. The Python helper SHALL validate and convert profile 1.2 records without a change to validation.

#### Scenario: Additions closed to earlier profiles
- **WHEN** a record uses a profile 1.2 service, scope, event or attribute and claims profile 1.0 or 1.1
- **THEN** it is invalid, and projecting such a 1.2 record to 1.1 fails, while a 1.2 record without them projects to 1.1 and a 1.1 record projects to 1.2

#### Scenario: Runtime scope rules
- **WHEN** a record puts a runtime event under `bunny.module` or another scope, a module event under `bunny.runtime`, a `bunny.module` record without its module's name, or either runtime scope under another service
- **THEN** it is invalid

#### Scenario: Cross-language profile 1.2 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the runtime's records and their negative controls: an unregistered event, a raw message, a stack, a URL with a token, a module name with spaces, a URL, a route that is a path, a free-text reason, the edge's detail, a missing resource field, a module record under the wrong scope or without its name, and a 1.2 record labeled 1.0 or 1.1
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus and tests against the installed archive

#### Scenario: Schema and catalog agree
- **WHEN** the schema's enums and attribute definitions are compared with the catalog
- **THEN** they list the same versions, services, scopes, events, bodies and attributes, and each body is distinct

#### Scenario: Construction leaves out what the catalog does not register
- **WHEN** a profile 1.2 record is built from input with an unregistered attribute holding a raw message, or with a URL in a registered attribute
- **THEN** the built record keeps profile 1.2 and holds no part of the message, and the record with the URL is refused

#### Scenario: Construction keeps only the record's own profile
- **WHEN** records are built at profile 1.0, at the default profile 1.1 and at profile 1.2, in TypeScript and Python, from input with `bunny.queue.depth` and the profile 1.2 attribute `error.type`
- **THEN** the 1.0 record holds neither, the 1.1 record holds only `bunny.queue.depth`, the 1.2 record holds both, and each record is valid at its own profile

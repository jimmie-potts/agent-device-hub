## MODIFIED Requirements

### Requirement: Profile 1.3 registers the runtime's decision records and spans

Profile 1.3 SHALL be profile 1.2 plus:
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

## ADDED Requirements

### Requirement: Profile 1.4 registers the runtime gateway's records

The artifact SHALL be version 1.4.0 with profiles 1.0, 1.1, 1.2, 1.3 and 1.4, and producers SHALL still default to profile 1.1. Profile 1.4 SHALL be profile 1.3 plus the attributes `http.route`, the template of a gateway route of at most 256 characters of a path's own characters, never a query or a URL, and `http.request.method`, one of `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS` or `_OTHER`; and, under `bunny.runtime`, the event `runtime.edge.reloaded`. Profiles 1.0 to 1.3 SHALL reject each, and profile 1.4 SHALL add no span name. The Python helper SHALL validate and convert profile 1.4 records.

#### Scenario: A gateway route in a refusal
- **WHEN** a `runtime.edge.refused` record names a gateway route and an old Hub route with a placeholder and a wildcard, a route with a query, a URL, a route over 256 characters and an unregistered method, and a reload record succeeds and fails
- **THEN** the routes with templates and both reload records are valid at 1.4 and invalid at 1.3, and the query, the URL, the long route and the method are invalid

#### Scenario: Cross-language profile 1.4 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the gateway's refusals, the reloads and their negative controls
- **THEN** both reach the same verdicts, normalized records and OTLP output

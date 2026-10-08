## MODIFIED Requirements

### Requirement: Profile 1.4 registers the runtime gateway's records

Profile 1.4 SHALL be profile 1.3 plus the attributes `http.route`, the template of a gateway route of at most 256 characters of a path's own characters, never a query or a URL, and `http.request.method`, one of `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS` or `_OTHER`; and, under `bunny.runtime`, the event `runtime.edge.reloaded`. Profiles 1.0 to 1.3 SHALL reject each, and profile 1.4 SHALL add no span name. The Python helper SHALL validate and convert profile 1.4 records.

#### Scenario: A gateway route in a refusal
- **WHEN** a `runtime.edge.refused` record names a gateway route and an old Hub route with a placeholder and a wildcard, a route with a query, a URL, a route over 256 characters and an unregistered method, and a reload record succeeds and fails
- **THEN** the routes with templates and both reload records are valid at 1.4 and invalid at 1.3, and the query, the URL, the long route and the method are invalid

#### Scenario: Cross-language profile 1.4 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the gateway's refusals, the reloads and their negative controls
- **THEN** both reach the same verdicts, normalized records and OTLP output

## ADDED Requirements

### Requirement: Profile 1.5 registers a store's costly saves

The artifact SHALL be version 1.5.0 with profiles 1.0, 1.1, 1.2, 1.3, 1.4 and 1.5, and producers SHALL still default to profile 1.1. Profile 1.5 SHALL be profile 1.4 plus, under `bunny.module`, the events `storage.cost.high` and `storage.cost.normal`, and the attributes `bunny.state.bytes`, the size in bytes of the state a save wrote, a nonnegative safe integer, and `bunny.save.duration_ms`, the time one save took in milliseconds, nonnegative and at most one day. Profiles 1.0 to 1.4 SHALL reject each, and profile 1.5 SHALL add no span name. The Python helper SHALL validate and convert profile 1.5 records.

#### Scenario: A costly save's record
- **WHEN** a `storage.cost.high` record carries a size in bytes, another a save's time, and a `storage.cost.normal` record a time, each under `bunny.module` with its module's name, and the same records claim profile 1.4 or the `bunny.runtime` scope, or carry a fractional size, the state's text as its size, or a time over a day
- **THEN** the three are valid at 1.5, invalid at 1.4 and fail to project to it, and the others are invalid

#### Scenario: Cross-language profile 1.5 fixtures
- **WHEN** TypeScript and Python process the shared corpus with the costly-save records and their negative controls
- **THEN** both reach the same verdicts, normalized records and OTLP output, and the packaged consumer passes the same corpus against the installed archive

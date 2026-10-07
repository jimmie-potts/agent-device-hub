## ADDED Requirements

### Requirement: Decision records and recorded spans

The runtime SHALL connect the SDK's `onDiagnostic` on its bus and its edge to its log writer: each bus and edge decision SHALL become one record under the `bunny.runtime` scope, `runtime.<event>`, at the level the SDK set, carrying the work's trace and, as registered attributes, the participant (`bunny.participant`), the routing key (`bunny.routing.key`), `sync <families>` (`bunny.pattern`), the request and message IDs, the outcome, the registry code with its fixed reason, the edge's route, the exception's type (`error.type`) and the attempt count. It SHALL record the bus's spans under `bunny.runtime` and each module's spans from `trace.start` under `bunny.module`, naming the module, through the observability package's `createHostDiagnostics` with tracing on, 100% head sampling that honors a parent's sampled flag, no exporter and a bounded local span sink. Each finished span SHALL go to `RuntimeOptions.spans`, or, without one, to an in-memory buffer of the latest 1,024 that `runtime.spans()` returns with the count of older spans it evicted, oldest first, so a reader can tell an evicted span from one that never arrived. Stopping the runtime SHALL stop its modules first and then flush its spans within the contract's one-second bound. A failing log or span sink SHALL NOT change a result, and if the host adapter cannot start, the runtime SHALL run without recorded spans and SHALL write one `runtime.tracing.failed` record at ERROR with only the exception's type.

#### Scenario: A command's records and spans in the runtime
- **WHEN** a module's request to another module is accepted, and a remote part's request is refused by the owner
- **THEN** each makes one `runtime.command.admitted` and one `runtime.command.replied` contract record with its trace, the module's spans and the bus's spans reach the span sink as projected OTLP spans with durations and status, the queue and execute spans are children of the request span, and the device span is the command's child under `bunny.module`

#### Scenario: Tracing that cannot start
- **WHEN** the host adapter refuses to start
- **THEN** the runtime records no spans and writes one valid `runtime.tracing.failed` record at ERROR with `error.type` and never the exception's message

#### Scenario: The in-memory span bound
- **WHEN** a runtime without a span sink records six spans more than 1,024
- **THEN** `runtime.spans()` holds the latest 1,024, oldest first, and counts six evicted

#### Scenario: A failing span or log sink
- **WHEN** the span sink and the log sink throw on everything
- **THEN** every request ends as it does with working sinks, and `runtime.stopped`, when its sink works, counts the lost spans

#### Scenario: A secret in an exception
- **WHEN** a handler, the edge and a device call throw errors whose messages hold `tok_SYNTHETIC123`
- **THEN** no record, span or response holds it, and the edge's `runtime.edge.failed` record carries only the route and `error.type`

### Requirement: Records in the scenario catalog

The scenario catalog SHALL assert the runtime's records on both transports: in the end-to-end path, each command's admission and its one ending record at the ADR's level, with its request ID and trace; the refusal of a command with no responder; and, across the crash, the lost acknowledgment and the restarts, exactly one `outcome.published` record for each outcome, so a replayed outcome makes no second record. The in-memory harness SHALL record the bus's and the modules' spans, and its tests SHALL check that no span has a lost parent and that each replayed outcome's publish span links to its stored context without being its child.

#### Scenario: Records on both transports
- **WHEN** the catalog runs in the in-memory harness, in process and through the edge
- **THEN** every scenario passes with its records asserted, and the end-to-end path's spans have no lost parent and link each replay to its original context

## MODIFIED Requirements

### Requirement: Diagnostic-contract log records

Every record the runtime writes SHALL be a diagnostic-contract record (`docs/observability-contract.md`) of profile 1.3, built by the contract's `createRecord`, written by default as one JSON line on stderr: `schema_version` `1.3`, the timestamp, the severity pair, a registered event with its static body, the resource, the scope with version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The resource SHALL be service `runtime` in namespace `bunny`, `service.version` the runtime package's version, a neutral `service.instance.id` that the process draws once and that every writer in it and the watchdog thread share, and `deployment.environment.name` from the `--environment` argument: `development` by default, or `test` or `production`; any other value SHALL exit with status 2 and a usage line. The runtime's own records SHALL have scope `bunny.runtime`, and a module's SHALL have scope `bunny.module`. The contract SHALL refuse, and the runtime SHALL drop whole and count, a record with an unregistered event, an event outside its scope or a value outside its registered type; attributes the catalog does not register SHALL be left out, and so SHALL a `bunny.request.id` that its registered pattern refuses, so that the record is kept. A module SHALL log only the events the catalog registers for `bunny.module`. A record SHALL carry a listener's port, never its URL. Beside the stdout ready line, which SHALL stay `{"event":"runtime.ready","url":...}`, the process SHALL write a `runtime.ready` record, and `runtime.stopped` SHALL count the records the writer dropped and its sink lost, with the spans that were invalid, dropped or unfinished at shutdown, or that their sink lost. A sink that throws SHALL lose only its record, and a closed stderr SHALL be ignored, so that neither changes what the runtime or its modules do.

#### Scenario: Every record passes the contract's validator
- **WHEN** the runtime and its fixture modules run in the runtime's tests, in the in-memory harness on both transports, as processes and in a disposable verification run
- **THEN** every record they write passes the contract's validator as its JSON line, every stderr line of a shipped process does too, and each process's records share one instance ID that another process, a restarted one included, does not

#### Scenario: The environment
- **WHEN** the shipped entry point runs without `--environment`, with `--environment production`, or with `--environment staging`
- **THEN** its records carry `development`, then `production`, and the third exits with status 2 and a usage line; a disposable verification run's records carry `test`

#### Scenario: A module's record the contract refuses
- **WHEN** a module logs an unregistered event, one of the runtime's own events, a field the catalog does not register holding a raw message, or a URL in a registered attribute
- **THEN** no record holds the event or the message, the unregistered field is left out of the record that is written, the record with the URL is not written, and the writer counts each record it dropped

#### Scenario: A failing sink
- **WHEN** the sink throws on every record, or the process's stderr is closed
- **THEN** the modules start, answer requests and stop, health answers `ok`, and SIGTERM exits 0

#### Scenario: Maintenance intake reads the runtime's journal
- **WHEN** the stderr lines of a clean run and of a start refused for a relative state directory become synthetic journald rows that intake reads for service `runtime`
- **THEN** intake accepts every line and turns the `runtime.failed` record into a finding, refuses a record in the #880 format or labeled profile 1.1, and accepts none while its configuration names only `hub`

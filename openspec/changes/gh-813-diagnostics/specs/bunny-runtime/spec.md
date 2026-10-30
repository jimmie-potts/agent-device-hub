## ADDED Requirements

### Requirement: Collector export

The configuration file's `diagnostics` section MAY name an export, `"export": {"collector": <origin>}` (Hub #813). The origin SHALL be an exact owned Collector origin, `http://127.0.0.1:<port>`, `http://[::1]:<port>` or `http://host.docker.internal:<port>`, with no path, query or user information; any other value, a member beside `collector`, or an `export` that is not an object SHALL refuse the file with `config-invalid` before any state effect, without quoting the value. With an export, each record the writer lets through SHALL go to the journal first and then to the observability host adapter's bounded OTLP log queue, and each span the adapter records SHALL go to the same Collector after the local span sink, so each signal has one ingestion path and the log floors apply once; the adapter's own severity filter SHALL be set below every level. The export SHALL never be acknowledged to the work that wrote the record: a Collector that refuses, stalls or is absent SHALL change no result, reply, retry or health, and the queue SHALL drop what the Collector does not take within the contract's bound and count it. While the export's drops and failures grow, the runtime SHALL write one `telemetry.dropped` record at WARN under `bunny.runtime` with the totals so far, at most once a minute. `runtime.stopped` SHALL carry the complete totals after the adapter's final flush, as the journal's last word; the export ends before it. Without the member nothing SHALL leave the process, and the journal SHALL never be scraped into the same backend.

#### Scenario: An owned origin and the rest
- **WHEN** the section names `http://127.0.0.1:4318`, `http://[::1]:4318` or `http://host.docker.internal:4318`, and then `https://127.0.0.1:4318`, `http://127.0.0.1:4318/v1/logs`, `http://localhost:4318`, `http://collector:4318`, a LAN address, an origin with user information, an `export` with another member or one without `collector`
- **THEN** the first three are accepted and each of the rest refuses the file with `config-invalid`

#### Scenario: Every record and span once, with its trace
- **WHEN** a module's request to another module is accepted while a loopback Collector accepts every request
- **THEN** every record the journal holds but its last, `runtime.stopped`, reaches the Collector once, in the journal's order and with the same trace identity, the request's four spans reach it, each exported record names its profile, and `runtime.stopped` counts nothing lost

#### Scenario: A Collector that refuses, stalls or is absent
- **WHEN** the Collector answers 500, then holds every request open, and a second runtime names a loopback port nothing listens on
- **THEN** each request is still accepted and health stays `ok`, the first summary minute writes one `telemetry.dropped` record with the failures so far and a minute without growth writes none, stop completes within its bound with `runtime.stopped` carrying the totals as the last record, the summary timer is cancelled, and the refused connections are counted in `runtime.stopped`

#### Scenario: No export section
- **WHEN** the file has no `export` member and a Collector listens on loopback
- **THEN** no request reaches it

## MODIFIED Requirements

### Requirement: Decision records and recorded spans

The runtime SHALL connect the SDK's `onDiagnostic` on its bus and its edge to its log writer: each bus and edge decision SHALL become one record under the `bunny.runtime` scope, `runtime.<event>`, at the level the SDK set, carrying the work's trace and, as registered attributes, the participant (`bunny.participant`), the routing key (`bunny.routing.key`), `sync <families>` (`bunny.pattern`), the request and message IDs, the outcome, the registry code with its fixed reason, the edge's route, the exception's type (`error.type`) and the attempt count. It SHALL record the bus's spans under `bunny.runtime` and each module's spans from `trace.start` under `bunny.module`, naming the module, through the observability package's `createHostDiagnostics` with tracing on, 100% head sampling that honors a parent's sampled flag, a bounded local span sink and, only with the configuration file's `diagnostics.export.collector`, that adapter's OTLP export to the named Collector (Hub #813). Each finished span SHALL go to `RuntimeOptions.spans`, which is a sink or, as `--record-spans` selects, the state directory's span file, or, without one, to an in-memory buffer of the latest 1,024 that `runtime.spans()` returns with the count of older spans it evicted, oldest first, so a reader can tell an evicted span from one that never arrived. The span file SHALL be a pair of owner-only files in the state directory, `spans.ndjson` and `spans.previous.ndjson`, opened without following a link and refused unless each is a regular file of the runtime's user with one link: each segment SHALL hold at most 512 spans or 2 MiB, the next SHALL replace the one before it, and each SHALL start with a header line that counts the spans let go before it, so the pair holds the latest spans, up to 1,024 and at least 512 unless spans are large, since each segment also rotates at 2 MiB, within the contract's 1,024 records and 4 MiB, and a restarted runtime SHALL continue the same files. When the current segment is missing or empty beside a previous one, as after a kill between starting a segment and writing its header, the next header SHALL say that the count of spans let go is unknown, never 0. A span the file cannot take, including one that cannot start a segment, SHALL be lost and counted like any other span a sink fails to take, and the next span SHALL try again, so that recording resumes once the cause has gone. A runtime without the option SHALL write no span file. Stopping the runtime SHALL stop its modules first and then flush its spans within the contract's one-second bound. A failing log or span sink SHALL NOT change a result, and if the host adapter cannot start, the runtime SHALL run without recorded spans and SHALL write one `runtime.tracing.failed` record at ERROR with only the exception's type.

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

#### Scenario: The span file keeps the latest spans within its bound
- **WHEN** a runtime writes more spans than two segments hold, restarts on the same state directory and writes more
- **THEN** the pair holds the latest spans in order, oldest first, no more than two segments of 512 spans or 2 MiB, and the header counts every span let go, so kept and let go account for every span written

#### Scenario: A span file that is not private
- **WHEN** either segment of the span file is a link, has a second hard link or can be read by others
- **THEN** the runtime refuses to start with `span-file-not-private`, before any module starts, and writes nothing through the link

#### Scenario: A kill during a rotation
- **WHEN** a runtime starts after a kill that left no current segment, or an empty one, beside a previous segment, and a reader reads the files
- **THEN** the header says the count is unknown, which the reader reports as unknown and not as 0, and it stays unknown through the rotations after it

#### Scenario: A rotation that fails
- **WHEN** the rename that starts a segment is refused, and then the cause is gone
- **THEN** the spans that came in between are lost and counted, the next span starts the segment, and the spans before and after are kept

#### Scenario: A read during a rotation
- **WHEN** the segments rotate between a reader's read of the previous segment and its read of the current one
- **THEN** the reader reads both again and returns segments that belong together

#### Scenario: Without the option
- **WHEN** a runtime starts without `--record-spans`
- **THEN** it writes no span file and keeps its spans in memory

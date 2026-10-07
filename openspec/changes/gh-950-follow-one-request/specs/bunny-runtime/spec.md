## ADDED Requirements

### Requirement: Following one request in a disposable run

The run's supervisor SHALL answer, on its loopback harness API, a read-only query for one request ID or one trace ID (`GET follow?request=<id>` or `GET follow?trace=<id>`, with `records` and `spans` limits from 1 to 100 that default to 50), under the harness's local-only checks. The answer SHALL be built only from the journal records and spans that pass the diagnostic contract's validator, from their validated, registered values alone, so it holds no payload, no message and no error text; a record or span that the contract refuses SHALL be counted and never shown. A request ID SHALL match only the records and spans that carry it, never another request's on the same trace; a trace ID SHALL match the records on it, its spans and the spans of other traces that link to it. The answer SHALL say what it matched, returned and left out, the traces the matches touch and what else those traces hold, the bus's decisions among the records with the level and code of each ending and whether every admitted command has one, how many matched spans have each name, and, for each span, whether its parent is a kept span, the remote caller's context, a stored message's context or missing. It SHALL name each way the evidence is incomplete as a gap with a fixed meaning: a runtime that ended without writing `runtime.stopped`, telemetry that a runtime reported lost at its stop, spans evicted from the span file or an unknown count, a read that stopped at its bound, a run with no readable span file, records and spans the contract refused, spans whose parent is missing, and the query's own caps. A request or trace that nothing carries SHALL answer `none-found` with a note that this is not evidence that nothing happened, and no answer SHALL claim that nothing happened. A selector or limit that is not valid SHALL answer 400 with `invalid-request` and a fixed message that never repeats it. The `follow-one-request` capture step SHALL run, on a freshly seeded run with the fixture modules, a success, a refusal, an uncertain effect and a replayed outcome, then a command whose runtime was killed before it finished, a request nothing carries and a query over its limits, and SHALL attach each answer and judge what it must and must not say.

#### Scenario: The four cases
- **WHEN** the step follows a switch the lamp accepts, one for a lamp the module does not have, one that the held device answers after its deadline, and one whose outcome a lost acknowledgment and a restart send again
- **THEN** the answers show, in order: one trace with every span's parent kept and no gap; a `not-found` reply at INFO with no device call and no published outcome; an `uncertain` ending at WARN with `uncertain-result` and the late outcome's record; and one `outcome.published` record with two publish spans, the second a root in its own trace that links to the stored context, and the core's duplicate

#### Scenario: A killed runtime
- **WHEN** the runtime is killed between the lamp's commit and its publish, and the next runtime republishes the outcome
- **THEN** the command's answer says no ending is recorded, names the killed runtime as ended without its stop record, reports no request or execute span because they never ended, names the two spans that did end as having missing parents, and shows the outcome's publish span as a linked root in the next runtime

#### Scenario: A request nothing carries
- **WHEN** the query names a request that was never sent
- **THEN** it answers `none-found` with no record, span or trace, names every reason the evidence could be incomplete, such as the killed runtime, and its note says that absence is not evidence that nothing happened

#### Scenario: Evidence that is capped or lost
- **WHEN** a query is limited to two records and one span, the span file has let spans go or was read to its bound, a runtime reported lost telemetry, or the query is given lines that are not valid spans
- **THEN** the answer counts what it matched and what it left out and names each of these as a gap, and counts the records and spans it could not read without showing them

#### Scenario: Another request on the same trace
- **WHEN** two requests share a trace and the query names one
- **THEN** only its own records and spans are returned, and the answer counts what else the trace holds, which a query by trace returns

#### Scenario: A secret in an exception
- **WHEN** a handler throws an error whose message holds `tok_SYNTHETIC950`, and records or spans that are not contract records hold it too
- **THEN** the answer holds it nowhere, shows the failure as a span's `error` status, and counts the records and spans it refused

#### Scenario: A selector or limit that is not valid
- **WHEN** a query names no selector, two, a malformed one, or a limit of 0 or 101
- **THEN** it answers 400 with `invalid-request` and never repeats the input

#### Scenario: A clean restart and a kill
- **WHEN** a run restarts its runtime three times, and later a runtime is killed
- **THEN** each runtime that stopped cleanly has its stop record in the journal and no gap, and only the killed one is named as ended without its stop record

#### Scenario: Cleanup
- **WHEN** a run that holds a span file is stopped
- **THEN** its unit, lease timer and runtime directory are removed with the span file, both ports close, and the proof keeps the attached answers

## MODIFIED Requirements

### Requirement: Disposable verification runs

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge`, `--environment test`, `--log-level info`, `--record-spans` and the run's state directory: with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. The run's grants SHALL be generated per run, one per part, into the state directory's grants file, and never printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, at most five times within any minute, and its simulated devices SHALL keep their state. Starts and restarts SHALL run one after another, and only the current runtime's own exit SHALL count as a crash. A child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The run's ready line SHALL name the runtime's health page, which the preview card links. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, arm a crash between the lamp's commit and its publish, lose an acknowledgment, end a part's stream at the edge, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers, and it SHALL answer a query for one request or trace (see "Following one request in a disposable run"). The supervisor SHALL wait for a stopped runtime's stderr to drain, for at most a second, before it starts the next, so that a clean stop's last record is in the journal. Ending a stream SHALL take only a part's source, `bunny/parts/<role>`. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. A capture step `follow-one-request` SHALL follow one request in each case of the query's proof, and a negative control `control-follow-fails` SHALL fail by expecting to find a request that was never sent. Its disconnect SHALL end the part's stream at the runtime's edge, so the same remote part reconnects and its subscriptions hear of the gap, as in the in-memory harness. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` and `private-state` SHALL fail the start when a run crosses the boundary, judged from what happened rather than from the runtime's arguments, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only. For `no-outbound-connections`, a guard loaded through `NODE_OPTIONS` into the runtime and into each worker thread and Node process that inherits its environment SHALL refuse every outbound TCP connection and UDP datagram made through Node's network modules before anything leaves, and record each attempt. `private-state` SHALL observe the runtime's home, that nothing exists under its default state directory, and that every database the runtime has open is in the run's state directory.

#### Scenario: Start, capture and stop
- **WHEN** a reviewer starts a run with the fixture modules, captures a catalog scenario, reseeds it to `zero-modules` and captures that scenario, then stops it
- **THEN** the preview links the runtime's health page, which answers, each capture passes, `doctor` reports every check passed and both listeners where the receipt says, and `stop` removes the unit, its lease timer and its runtime directory and closes both ports, while proof stays in the proof root and no grant appears in a result, card or receipt

#### Scenario: Every catalog scenario in a run
- **WHEN** each catalog scenario's capture step runs on a freshly seeded run without a user manager
- **THEN** every step passes, attaches its scenario result and asserts the boundaries, the `edge-grants` step syncs with the reader's grant and gets `unauthenticated` without one, and the negative control fails

#### Scenario: A crash in a run
- **WHEN** a crash is armed and a remote part switches the lamp
- **THEN** the remote part's request ends `uncertain-result`, the runtime starts again on the same port, the lamp's outbox republishes its three messages, and the simulated lamp keeps the state it reached

#### Scenario: Boundary crossed
- **WHEN** a run starts the shipped runtime without `--simulate`, a probe module that reaches for the installed Hub's port 8788 with fetch and with `node:http`, or the runtime without `--state-dir`
- **THEN** exactly the matching check fails, naming the crossing; the guard refuses both of the probe's attempts before they connect, and the runtime creates its default state directory under the run's private home, where `private-state` finds it

#### Scenario: The guard's reach
- **WHEN** a process under the guard tries `net`, `http.request`, `http.get`, `https.request`, `fetch`, a UDP send and a UDP connect from its main thread and a worker thread, and `http.get` from a child Node process
- **THEN** none connects or sends, each attempt is in the report file, and without the guard the same attempts reach their listeners

#### Scenario: A part's stream dropped in a run
- **WHEN** the harness ends the reader's stream at the edge, and the operator then switches the lamp
- **THEN** the same remote part reconnects, its subscription hears of the gap once, and it hears the switch's outcome; a module's source is refused with 400

#### Scenario: Overlapping restarts
- **WHEN** three restarts are asked for at once
- **THEN** they run one after another, each answers 200, and the run keeps one healthy runtime on its port

#### Scenario: Negative control on a running run
- **WHEN** a reviewer asks a running run to reseed into a boundary negative control
- **THEN** the command is refused with `start-only-scenario` and exit status 2 before anything changes

#### Scenario: Process cleanup
- **WHEN** a run's supervisor is stopped, or killed
- **THEN** its runtime child is gone and both ports are closed; a killed supervisor's child stops itself

#### Scenario: A run follows one request
- **WHEN** a remote part switches the fixture lamp in a run, and the harness is asked for that request's records and spans
- **THEN** the answer holds the bus's admission and reply, the lamp's records and the core's intake, each with the runtime that wrote it, and the request, queue, execute, device and publish spans with their parents, and a clean first runtime shows no gap

#### Scenario: The proof step
- **WHEN** `follow-one-request` runs on a freshly seeded fixtures run, through a lifecycle run's real transient units and on a run started without a user manager
- **THEN** it passes, attaches one answer for the success, the refusal, the uncertain effect, the replayed outcome, the killed runtime, the absent request, the capped query and the trace, and its negative control `control-follow-fails` fails

### Requirement: Decision records and recorded spans

The runtime SHALL connect the SDK's `onDiagnostic` on its bus and its edge to its log writer: each bus and edge decision SHALL become one record under the `bunny.runtime` scope, `runtime.<event>`, at the level the SDK set, carrying the work's trace and, as registered attributes, the participant (`bunny.participant`), the routing key (`bunny.routing.key`), `sync <families>` (`bunny.pattern`), the request and message IDs, the outcome, the registry code with its fixed reason, the edge's route, the exception's type (`error.type`) and the attempt count. It SHALL record the bus's spans under `bunny.runtime` and each module's spans from `trace.start` under `bunny.module`, naming the module, through the observability package's `createHostDiagnostics` with tracing on, 100% head sampling that honors a parent's sampled flag, no exporter and a bounded local span sink. Each finished span SHALL go to `RuntimeOptions.spans`, which is a sink or, as `--record-spans` selects, the state directory's span file, or, without one, to an in-memory buffer of the latest 1,024 that `runtime.spans()` returns with the count of older spans it evicted, oldest first, so a reader can tell an evicted span from one that never arrived. The span file SHALL be a pair of owner-only files in the state directory, `spans.ndjson` and `spans.previous.ndjson`, opened without following a link and refused unless each is a regular file of the runtime's user with one link: each segment SHALL hold at most 512 spans or 2 MiB, the next SHALL replace the one before it, and each SHALL start with a header line that counts the spans let go before it, so the pair holds the latest spans within the contract's 1,024 records and 4 MiB, and a restarted runtime SHALL continue the same files. A span the file cannot take SHALL be lost and counted like any other span a sink fails to take, and a runtime without the option SHALL write no span file. Stopping the runtime SHALL stop its modules first and then flush its spans within the contract's one-second bound. A failing log or span sink SHALL NOT change a result, and if the host adapter cannot start, the runtime SHALL run without recorded spans and SHALL write one `runtime.tracing.failed` record at ERROR with only the exception's type.

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
- **WHEN** the span file is a link, has a second hard link or can be read by others
- **THEN** the runtime refuses to start with `span-file-not-private`, before any module starts, and writes nothing through the link

#### Scenario: Without the option
- **WHEN** a runtime starts without `--record-spans`
- **THEN** it writes no span file and keeps its spans in memory

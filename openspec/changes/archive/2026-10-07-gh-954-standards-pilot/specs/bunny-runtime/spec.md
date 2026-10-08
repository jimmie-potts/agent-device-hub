## MODIFIED Requirements

### Requirement: Disposable verification runs

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge`, `--environment test`, `--log-level info`, `--record-spans`, the run's state directory and `--config` with the configuration file the seed wrote under `<data>/config`, owner-only: each configured module's section with token files holding only the synthetic token, or for the shipped run each shipped module's simulated section, and the edge's section with a trusted loopback sign-in, MCP on and the launcher off, since the run's state directory is too deep for its socket. It runs with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. The simulated Pixoo SHALL live in the child beside the module that reaches it: the child SHALL report what the Pixoo shows to the supervisor, which SHALL report it with the other devices and start each new child's Pixoo in the mode last set, showing what the last child's Pixoo showed. Each part's credential SHALL be generated per run, with the catalog's grant, into the owner-only credentials file the configuration names, which holds only digests; the parts' tokens, which carry the synthetic prefix `tok_SYNTHETIC835`, SHALL go to an owner-only file of their own for the run adapter, and SHALL never be printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, at most five times within any minute, and its simulated devices SHALL keep their state. Starts and restarts SHALL run one after another, and only the current runtime's own exit SHALL count as a crash. A child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The run's ready line SHALL name the runtime's health page, which the preview card links. The run's readiness and `doctor` SHALL judge the runtime's own health document as the in-memory harness judges a scenario's start: it passes when every module runs, apart from a module the run's seed expects the runtime to refuse, and the lag check has not stopped. Otherwise `start` SHALL keep waiting until its readiness deadline, and `doctor` SHALL report the run's health failed, naming each module that is not as expected with its state and registry code and nothing else from the document. The shipped runtime's negative controls, which give no module sections, SHALL expect every shipped module that takes a section refused. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, set the Pixoo online, offline or silent, refusing with 400 a simulation that names an unknown device, action or field, arm a crash between the lamp's commit and its publish, lose an acknowledgment, end a part's stream at the edge, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers, and it SHALL answer a query for one request or trace (see "Following one request in a disposable run"). Its refusals SHALL be the shared error body from the registry with fixed text that never quotes the request: a body that is not JSON, or not an object where one is expected, SHALL be refused with 400 and `invalid-request`, a body over 4096 characters with 413 and `too-large`, and any other failure SHALL be a 500 with `internal` and fixed text that never quotes the error. A run of the shipped runtime SHALL refuse a simulation with 409 and `invalid-state`, because its modules reach simulated devices inside the runtime, and the devices its state reports are the supervisor's, which that run does not use. The supervisor SHALL wait for a stopped runtime's stderr to drain, for at most a second, before it starts the next, so that a clean stop's last record is in the journal. Ending a stream SHALL take only a part's source, `bunny/parts/<role>`. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and SHALL name a failure in what a capture's proof keeps, its reports and each failed step's detail, by the harness's or the step's own fixed text, a refusal's registry code or the exception's type, never by an exception's message, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. A capture step `follow-one-request` SHALL follow one request in each case of the query's proof, and a negative control `control-follow-fails` SHALL fail by expecting to find a request that was never sent. Its disconnect SHALL end the part's stream at the runtime's edge, so the same remote part reconnects and its subscriptions hear of the gap, as in the in-memory harness. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` and `private-state` SHALL fail the start when a run crosses the boundary, judged from what happened rather than from the runtime's arguments, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only. For `no-outbound-connections`, a guard loaded through `NODE_OPTIONS` into the runtime and into each worker thread and Node process that inherits its environment SHALL refuse every outbound TCP connection and UDP datagram made through Node's network modules before anything leaves, and record each attempt. `private-state` SHALL observe the runtime's home, that nothing exists under its default state directory, that every database the runtime has open is in the run's state directory, and that the credentials and token files are owner-only.

#### Scenario: Start, capture and stop
- **WHEN** a reviewer starts a run with the fixture modules, captures a catalog scenario, reseeds it to `zero-modules` and captures that scenario, then stops it
- **THEN** the preview links the runtime's health page, which answers, each capture passes, `doctor` reports every check passed and both listeners where the receipt says, and `stop` removes the unit, its lease timer and its runtime directory and closes both ports, while proof stays in the proof root and no token appears in a result, card or receipt

#### Scenario: Every catalog scenario in a run
- **WHEN** each catalog scenario's capture step runs on a freshly seeded run without a user manager
- **THEN** every step passes, attaches its scenario result and asserts the boundaries, the `edge-grants` step syncs with the reader's credential and gets `unauthenticated` without one, the negative control fails, and no step's proof or runtime record holds a part's token or the synthetic module token

#### Scenario: A crash in a run
- **WHEN** a crash is armed and a remote part switches the lamp
- **THEN** the remote part's request ends `uncertain-result`, the runtime starts again on the same port, the lamp's outbox republishes its three messages, and the simulated lamp keeps the state it reached

#### Scenario: Boundary crossed
- **WHEN** a run starts the shipped runtime without `--simulate`, a probe module that reaches for the installed Hub's port 8788 with fetch and with `node:http`, or the runtime without `--state-dir`
- **THEN** each run passes readiness, exactly the matching check fails, naming the crossing; the guard refuses both of the probe's attempts before they connect, and the runtime creates its default state directory under the run's private home, where `private-state` finds it

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

#### Scenario: A configured run
- **WHEN** a reviewer starts the configured-module run and captures its scenario, stops it, then does the same with the misconfigured-module run
- **THEN** each capture passes, health shows the sign `running` and then `refused` with `invalid-request`, the runtime started with `--config`, and no capture log, attachment or runtime record holds the synthetic token

#### Scenario: A run follows one request
- **WHEN** a remote part switches the fixture lamp in a run, and the harness is asked for that request's records and spans
- **THEN** the answer holds the bus's admission and reply, the lamp's records and the core's intake, each with the runtime that wrote it, and the request, queue, execute, device and publish spans with their parents, and a clean first runtime shows no gap

#### Scenario: The proof step
- **WHEN** `follow-one-request` runs on a freshly seeded fixtures run, through a lifecycle run's real transient units and on a run started without a user manager
- **THEN** it passes, attaches one answer for the success, the refusal, the uncertain effect, the replayed outcome, the killed runtime, the absent request, the capped query and the trace, and its negative control `control-follow-fails` fails

#### Scenario: A Pixoo run
- **WHEN** a reviewer starts each Pixoo scenario's run and captures its scenario
- **THEN** each capture passes, the harness state reports what the simulated Pixoo shows, the new runtime's Pixoo after a restart shows what the last one showed, and setting the Pixoo offline before a restart starts it offline; a simulation of an unknown Pixoo action is refused with 400 and changes nothing

#### Scenario: Health in a run
- **WHEN** a run of `module-fails-others-continue` starts and its scenario makes the chime fail, and a run of `misconfigured-module` starts
- **THEN** readiness passes at the first start, the first run's health then fails naming the chime `failed` with `internal`, the second run's health passes with its sign refused, and judged against a seed that expects no refusal the same health fails naming the sign `refused` with `invalid-request`

#### Scenario: Harness refusals
- **WHEN** a caller asks the harness for an unknown route, an unknown simulation or a stream that is not a part's, posts a body that is not JSON, posts `null` to drop a stream, or posts a body over 4096 characters
- **THEN** the unknown route is `not-found` with 404, the oversized body is `too-large` with 413, every other answer is `invalid-request` with 400, each is the registry's error body for its code, and none quotes the request

#### Scenario: A step that throws
- **WHEN** a scenario step throws a `SyntaxError` whose message quotes a synthetic token, an SDK refusal, or a failure of the step's own
- **THEN** the step's detail is `threw SyntaxError`, `threw SdkError <code>`, or the step's own text, and neither the attached result nor the failed expectation quotes the token

## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`) and the LIFX module (`lifx-module`, Hub #928) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, with `not-found`, show it `refused` in health, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port; a health request SHALL also carry no `Origin` and no `Sec-Fetch-Site` other than `none`. Any other request SHALL answer 403 with the shared error body and code `forbidden`. Without an edge, every other method, path or query SHALL answer 404 with the shared error body and code `not-found`; with one, the gateway SHALL serve every other route (see "Simulated modules and the SDK edge" and "Runtime gateway callers"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.2`, positive memory figures and no modules

#### Scenario: Another route
- **WHEN** a client sends GET to `/`, POST to the health path, GET with a query string or GET to another version's path
- **THEN** each answers 404 with `{"error": {"code": "not-found", "retryable": false, "detail": "no such route"}}`

#### Scenario: A request that does not name the listener
- **WHEN** a request names another host, omits the port, carries an `Origin`, or carries `Sec-Fetch-Site` `cross-site` or `same-origin`
- **THEN** it answers 403 with `forbidden`, as does one naming another port, while requests naming `127.0.0.1:<port>` or `localhost:<port>` in any letter case, with or without `Sec-Fetch-Site` `none`, answer 200

#### Scenario: Sync restarts in health
- **WHEN** a module's sync copy overflows a buffer of one while its handler is stalled, and restarts its sync
- **THEN** that module's health entry counts one sync restart, another module counts none, and the module keeps running

#### Scenario: Stopping
- **WHEN** the runtime stops, and stops again
- **THEN** the health server no longer accepts connections, and the second stop resolves

#### Scenario: The shipped process
- **WHEN** the shipped entry point runs with `--port 0` and a private state directory
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running at module API `1.2` and each shipped device module, the playback and LIFX modules, `refused` with `not-found`, because the process has no configuration file, the records name each refusal, and SIGTERM stops it with exit status 0

#### Scenario: A signal while the runtime loads
- **WHEN** SIGTERM or SIGINT arrives while the entry point still loads the runtime, whether loading turns the event loop or blocks it
- **THEN** the process exits 0 with no ready line, and the state directory was never created

#### Scenario: The entry point loads through its launcher
- **WHEN** the built entry point is read
- **THEN** its only static import is the launcher

#### Scenario: A signal during startup
- **WHEN** SIGTERM or SIGINT arrives while a module's start is still running
- **THEN** the process stops that module once its start settles, writes no ready line and exits 0

#### Scenario: Malformed arguments
- **WHEN** the entry point runs without `--port`, with a port that is not an integer from 0 to 65535, a lag limit that is not a positive integer or an unknown option
- **THEN** it exits with status 2 and a usage line

### Requirement: Module manifest and API version

Each module SHALL declare a manifest with a name and the module API version it was written for, and SHALL be written against the module API in `@jimmie-potts/sdk`. The runtime SHALL refuse, and never start, a module whose name is not lowercase letters and digits with single hyphens of at most 64 characters, whose name another module already has, whose `apiVersion` is not `<major>.<minor>`, whose API version has another major version or a newer minor version than the runtime's, `1.2`, or whose pages, content, tools or settings the SDK's `checkContributions` refuses: a module written for `1.0` or `1.1` that declares any of them, a page ID that is not distinct or is `content`, a tool whose input allows other members, settings without `configure`. It SHALL also refuse a module whose tool schemas do not compile as strict JSON Schema 2020-12, or whose tool takes an argument named `deviceId`, `controllerId`, `url`, `ip`, `path`, `credential` or `authorization`, which the MCP gateway keeps. A refused module SHALL get no participant on the bus, and health SHALL list it as `refused` with the reason. The other modules SHALL start.

#### Scenario: An incompatible module is refused
- **WHEN** modules declare API versions `2.0`, `1.3`, `0.9`, `one`, `1.2` and `1.0` to a runtime that supports `1.2`
- **THEN** only the `1.2` and `1.0` modules start, health is `degraded` with status 200, the first three are `refused` with `unsupported-version` and the fourth with `invalid-request`, and a request to a key the refused module would answer is `unavailable`

#### Scenario: Version matching
- **WHEN** a module's API version is compared with a runtime's `1.2`
- **THEN** `1.2` and `1.0` match, `1.3`, `2.0` and `0.2` are `unsupported-version`, and `1`, `1.0.0`, `v1.0`, `01.0`, `1.x` and an empty version are `invalid-request`

#### Scenario: Malformed and duplicate names
- **WHEN** two modules share a name, or a module's name has uppercase letters, an underscore, a leading or trailing hyphen, no characters or more than 64
- **THEN** the first module with a valid name runs, and each other one is `refused` with `invalid-request` and never started

#### Scenario: Contributions the runtime would not serve
- **WHEN** a `1.1` module declares a page, a `1.2` module names a page `content`, another declares settings without `configure`, and a fourth declares a valid page
- **THEN** the first three are `refused` with `invalid-request` and a fixed detail naming the problem, and the fourth runs

### Requirement: Simulated modules and the SDK edge

The shipped module list SHALL be a list of module factories, each of which creates its module with its real device transport or with its simulated one, and, for a module that takes a configuration, gives a section that configures its simulated build with the names of the secrets it needs (Hub #844, #929); with `--simulate`, the runtime SHALL build every module with its simulated transport. With `--edge`, the runtime SHALL serve its gateway (see "Runtime gateway callers") on its health listener, and through it the SDK's remote transport (`RemoteEdge`, #883) under `/api/sdk/v1/`, on the modules' bus. The gateway SHALL serve only once every module's start has settled, and only until the runtime stops: before then, and from the start of a stop until the listener closes, its routes SHALL answer 503 with `unavailable`. Its callers SHALL come from the configuration file's `edge` section and the credentials file it names (see "Edge credentials and their reload"); `--edge` without that section SHALL refuse to start with `edge-config-missing`, before it serves. A credential whose source is the core's (`bunny/core`), a module's (`bunny/modules/<name>`) or the runtime's own (`bunny/runtime/...`) SHALL be refused with `edge-credential-source`, so no remote part can publish as either. No refusal or log record SHALL quote a token. The edge SHALL check remote messages against profile 2.0, the core families, the device families that every device module answers (Hub #918, #928), the modules' own schemas and any families the caller adds, and the runtime SHALL log the edge's connections, disconnections and refusals. As the diagnostic contract requires, a record SHALL NOT hold the raw message or stack: a refusal's record SHALL hold its route, or `other` when the route is none of the edge's, its caller's source if admitted, its code from the 2.0 error registry and, in the diagnostic contract's `bunny.reason`, that code's fixed registered reason (none for `internal` or `uncertain-result`, whose effect may have happened), and never the refusal's detail. The `runtime.started` record SHALL say whether modules are simulated and whether the edge is configured, and a `runtime.edge.serving` record SHALL follow once the gateway serves; both SHALL carry the listener's port, never its URL. Stopping the runtime SHALL close the gateway before it stops the modules.

#### Scenario: A remote part with a grant
- **WHEN** the runtime runs with an edge, the fixture core and a credential for `bunny/parts/reader`
- **THEN** a remote part with that credential's token connects and syncs the core's sessions, one with another token is `unauthenticated`, a call without a token answers 401, the edge's connection is logged with its source, and no token appears in a log record

#### Scenario: Before the modules have started
- **WHEN** a remote part keeps trying to connect with its credential while a module's start is still running
- **THEN** the edge answers 503 with `unavailable` until the start settles, and the same part's next attempt connects; a request with a browser `Origin` and the part's token answers 403

#### Scenario: While the runtime stops
- **WHEN** the runtime is stopping and a module's stop is still running
- **THEN** the edge's stream and calls answer 503 with `unavailable` until the listener closes

#### Scenario: An edge refusal in the log
- **WHEN** a remote part calls a route the edge does not have, sends a malformed call, or calls without a token
- **THEN** each refusal is logged with its route or `other`, its registry code and that code's registered reason, and nothing the caller sent appears in a log record

#### Scenario: A grants file the runtime refuses
- **WHEN** the runtime runs with `--edge` and no configuration file, a configuration without an edge section, or a credentials file that is missing, has mode 644, is a symbolic link or a second hard link, is not JSON, names another schema, holds a digest that is not one, a malformed source, an unknown scope, a device that is not a routing ID, a token two credentials share or an ID used twice
- **THEN** the runtime refuses to start with `edge-config-missing`, `edge-credentials-missing`, `edge-credentials-not-private` or `edge-credentials-invalid`, and the refusal never quotes a token

#### Scenario: A grant that acts as the core or a module
- **WHEN** a credential names `bunny/core`, `bunny/modules/lamp`, `bunny/modules/core` or `bunny/runtime/gateway`, through `startRuntime` or the shipped entry point with `--edge`
- **THEN** the runtime refuses to start with `edge-credential-source`, which the entry point names in `runtime.failed` with exit status 1 and no ready line

#### Scenario: Device commands through the edge
- **WHEN** remote parts send `device-mode-set`, `power-set` and `lifx-color-set` commands through the edge to the LIFX module in the catalog's `lifx-bulbs` scenario
- **THEN** the edge takes each as its device or module family, the module answers each, and every message the parts see follows profile 2.0; a part whose grant does not name the bulbs is refused their commands with `forbidden` and reads none of their `device` records, which the reader reads, and a command on `pendant-1`'s key whose subject names the Beam is `invalid-message`

#### Scenario: Simulated modules
- **WHEN** the shipped entry point runs with `--simulate`, `--edge` and a configuration whose credentials file grants a reader
- **THEN** a remote part with the reader's token reaches its edge, the `runtime.started` record says the modules are simulated and the edge is configured, one `runtime.edge.serving` record follows once every module has started, SIGTERM stops it with exit status 0, no record holds the token, and each module factory builds its simulated module under `--simulate` and its real one otherwise

### Requirement: Disposable verification runs

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge`, `--environment test`, `--log-level info`, `--record-spans`, the run's state directory and `--config` with the configuration file the seed wrote under `<data>/config`, owner-only: each configured module's section with token files holding only the synthetic token, or for the shipped run each shipped module's simulated section, and the edge's section with a trusted loopback sign-in, MCP on and the launcher off, since the run's state directory is too deep for its socket. It runs with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. Each part's credential SHALL be generated per run, with the catalog's grant, into the owner-only credentials file the configuration names, which holds only digests; the parts' tokens, which carry the synthetic prefix `tok_SYNTHETIC835`, SHALL go to an owner-only file of their own for the run adapter, and SHALL never be printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, at most five times within any minute, and its simulated devices SHALL keep their state. Starts and restarts SHALL run one after another, and only the current runtime's own exit SHALL count as a crash. A child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The run's ready line SHALL name the runtime's health page, which the preview card links. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, arm a crash between the lamp's commit and its publish, lose an acknowledgment, end a part's stream at the edge, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers, and it SHALL answer a query for one request or trace (see "Following one request in a disposable run"). The supervisor SHALL wait for a stopped runtime's stderr to drain, for at most a second, before it starts the next, so that a clean stop's last record is in the journal. Ending a stream SHALL take only a part's source, `bunny/parts/<role>`. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. A capture step `follow-one-request` SHALL follow one request in each case of the query's proof, and a negative control `control-follow-fails` SHALL fail by expecting to find a request that was never sent. Its disconnect SHALL end the part's stream at the runtime's edge, so the same remote part reconnects and its subscriptions hear of the gap, as in the in-memory harness. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` and `private-state` SHALL fail the start when a run crosses the boundary, judged from what happened rather than from the runtime's arguments, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only. For `no-outbound-connections`, a guard loaded through `NODE_OPTIONS` into the runtime and into each worker thread and Node process that inherits its environment SHALL refuse every outbound TCP connection and UDP datagram made through Node's network modules before anything leaves, and record each attempt. `private-state` SHALL observe the runtime's home, that nothing exists under its default state directory, that every database the runtime has open is in the run's state directory, and that the credentials and token files are owner-only.

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

#### Scenario: A configured run
- **WHEN** a reviewer starts the configured-module run and captures its scenario, stops it, then does the same with the misconfigured-module run
- **THEN** each capture passes, health shows the sign `running` and then `refused` with `invalid-request`, the runtime started with `--config`, and no capture log, attachment or runtime record holds the synthetic token

#### Scenario: A run follows one request
- **WHEN** a remote part switches the fixture lamp in a run, and the harness is asked for that request's records and spans
- **THEN** the answer holds the bus's admission and reply, the lamp's records and the core's intake, each with the runtime that wrote it, and the request, queue, execute, device and publish spans with their parents, and a clean first runtime shows no gap

#### Scenario: The proof step
- **WHEN** `follow-one-request` runs on a freshly seeded fixtures run, through a lifecycle run's real transient units and on a run started without a user manager
- **THEN** it passes, attaches one answer for the success, the refusal, the uncertain effect, the replayed outcome, the killed runtime, the absent request, the capped query and the trace, and its negative control `control-follow-fails` fails

### Requirement: Diagnostic-contract log records

Every record the runtime writes SHALL be a diagnostic-contract record (`docs/observability-contract.md`) of profile 1.4, built by the contract's `createRecord`, written by default as one JSON line on stderr: `schema_version` `1.4`, the timestamp, the severity pair, a registered event with its static body, the resource, the scope with version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The resource SHALL be service `runtime` in namespace `bunny`, `service.version` the runtime package's version, a neutral `service.instance.id` that the process draws once and that every writer in it and the watchdog thread share, and `deployment.environment.name` from the `--environment` argument: `development` by default, or `test` or `production`; any other value SHALL exit with status 2 and a usage line. The runtime's own records SHALL have scope `bunny.runtime`, and a module's SHALL have scope `bunny.module`. The contract SHALL refuse, and the runtime SHALL drop whole and count, a record with an unregistered event, an event outside its scope or a value outside its registered type; attributes the catalog does not register SHALL be left out, and so SHALL a `bunny.request.id` that its registered pattern refuses, so that the record is kept. A module SHALL log only the events the catalog registers for `bunny.module`. A record SHALL carry a listener's port, never its URL. Beside the stdout ready line, which SHALL stay `{"event":"runtime.ready","url":...}`, the process SHALL write a `runtime.ready` record, and `runtime.stopped` SHALL count the records the writer dropped and its sink lost, with the spans that were invalid, dropped or unfinished at shutdown, or that their sink lost. A sink that throws SHALL lose only its record, and a closed stderr SHALL be ignored, so that neither changes what the runtime or its modules do.

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

### Requirement: Module configuration

With `--config <file>` (`RuntimeOptions.configFile`), the runtime SHALL read one private configuration file, as "Private runtime state" requires, before it serves health: `{"schema": "runtime-config/1.0", "modules": {<module name>: <section>}, "edge"?: <edge section>}` (see "Edge credentials and their reload" for the edge section). It SHALL refuse to start, with a `RuntimeError` whose `error.code` the `runtime.failed` record carries, a file that is not private (`config-relative`, `config-mount`, `config-missing`, `config-link`, `config-checkout`, `config-not-file`, `config-not-private`, `config-too-large`) or that is not JSON, names another schema, lacks an object `modules`, has a member other than `schema`, `modules` and `edge`, or has a malformed `edge` section (`config-invalid`), and no refusal SHALL quote the file. A section for a module the runtime does not host SHALL be ignored, and a lookup SHALL find only the file's own members.

Before it starts the modules, the runtime SHALL admit each module whose manifest it accepted, in list order, with `checkConfiguration` against that module's own section only. It SHALL refuse a module, give it no participant and never start it, while the others start, when the module declares `configure` and has no section (`not-found`); when its section is not a JSON object or its `secrets` member is malformed (`invalid-request`); when its `configure` refuses, with the refusal's code and detail, or throws (`internal`); when it names a device that is not a routing ID or that a module before it already named (`invalid-request`); or when a secret file its section names is missing (`not-found`), is not private (`forbidden`), or is over 64 KiB or not UTF-8 text (`invalid-request`). Health SHALL show it `refused` with that code and a fixed detail, and its `runtime.module.refused` record SHALL carry `bunny.code`, `bunny.phase` `manifest` and, for a `configure` that threw, the error's type, never the detail or what it threw. Without a configuration file, a module that declares `configure` SHALL be refused with `not-found`. A refused core SHALL end the runtime as a failed core does (Hub #831).

`secrets.read(name)` SHALL read, anew on each call, only a file that the module's own section names, and SHALL resolve with its UTF-8 text without trailing line breaks. It SHALL reject with an `SdkError` with a registry code and fixed text: `not-found` for a name the section does not name or a missing file, `forbidden` for a file that is not private, `invalid-request` for one that is too large or not UTF-8 text, and `invalid-state` once the module's stop has begun. No secret SHALL reach a message the runtime sends, a log record, health or an error body: the runtime SHALL never log the configuration file or a secret, and the log writer SHALL drop, and count, any record whose attribute holds a secret a module has read, as text or as a number's digits. The service process's own writer SHALL share that registry: its `runtime.failed` record, and the runtime's records of a module's refusal, failure or stop problem, SHALL leave out an error attribute that holds such a secret and still be written. A span a module records SHALL leave out such an attribute too, and keep the span for its children.

#### Scenario: A missing or invalid section
- **WHEN** one module declaring `configure` has no section, another's section is an array, a module without `configure` has a `secrets` member that is not an object, a fourth's `configure` refuses with `invalid-request` and a detail, a fifth's `configure` throws, and a sixth takes its section
- **THEN** the first five are `refused` with `not-found`, `invalid-request`, `invalid-request`, `invalid-request` with that detail, and `internal`, none of them started, health is `degraded`, the sixth runs, and the refusal records carry their codes and the `manifest` phase without the thrown error's message

#### Scenario: No configuration file
- **WHEN** the runtime runs without `--config` with a module that declares `configure` and one that does not
- **THEN** the first is `refused` with `not-found`, the second runs with an undefined configuration, and its `secrets.read` is `not-found`

#### Scenario: Two modules name one device
- **WHEN** a module names devices `sign-1` and `sign-2`, the next names `sign-2`, and a third names `sign-3`
- **THEN** the second is `refused` with `invalid-request` and the other two run

#### Scenario: A secret file that changes after admission
- **WHEN** an admitted module reads its token, then the file becomes readable by group, is removed, and is replaced by bytes that are not UTF-8
- **THEN** the reads resolve with the token, then reject with `forbidden`, `not-found` and `invalid-request`; and after the runtime stops, `invalid-state`

#### Scenario: No secret in a record, health or an error body
- **WHEN** a module reads its synthetic token, logs it in a registered attribute, logs another record and throws an error quoting it from its start, another module's token file is readable by group, and a third module's reads of an unnamed secret and of a file made readable by group fail
- **THEN** the writer drops exactly the record holding the token, the module's other record arrives, the first module is `failed` with "start failed", the second is `refused` with `forbidden`, and no log record, health body or error body holds the token

#### Scenario: A failure record whose error code holds a secret
- **WHEN** a module's handler throws an error whose code is the token it read
- **THEN** the module is `failed` and `runtime.module.failed` is written with its code, phase and error type, without the error code

#### Scenario: A refused core
- **WHEN** the configuration file has a malformed section for the core, which declares no `configure` and needs no section
- **THEN** the core is `refused`, and the runtime hears of it as of a failed core, so the service process exits for the service manager to restart it

#### Scenario: A secret in a module's span
- **WHEN** a module records a span with its token in one registered attribute and a device ID in another
- **THEN** the recorded span keeps the device ID, and no span holds the token

#### Scenario: A secret in an error that escapes every module
- **WHEN** in the shipped process a module reads its token and a listener it added to an emitter outside every module's flow throws an error whose code is that token
- **THEN** the process exits 1 with a `runtime.failed` record carrying the error's type without its code, and no record or stdout holds the token

#### Scenario: The shipped process with a configuration file
- **WHEN** the shipped entry point runs with `--config` naming a relative path, a missing file, a file with mode 644, a file that is not JSON, a link, and a valid file
- **THEN** each of the first five exits 1 with no ready line and a `runtime.failed` record carrying `RuntimeError` and `config-relative`, `config-missing`, `config-not-private`, `config-invalid` or `config-link`, and the last serves health `ok` and exits 0 on SIGTERM

### Requirement: Scenario catalog and in-memory harness

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, the families a reader copies, when it configures modules, each one's section, and the modules the runtime should refuse. A harness SHALL refuse to start a scenario in which any other module is unhealthy. Each execution adapter SHALL write a seed's sections, as an installer would, into a private configuration file with a private token file per module holding a synthetic token, and the edge's section with a credentials file that grants each part the catalog's `GRANTS` under a run-generated token's digest, and SHALL start the runtime with it. The harness contract SHALL include a `gateway` call that reaches the runtime's gateway over HTTP, on both transports, as a part with its token, as a browser that a trusted loopback page signed in, as a stranger with a made-up token, or with neither. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL mount the runtime's gateway on 127.0.0.1 for each runtime it starts, and SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through the gateway's SDK edge with a run-generated credential per part, whose grant the edge enforces. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, a configured module starting while its device is offline and reaching it once it is online, a module whose configuration is invalid refused while the others run, the playback module following the speaker the phone plays to and turning a silent one stale, the gateway's reads and refusals, a token outside its grant refused and a command sent again refused as a duplicate, an operator's approval recovery after a restart, a module's page, content, settings and MCP tool, and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, with a duplicate command, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. The deadline answers SHALL follow the SDK on both transports: a command its handler holds at the deadline is `uncertain-result`, and one still queued is `expired`, as `bunny-sdk` "Request and respond with expiry" requires; a requester that closes while its command is queued gets `cancelled` in process and `uncertain-result` remotely, as "One conformance suite for every transport" fixes per transport. A remote requester whose command is in flight when the runtime crashes SHALL get `uncertain-result`, as the remote client settles a call whose connection drops, by the command's deadline plus `REQUESTER_GRACE_MS` at the latest. An in-process requester dies with the runtime; the harness labels its request `lost`, which is not an SDK answer.

#### Scenario: Tier 1 in CI
- **WHEN** `npm run test:runtime:scenarios` runs
- **THEN** every catalog scenario passes in process and through the edge, every part reached the runtime through the edge in the remote run, and no message broke profile 2.0

#### Scenario: A duplicate, a disconnect and a crash on both transports
- **WHEN** the end-to-end scenario sends a command twice with one `requestId`, sends one the lamp cannot carry out, disconnects the reader while the lamp switches, crashes the runtime between the lamp's commit and its publish, and loses the core's acknowledgment of a later outcome
- **THEN** history holds one outcome for the duplicate and the device switched once; the failed command's inbox row reaches the reader and survives the restart; the reader syncs again and hears nothing published while it was away; at the restart the lamp republishes its state, occurrence and outcome once, history takes the outcome once and the lamp receives no command; an outcome whose acknowledgment was lost goes out again at the next clean restart, the core takes it as a duplicate, acknowledges it again and keeps one history entry, and the restart after that republishes nothing

#### Scenario: A failed step
- **WHEN** an expectation never holds, an action throws or a held observation breaks
- **THEN** the scenario fails at that step with what it observed, and runs no later step

#### Scenario: Boundaries
- **WHEN** a harness starts
- **THEN** its edge listens on 127.0.0.1 on a port outside the installed services' ports, its state directory is mode 700 and removed afterwards, a state directory inside a Git checkout is refused with `state-dir-checkout`, and its tokens are unique and appear in no log record, edge record or message

#### Scenario: The agent-session core alone
- **WHEN** the core runs with no device module, a hook observes two sessions, an approval prompt raised and resolved, a turn's end and one session's runtime end, the panel acknowledges the finished turn's notice and the operator tries to acknowledge it as the panel, and the runtime restarts
- **THEN** on both transports the reader holds both sessions, hears `attention.raised`, `attention.cleared` with cause `resolved`, `turn.ended` naming the notice and `session.ended`; the finished turn stays on the session record as an unread notice and never becomes an inbox item; the notice is acknowledged by the panel only and the operator's attempt is `forbidden`; and after the restart the session is uncertain until a new turn's evidence makes it current

#### Scenario: An unexpected refusal
- **WHEN** the in-memory harness starts the misconfigured-module seed without its expected refusal, and then with it
- **THEN** the first start fails because the runtime did not start, and the second starts

#### Scenario: Configured modules on both transports
- **WHEN** the configured-module and misconfigured-module scenarios run in process and through the edge
- **THEN** the sign runs while its sign is offline, reports it `unavailable`, then `available` with the greeting shown and no token refused; with an invalid section the sign is `refused` with `invalid-request`, never reaches its sign, and the core still commits a session the reader holds; and in both, no log record, published message, health entry or reader copy holds the synthetic token

#### Scenario: Playback on both transports
- **WHEN** the speaker-playback scenario runs in process and through the edge: the phone plays to the HT-A9, the operator pauses, the phone switches AirPlay to the Move, the operator pauses again, the Move stops answering and answers again, and the Move never answers a later command, which the operator sends twice
- **THEN** the reader's copy of the playback record follows the presented speaker; each pause reaches the presented speaker only and history holds it succeeded with evidence `transmitted`; the silent Move's record turns `stale` with its song kept, a command meanwhile is refused `unavailable` and reaches no speaker, and the module logs one degradation and one recovery; the unanswered command is `uncertain` in history and the inbox and the Move hears it once; and no message, reader copy or log record names a speaker's address or carries the synthetic token; a playback command whose subject names another speaker than its key is `invalid-message`; and the panel, whose grant does not name the speakers, is refused a playback command with `forbidden` and reads no playback record

#### Scenario: The gateway on both transports
- **WHEN** the gateway-reads, grants-and-duplicates, approval-recovery and module-contributions scenarios run in process and through the edge
- **THEN** a part reads sessions on `/api/v2`, through the snapshot read API and through the `core_sessions` MCP tool; a malformed family is `invalid-request`, an unknown one `not-found`, a made-up or missing token `unauthenticated`, a credential or browser session used from another site and a hook reading `forbidden`, and a route of the old Hub `not-found`, logged with its route; a hook's, a reader's and an out-of-grant command are `forbidden` and switch nothing, a command whose subject names another lamp than its key is `invalid-message`, and a hook's moment occurrence on a lifecycle key is `forbidden` and heard by nobody; a raw command sent again is `duplicate-conflict` and the lamp runs it once; the hook's recovery is `forbidden`, a stale revision `revision-conflict`, and the operator's recovery clears the approval with cause `recovered`; the sign's page, preview, settings and tool are served, the page without a session is `unauthenticated`, and a part whose grant does not name the sign gets none of them, its settings `forbidden`, and none of its records; and no log record, message, health entry or answer holds a part's token

## ADDED Requirements

### Requirement: Runtime gateway callers

With an edge, the runtime's gateway SHALL serve every route of the listener but health, and every refusal SHALL be the shared error body with a code from the 2.0 registry at the HTTP status that fits it, with fixed text that quotes nothing the caller sent, and every JSON answer, health's included, SHALL carry `x-content-type-options: nosniff`. A caller SHALL be either a client credential, which presents its bearer token and SHALL carry no `Origin` and no `Sec-Fetch-Site` other than `none`, or a browser session, which the `bunny-session` cookie carries (`HttpOnly`, `SameSite=Strict`, eight hours, at most 16 sessions) and which acts as `bunny/parts/dashboard` with `read` and `control` and every device an admitted module names. A browser session SHALL be presented only by this origin's own pages or the browser itself: an `Origin` or `Sec-Fetch-Site` of another site SHALL be refused with `forbidden`, and a change (any method but GET or HEAD) SHALL name this origin and carry `bunny-request: 1`. This origin SHALL be `http://` and the host the request names, `127.0.0.1:<port>` or `localhost:<port>`, so a page on the other loopback name is another origin. When a request carries several session cookies, the one that is a live session SHALL be taken. A credential presented from a page SHALL be refused with `forbidden`, a made-up or revoked token and a request with neither with `unauthenticated`.

A browser SHALL sign in only from this origin's own page, naming it and carrying `bunny-request: 1`: with a launch code at `POST /api/v2/browser/launch`, or, when the edge section sets `browserAccess` `trusted-loopback`, at `POST /api/v2/browser/session`, which otherwise answers `not-found`. The runtime SHALL serve the launcher's socket, `bunny-launch.sock` in its state directory, owner-only, unless the edge section sets `launcher` false; each connection SHALL get the runtime's origin and a code good once for 30 seconds, at most eight waiting. A socket path over 107 bytes SHALL refuse the start with `launcher-path-too-long`. `POST /api/v2/browser/logout` SHALL end the cookie's session and its streams and clear the cookie, and a session evicted by the seventeenth or ended at its expiry SHALL have its streams ended at once too. A session token SHALL travel only in `Set-Cookie`.

At the SDK edge, each caller's scopes SHALL become its grant's calls, routing keys and families: `read` SHALL subscribe and sync every state and event key, `ingest` SHALL publish the `lifecycle` family on `bunny.event.lifecycle.*` only, `control` SHALL request `bunny.cmd.approval-recover.*`, `bunny.cmd.notice-acknowledge.*` and `bunny.cmd.*.<device>` for each granted device, and `admin` SHALL add nothing. Every device an admitted module names that the caller's grant does not SHALL be excluded, `bunny.*.*.<device>`, as the old Hub narrowed reads and commands by device: the edge leaves its records out of the caller's syncs and its messages out of the caller's subscriptions, and refuses its commands. So a hook's credential with `ingest` SHALL be refused with `forbidden` for any command, read, subscription or other family's message.

#### Scenario: Registry codes for every refusal
- **WHEN** credentials send a malformed family name, a query a route does not take, a recovery that is not JSON or over the body limit, a made-up token, no token, a hook's read, a reader's recovery and a scope the caller lacks
- **THEN** they answer 400 `invalid-request`, 400, 400, 413 `too-large`, 401 `unauthenticated`, 401, 403 `forbidden`, 403 and 403, each the shared error body with only its code, flag and detail, and a hook's command through the SDK edge is `forbidden`, as is its moment occurrence on a lifecycle key, which nobody hears

#### Scenario: Origin checks
- **WHEN** a credential's request names this or another origin or carries fetch metadata from a page, sign-in comes without the request header or from another site, and a session cookie is used from another site, from the same site or for a change without the header
- **THEN** each is refused with `forbidden`, a proper sign-in sets an `HttpOnly`, `SameSite=Strict` cookie whose token appears in no body, the session reads from this origin and a bookmark, MCP refuses it, and logout ends it

#### Scenario: The launcher
- **WHEN** the launcher asks the runtime's socket for a code, the page exchanges it, and the same code or a made-up one is tried again, with trusted loopback sign-in off
- **THEN** the first exchange signs the browser in and its page loads, the others are `unauthenticated`, trusted loopback sign-in answers `not-found`, and no record holds the code

#### Scenario: A bookmark on localhost
- **WHEN** a page on `http://localhost:<port>` signs in, reads and recovers an approval through requests that name `localhost:<port>`, a page on `127.0.0.1` signs in through one that names `localhost`, and a request carries a stale session cookie before the live one
- **THEN** the sign-in, the read and the change are served, the other loopback name's sign-in is `forbidden`, and the live cookie is taken

#### Scenario: Sessions that end without a logout
- **WHEN** a browser session holds an SDK stream and sixteen more sessions open, and later the newest session, holding a stream, reaches its expiry
- **THEN** the evicted and the expired sessions' streams end at once, logged for `bunny/parts/dashboard`, and each cookie is `unauthenticated`

#### Scenario: Reads no module can answer
- **WHEN** a caller reads a family no module in the runtime serves, by family and by snapshot, and a snapshot of two owners' families
- **THEN** the first two are `not-found`, not retryable, saying no module serves it, and the third `invalid-request`, saying to name families that one module serves

#### Scenario: A reader narrowed to its devices
- **WHEN** a reader granted one of a module's two devices reads the module's family, a snapshot of it at schema version 2.1, a family no device keys, the links and the module list, opens the module's page, content and settings, and syncs and subscribes through the SDK edge while the module changes both devices
- **THEN** it reads the granted device's records alone, never the other device's note, whose subject names that device though its own ID does not, the session family and its device's editor link; the module is listed without pages, tools or settings and each of them is `forbidden` without naming the other device; and its copy and subscription hold the granted device's records and messages alone, while a reader granted both devices reads both

### Requirement: Gateway routes

The gateway SHALL serve, to a caller with `read`: `GET /api/v2/families/<family>`, every record of a core, device or module state family that the caller may see, from a copy it syncs on the first read and keeps following, at most 32, never by polling (a malformed name `invalid-request`, an unknown family `not-found`, a family no module in this runtime serves `not-found` with text that says so, and an owner's refusal its code with fixed text for that code); `GET /api/v2/snapshot?families=<a>,<b>`, one owner's families at its revision from one sync, with no copy kept, each record in the family its schema names at any version, and families of more than one owner `invalid-request` with text that says to name one module's; `GET /api/v2/modules`; `GET /api/v2/modules/<name>/settings`; `GET /api/v2/links`, the editor links of the caller's devices and the place links; and each module's pages and content. The snapshot route SHALL be the gateway's one-off sync, the second implementation of ADR 0012's snapshot read API, for a caller of this one process. A record whose subject, the last token of its key, is a device the caller's grant does not name SHALL be left out of both reads, as the edge leaves it out of a sync. It SHALL answer `GET /api/v2/authority?scope=<scope>` for any caller, 200 when it holds the scope and `forbidden` otherwise. Every document SHALL carry `schema` `<family>/2.0`.

A module's pages, content, settings and tools SHALL be a caller's only when its grant names every device the module names, as the old Hub narrowed a device's dashboard parts and MCP tools: otherwise they SHALL answer `forbidden`, and the module list SHALL show the module without them. A module's contribution SHALL be called only while the module runs (otherwise `unavailable`) and SHALL be answered within 5 s (otherwise `unavailable`). An exception that escapes it SHALL fail the module, as one from a handler does, and be answered `internal`. A page SHALL be served in a document whose policy allows no script, frame, form or base and only images and styles from the runtime itself; content SHALL be an image, plain text or JSON of at most 16 MiB; and a page, settings, content of any type, its bytes searched, or tool answer that holds a secret a module read, a tool's refusal included, SHALL never be served (`internal`).

`/mcp` SHALL serve MCP through `packages/mcp`, unchanged, only when the edge section sets `mcp` true, as the old Hub served it only with its `mcp` set, and SHALL otherwise answer `not-found`. It SHALL serve client credentials only, telling a browser session so with `forbidden` before anything else: each read tool of a module whose every device the credential's grant names, as `<module>_<tool>`, to a credential with `read`, and `core_recover_approval` to one with `control`. A tool's result SHALL be `{result}` and a refusal the shared error body, both under the package's `extension` data. The refusals `packages/mcp` makes itself before a tool runs SHALL keep its released 1.x `gateway-error` result, with the registry's code and no detail: an exception to the shared error body, since the package is reused unchanged. MCP protocol errors SHALL keep the MCP specification.

#### Scenario: MCP by scope
- **WHEN** an operator, a reader granted the sign, a reader granted no device and a hook list MCP tools, the operator calls `sign_status` and `core_recover_approval` for an unknown session, an unknown tool, and with an `Origin`
- **THEN** the operator sees `core_recover_approval`, `core_sessions` and `sign_status`, the sign's reader the two read tools, the other reader `core_sessions` alone, the hook none; `sign_status` answers its result, the recovery the core's `not-found` in the shared error body, the unknown tool an MCP protocol error, and the request with an `Origin` `forbidden`

#### Scenario: MCP off, and a browser session on it
- **WHEN** `/mcp` is called with the edge section's `mcp` unset, and with it set by a browser session without the request header
- **THEN** the first answers `not-found`, and the second `forbidden`, saying the route takes a client credential

#### Scenario: Contributions and their failures
- **WHEN** a module's page throws, a module's settings, text content, JSON content, image content and tools answer with a secret it read, one tool refusing with it in its detail and one answering `{"error": null}`, its content has a type the gateway does not serve, and its family's owner refuses a sync with the secret in its detail
- **THEN** the page answers `internal` and its module fails while the core runs, a later request to it is `unavailable`, the settings, contents and tool answers are `internal`, the odd content is `internal`, the family and snapshot reads answer the owner's code without its detail, and the secret appears in no answer or record

#### Scenario: A page that loads its preview by reference
- **WHEN** a reader granted the sign opens the sign's page and its preview, its settings and the links
- **THEN** the page refers to `content/preview.png` under a policy with `default-src 'none'`, `frame-ancestors 'none'` and `form-action 'none'`, the preview is a PNG, the settings show the greeting and signs without the token, and the links hold the sign's editor link and the place links

#### Scenario: A stalled reader
- **WHEN** a reader subscribes to large state messages and stops reading until its socket fills, and the stall limit passes
- **THEN** the gateway's edge ends the stream and logs `runtime.edge.disconnected` at WARN with `capacity` and its reason

### Requirement: Edge credentials and their reload

The configuration file's `edge` section SHALL be `{"credentials": <absolute path>, "browserAccess"?: "trusted-loopback", "launcher"?: <boolean>, "mcp"?: <boolean>, "editorLinks"?: {...}, "placeLinks"?: {...}}`, with editor links keyed by device routing ID (at most 16) and place links by ID other than `bunny` (at most 8, with a port), each a loopback `http` link without credentials, query or fragment; anything else SHALL refuse the file with `config-invalid`. The credentials file SHALL be `{"schema": "edge-credentials/1.0", "credentials": [{id, source, digest, scopes, devices}]}`, a private file under the configuration file's rules of at most 64 KiB, with at most 32 credentials, distinct IDs, digests and sources, lowercase hexadecimal SHA-256 digests and never a token, sources not reserved (the core's, a module's, the runtime's own or the browser sessions' `bunny/parts/dashboard`), distinct scopes from `read`, `control`, `ingest` and `admin`, and at most 64 distinct device routing IDs; the runtime SHALL refuse to start with `edge-credentials-missing`, `edge-credentials-not-private`, `edge-credentials-invalid` or `edge-credential-source`. A token SHALL be compared with each digest in constant time.

`grantCredential`, `revokeCredential` and `writeEdgeCredentials` SHALL rewrite the file whole and owner-only while holding its lock, `<file>.lock`, which names the writer's process: writers in one process SHALL take turns, so changes made at once all take effect, and a writer in another process SHALL be refused with `edge-credentials-busy`; a writer SHALL create the lock with its content in one step and remove only a lock it created; a lock whose process has gone, or an empty or unreadable one over a minute old, SHALL be taken over in one step that never takes another writer's fresh lock, and a temporary file a crashed writer left SHALL be removed. Each SHALL write a temporary file of its own name beside the file and rename it over the file only if the file still holds what the writer read, and otherwise SHALL refuse with `configuration-changed`, writing nothing. A grant of a credential the file holds as it is SHALL change nothing, and one whose ID the file holds with another digest, source, scopes or devices, or whose source another credential has, SHALL be refused with `edge-credential-conflict`, as the old setup authority refused another owner's; a rotation revokes and then grants. SIGHUP and `Runtime.reload()` SHALL read the file again: a new credential SHALL be taken, a revoked or changed one SHALL have its streams ended and its next call refused with `unauthenticated`, and a file the runtime refuses SHALL keep the credentials it had. A SIGHUP while the runtime starts SHALL be kept and run once the gateway serves. Each reload SHALL log one `runtime.edge.reloaded` record, INFO with `succeeded` and the count, or ERROR with `failed` and the refusal's code.

`convertHubEdge(hubConfig)` SHALL carry the old Hub's credentials, with each ID, digest, scope and device grant, acting as `bunny/parts/<the ID in routing form>`, or `bunny/parts/dashboard-credential` for one called `dashboard`, and its `browserAccess`, `mcp`, `editorLinks` and `placeLinks`, with the launcher on, checked as the runtime's reader checks them. It SHALL refuse, with `convert-invalid` and no digest in its detail, IDs that would share a source, device grants or editor links that are not routing IDs, unknown scopes, another browser access, an `mcp` that is not a boolean, and links or counts the runtime would refuse.

#### Scenario: Grant, revoke and reload
- **WHEN** a producer's credential is granted and a reader's revoked in the file while the reader holds a stream, and the runtime reloads, and later a malformed file is reloaded
- **THEN** before the reload the producer is unauthenticated; after it the producer holds `ingest`, the revoked token is `unauthenticated`, its stream ended and it cannot reconnect; the malformed file's reload fails with `edge-credentials-invalid` while the operator still reads; the reloads are logged as `succeeded` then `failed`; and no token appears in a record, answer, health or span

#### Scenario: The edge section checked whole
- **WHEN** the edge section names a relative credentials path, an unknown member, another browser access, a launcher that is not a boolean, an editor link to another host or with a query, a place link without a port or a place called `bunny`, and a state directory too deep for the launcher's socket
- **THEN** each configuration is refused with `config-invalid`, the deep state directory refuses the start with `launcher-path-too-long`, and with the launcher off the same runtime starts and serves no socket

#### Scenario: The cutover's conversion
- **WHEN** a synthetic Hub configuration with four credentials, one called `dashboard`, trusted loopback sign-in, MCP on and links is converted, written as the installer would and served
- **THEN** each credential keeps its ID, digest, scopes and device grants with its source, `dashboard`'s being `bunny/parts/dashboard-credential`, the edge section keeps the sign-in, MCP and links, a Hub without `mcp` converts with MCP off, each converted token holds exactly its scopes at `/api/v2/authority`, trusted loopback sign-in and MCP work, and the conversion refuses colliding IDs, a device that is not a routing ID, an unknown scope, another browser access, an `mcp` that is not a boolean, an editor link to another host, a place link without a port and nine place links

#### Scenario: One credential per ID and source
- **WHEN** a credentials file gives two credentials one source, or one acts as `bunny/parts/dashboard`, the core, a module or the runtime
- **THEN** the first is `edge-credentials-invalid` and the others `edge-credential-source`

#### Scenario: Writers that never lose a change
- **WHEN** a credential is granted twice, granted again with another token, other scopes or another's source, revoked and granted with a new token; three grants and two revocations run at once; the file changes by hand while a grant and a revocation rewrite it; a live process, then a gone one, holds the lock beside a leftover temporary file; and the lock comes to be another writer's while a grant holds it
- **THEN** the second grant changes nothing, the others are `edge-credential-conflict` until the rotation, which takes; all five changes take effect; both writes are `configuration-changed` and the hand's change stands; the live lock is `edge-credentials-busy`, the gone one's lock and temporary file are taken over and removed, and the other writer's lock stands after the grant

#### Scenario: A SIGHUP while the runtime starts
- **WHEN** a runtime with an edge gets SIGHUP while a module's start is still running
- **THEN** once it is ready it logs one `runtime.edge.reloaded` record with `succeeded`, after `runtime.edge.serving`

### Requirement: Route map of the old Hub

The runtime SHALL keep a route map of every route the old Hub serves in `apps/hub/src/server.ts` and its route modules, each with its 2.0 replacement or recorded drop and the story that delivers it, never a replacement left to no owner. A request to a route the gateway does not serve SHALL answer 404 with `not-found`, whose detail names the replacement when the map knows the route, and SHALL be logged as `runtime.edge.refused` with `bunny.route` `other`, the route's template in `http.route` and its method in `http.request.method`, never the path's values. The old Hub's session label command SHALL map to the core's `session-label-set` command and its dashboard control, owned by #922, its playback routes to the playback module's `GET /api/v2/families/playback`, `sync playback` and `bunny.cmd.playback-control.<id>`, and its lighting routes to the LIFX module's `GET /api/v2/families/device`, `sync device and lifx-light` and `bunny.cmd.<family>.<bulb>`.

#### Scenario: Every route mapped
- **WHEN** a test parses the old Hub's server and automation routes
- **THEN** it finds at least 30 routes, every one is in the map, and requests to a lifecycle, a controller, an automation route and `/` answer `not-found` and are logged with their templates, with no device ID from the path in a record

### Requirement: Operator approval recovery

The core SHALL answer the `approval-recover` command on `bunny.cmd.approval-recover.<session>` through agent-state's `recoverApproval`, carrying the old Hub's `recover-approval`. It SHALL retire the one approval marker without an attention ID that the session holds on `turnId`, only while the session's evidence is uncertain, five minutes without evidence or since a restart; commit before it replies `accepted`; and publish `attention-cleared` with cause `recovered` and the session at its new revision in the command's trace, with no outcome. It SHALL refuse an unknown session with `not-found`, an `expectedRevision` other than the session record's revision with `revision-conflict`, and a session with no such marker or current evidence with `invalid-state`, changing nothing. The gateway SHALL send it as the caller's source from `POST /api/v2/commands/approval-recover` to a caller with `control`, and from the MCP tool `core_recover_approval`; a remote part with `control` MAY request it through the SDK edge. The core's manifest SHALL contribute the MCP read tool `core_sessions`.

#### Scenario: Recovery only while evidence is uncertain
- **WHEN** an approval without an ID is raised on a turn, an operator recovers it while evidence is current, for an unknown session, then after five minutes with a stale revision, for another turn, with the current revision, and again
- **THEN** the answers are `invalid-state`, `not-found`, `revision-conflict`, `invalid-state`, `accepted` and `invalid-state`; the accepted recovery clears the marker with an `attention-cleared` occurrence of cause `recovered` in the command's trace, and the core publishes no outcome

#### Scenario: The sessions tool
- **WHEN** `core_sessions` is read before the core starts, and then with no filter, `q`, `provider` and a session ID
- **THEN** it answers `unavailable` first, then the sessions at the core's revision, filtered by label, title, project or session ID ignoring case, and by provider

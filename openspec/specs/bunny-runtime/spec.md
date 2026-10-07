# bunny-runtime Specification

## Purpose
Define the B.U.N.N.Y. runtime process under ADR 0012: health with zero modules, the fixed module list with manifests and the API version check, the module context, failure isolation, private state and the event-loop lag check. With `--edge` it serves the SDK's remote transport to remote parts, each with a grant from its state directory, and with `--simulate` it builds its modules with simulated transports. Its tests hold the fixture modules, which pass the module test kit, a stand-in core, and the runtime's scenario catalog with its in-memory harness, and its disposable verification runs run that catalog against the runtime itself. It is source that later stories add modules to; it claims no installation or device behavior.

## Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, which may be empty, and SHALL NOT load modules any other way. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`, except the SDK edge's routes while the edge is configured (see "Simulated modules and the SDK edge"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.0`, positive memory figures and no modules

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
- **THEN** it writes a `runtime.ready` line with its URL, health lists no modules, and SIGTERM stops it with exit status 0

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

Each module SHALL declare a manifest with a name and the module API version it was written for, and SHALL be written against the module API in `@jimmie-potts/sdk`. The runtime SHALL refuse, and never start, a module whose name is not lowercase letters and digits with single hyphens of at most 64 characters, whose name another module already has, whose `apiVersion` is not `<major>.<minor>`, or whose API version has another major version or a newer minor version than the runtime's. A refused module SHALL get no participant on the bus, and health SHALL list it as `refused` with the reason. The other modules SHALL start.

#### Scenario: An incompatible module is refused
- **WHEN** modules declare API versions `2.0`, `1.1`, `0.9`, `one` and `1.0` to a runtime that supports `1.0`
- **THEN** only the `1.0` module starts, health is `degraded` with status 200, the first three are `refused` with `unsupported-version` and the fourth with `invalid-request`, and a request to a key the refused module would answer is `unavailable`

#### Scenario: Version matching
- **WHEN** a module's API version is compared with a runtime's `1.2`
- **THEN** `1.2` and `1.0` match, `1.3`, `2.0` and `0.2` are `unsupported-version`, and `1`, `1.0.0`, `v1.0`, `01.0`, `1.x` and an empty version are `invalid-request`

#### Scenario: Malformed and duplicate names
- **WHEN** two modules share a name, or a module's name has uppercase letters, an underscore, a leading or trailing hyphen, no characters or more than 64
- **THEN** the first module with a valid name runs, and each other one is `refused` with `invalid-request` and never started

### Requirement: Module context

The runtime SHALL call each module's `start` with a context that gives the module:
- its own participant on the one shared bus, with source `bunny/modules/<name>`, including `publishMessage`;
- a logger whose records carry the module's name in their scope and attributes, and the trace ID, span ID and flags of a given trace context;
- tracing that starts a span in a given parent's trace, or a new trace without one;
- the runtime's clock and a scheduler on the runtime's scheduler, which also run the bus's `time`, `expiresat` and request deadlines;
- worker threads that the runtime terminates when the module stops;
- the module's own SQLite file, `modules/<name>.sqlite` in the runtime's private state directory, opened with `node:sqlite` on first use, mode 600, and kept across restarts;
- an abort signal that aborts when the module stops.

A scheduler delay SHALL be an integer from 0 to 2147483647; any other SHALL throw `RangeError`. Once the module's stop begins, its participant, scheduler, workers and database SHALL refuse use with `invalid-state`, while its logger, tracing, clock and signal SHALL keep working, so that its `stop` can still log. Log records SHALL be JSON lines with OpenTelemetry field names, at `info` and above by default.

#### Scenario: Log records name the module and the trace
- **WHEN** a module logs at each level with fields and a span from `trace.span(parent)`
- **THEN** the debug record is dropped at the default level, the others carry their severity, the module's scope and `bunny.module` attribute, which the module's fields cannot replace, and the record with the span carries the parent's trace ID and the span's own span ID

#### Scenario: Deadlines follow the runtime's clock
- **WHEN** the runtime runs on an injected clock and scheduler and a module requests with a 1000 ms timeout from a blocked responder
- **THEN** the command's `time` and `expiresat` come from that clock, the request stays pending while real time passes, and it resolves as `uncertain` when the injected scheduler reaches the deadline; the module's timers fire and cancel on the same scheduler

#### Scenario: The module's own database
- **WHEN** a module writes to its database, the runtime stops, and a runtime on the same state directory starts the module again
- **THEN** the file is `modules/<name>.sqlite` with mode 600 in a mode 700 directory, the second start reads the row, and a module that never asks has no file

#### Scenario: A worker thread
- **WHEN** a module starts a worker thread and messages it
- **THEN** the worker answers

#### Scenario: A prepared message
- **WHEN** a module publishes a message and then publishes the same message again with `publishMessage`
- **THEN** another module receives it twice, the same message with its `id` and `time`

### Requirement: Failure isolation

A module's thrown error, rejected promise or device timeout SHALL stop only that module, and health SHALL show it `failed`. This covers a start that throws, rejects or outlasts the start deadline; a subscription handler or responder that throws; a scheduled callback that throws or rejects; an uncaught error in the module's worker thread; and an error that escapes to the process from the module's own async flow. A failure SHALL be logged with the module, the reason, the error's type and, when it is an identifier, its code; as the diagnostic contract requires, a record SHALL NOT hold the raw message or stack. A dropped delivery SHALL NOT fail its module: a subscription's first drop SHALL be logged at once, then the drops that go on SHALL be logged once a minute with their count, and a minute without drops SHALL end that, so that the next drop is logged at once.

To stop a module, the runtime SHALL abort its signal, cancel its timers and close its participant, which settles the module's own pending requests, closes its sync copies and owners and waits only for its own running handlers; then it SHALL call the module's `stop` once, terminate its workers and close its database. The participant's close and `stop` SHALL each be bounded by the stop deadline, so `stop` runs after a close that timed out while a hung handler may still run. The whole stop SHALL run in the module's own async flow, whichever flow noticed the failure, so that an error its abort listeners or cleanup throw or reject belongs to that module. A module's stop SHALL NOT wait on another module's handler. The other modules SHALL keep working. An error that escapes to the process from code outside every module SHALL be logged as `runtime.failed` and SHALL exit the process with status 1.

#### Scenario: A handler throws
- **WHEN** a module's subscription handler throws
- **THEN** health shows it `failed` with `internal` and "a handler threw", its stop runs once, its subscription receives nothing more, a request to its responder is `unavailable`, and another module still answers requests

#### Scenario: A start fails or times out
- **WHEN** one module's start rejects, another's throws and a third's never finishes, as when its device never answers
- **THEN** the first two are `failed` with "start failed", the third is `failed` with `unavailable` after the start deadline, each is stopped, and another module runs

#### Scenario: A scheduled device call times out
- **WHEN** a module's scheduled callback rejects with a `TimeoutError`
- **THEN** the module is `failed` with "a scheduled callback failed", and the log names the `TimeoutError`

#### Scenario: A worker or an escaped error
- **WHEN** a module's worker thread throws, or an error escapes from a continuation the module started
- **THEN** that module is `failed`, and an error raised outside every module is not attributed to any module

#### Scenario: Errors escape a running process
- **WHEN** in a runtime process one module throws from its own timer and another leaves a rejected promise unhandled
- **THEN** both are `failed` with "an error escaped the module", a third module keeps running, health keeps answering, and SIGTERM still exits 0

#### Scenario: The runtime's own error
- **WHEN** an error escapes to the process from code outside every module
- **THEN** the process writes a fatal `runtime.failed` record with the error's type and code, without its message, and exits with status 1

#### Scenario: No raw error message in the log
- **WHEN** a module's responder throws an error with a code whose message quotes a URL with a token
- **THEN** the failure record carries the error's type and code, and no record holds the token

#### Scenario: Abort listeners that fail
- **WHEN** modules whose abort listeners throw, or leave a rejected promise unhandled, are stopped after a handler error, after a failed start and by the runtime's stop
- **THEN** each error stays with its own module, the module that published the failing handler's message keeps running, no `runtime.failed` record is written and SIGTERM exits 0

#### Scenario: Dropped deliveries
- **WHEN** 1100 messages reach a subscription whose handler is stalled, ten more drop in the second minute, the third minute is quiet, and one more drops after it
- **THEN** one `runtime.delivery.dropped` record is written at once with a count of one, one at the first minute's end with the later drops, the ten wait for one record at the second minute's end, the quiet minute writes nothing, the drop after it is logged at once, every message is either delivered or counted, and the module keeps running

#### Scenario: A sync begun in a failed start
- **WHEN** a module begins a sync of ten families and its start then throws
- **THEN** once the module has stopped, a burst on every family queues nothing for it and no drop is logged

#### Scenario: Stop never waits on another module
- **WHEN** a module fails while its own handler awaits a request to another module whose responder is blocked
- **THEN** that request resolves as `uncertain`, the failed module's stop runs while the other responder is still blocked, and the other module stays running

#### Scenario: A handler that never finishes
- **WHEN** the runtime stops while a module's own handler never finishes
- **THEN** the stop completes within the stop deadline, the module is `stopped`, its `stop` ran once and the timeout is logged

#### Scenario: Nothing left behind
- **WHEN** a module with a pending timer, an open database and a worker thread fails
- **THEN** its signal is aborted, no timer of the module or of the runtime's deadlines remains, the timer never fires, its database is closed, its worker exits, its participant refuses calls, its context refuses timers, workers and the database with `invalid-state`, and its logger, tracing and clock still work

### Requirement: Private runtime state

The runtime SHALL keep its state in one directory, created with mode 700 when missing. It SHALL refuse to start with a relative path, a path under `/mnt`, a path inside a Git checkout, a path with a link anywhere along it, a file, or a directory that others can open, before it serves health or starts a module. It SHALL check the whole path before it creates anything, and SHALL NOT create anything through a link. A refusal SHALL say why, and the service process's `runtime.failed` record SHALL carry its stable `error.code`: `state-dir-relative`, `state-dir-mount`, `state-dir-checkout`, `state-dir-link`, `state-dir-not-directory` or `state-dir-not-private`. Other refusals the runtime makes itself SHALL carry codes too, such as `posix-host-required` and `port-invalid`, and a Node error SHALL keep its own, such as `EADDRINUSE`.

#### Scenario: A missing directory
- **WHEN** the state directory and its parents do not exist
- **THEN** the runtime creates it with mode 700 and starts

#### Scenario: An unsafe directory
- **WHEN** the state directory is below a `.git` directory or a `.git` worktree file, has group permissions, is relative or is reached through a symbolic link
- **THEN** the runtime refuses to start and says why

#### Scenario: Nothing created on a refused path
- **WHEN** the state directory's missing parts lie under a link, under a link into a Git checkout, or inside a Git checkout
- **THEN** the runtime refuses and creates nothing, in the link's target or in the checkout

#### Scenario: A dangling link or a file
- **WHEN** the state directory is a dangling link or lies under one, or is a file or lies under one
- **THEN** the runtime refuses, saying the path goes through a link or is not a directory, and creates nothing

#### Scenario: The journal says why
- **WHEN** the shipped entry point runs with a relative state directory, one under `/mnt`, one inside a Git checkout, one through a link, a dangling link, a file or a directory others can open
- **THEN** each exits 1, and its `runtime.failed` record carries `error.type` `RuntimeError` and that refusal's `error.code`; a health port already in use gives `EADDRINUSE`

#### Scenario: A Windows mount
- **WHEN** the state directory is `/mnt` or under it
- **THEN** the runtime refuses, saying it must not be on a Windows mount, and creates nothing there

### Requirement: Event-loop lag check

The runtime process SHALL detect an event loop that stays stuck for the lag limit, 10 s by default, and SHALL make the service manager restart the whole runtime: a watchdog thread SHALL write a fatal `runtime.stuck` record to stderr and kill the process with SIGKILL, which a systemd unit with `Restart=on-failure` restarts. A busy spell shorter than the limit SHALL NOT stop the process. Time in which the watchdog itself did not run, because its wait overran, SHALL NOT count, so a pause of the whole process SHALL NOT restart it; a main thread still stuck SHALL be caught once the watchdog has been awake for the limit. A watchdog thread that ends without being asked SHALL be logged, and health SHALL then show the lag check `stopped` and the runtime `degraded`.

#### Scenario: A stuck event loop
- **WHEN** a module's code blocks the event loop for good, with a lag limit of 300 ms
- **THEN** health answered before the block, the process is killed with SIGKILL within seconds, and stderr holds a fatal `runtime.stuck` record naming the limit

#### Scenario: A paused process
- **WHEN** the watchdog's wait overruns by 3 s because the whole process was paused, and it checks before the main thread's next beat
- **THEN** the paused time is not counted and the process is not killed; when the process is stopped with SIGSTOP for 3 s and continued, it keeps serving health

#### Scenario: Stuck through a pause
- **WHEN** the main thread stays stuck before and after a 10 s pause
- **THEN** the watchdog counts only the time it was awake, and still reaches the limit

#### Scenario: A watchdog that stops
- **WHEN** the watchdog thread ends without being asked
- **THEN** a `runtime.watchdog.stopped` error record names its exit code, health shows the lag check `stopped` with its limit and the runtime `degraded`; a runtime without a lag check shows it `off`, and one stopped on purpose logs nothing

#### Scenario: A short busy spell
- **WHEN** a module blocks the event loop for 150 ms with a lag limit of 1000 ms
- **THEN** the process keeps serving health and exits 0 on SIGTERM, with no `runtime.stuck` record

### Requirement: Fixture module

The runtime's tests SHALL hold a fixture module, a simulated lamp that later stories use as their stand-in device module, a consume-only fixture chime, and a stand-in core. A module that reaches a device SHALL be created by a factory that takes the device's transport, `create<Name>Module({transport})`, with no manifest slot or registry for transports; the lamp (`createLampModule`) and the chime (`createChimeModule`) SHALL show the convention with simulated transports that keep their state when the runtime restarts.

The lamp SHALL serve its lamps through sync, copy the core's mode and sessions, switch a lamp on command, refuse an unknown lamp with `not-found` and switching on in quiet mode with `invalid-state`, and report each switch through its outbox: the lamp's state, an occurrence and the outcome. It SHALL accept a command whose `requestId` it already handled from the same source without acting or reporting again. When its lamp cannot be reached, its outcome SHALL be `failed`, with evidence `none` and the `unavailable` error. Its indicator SHALL show whether a session waits for a person. The chime SHALL ring once for each approval prompt in the sessions it copies, keeping what it rang in its own SQLite file across restarts. Both SHALL pass the module test kit.

The stand-in core SHALL serve the mode, take every occurrence and outcome once by `(source, id)`, keeping what it took in its own SQLite file across restarts, and acknowledge each outcome with the kit's stand-in acknowledgment, which the lamp SHALL follow before it republishes. It SHALL also stand in for three parts of the core, each until its owner lands: the session owner until Hub #831, committing each hook's `lifecycle` observation to the session record; history until Hub #782, recording each outcome as a `stand-in-history` entry; and the inbox items until Hub #923, recording each failed or uncertain outcome as an `inbox-item` operation. It SHALL commit these in one transaction with what it took, and serve the session, inbox and history families through sync.

#### Scenario: The lamp passes the kit
- **WHEN** the runtime's tests run the module test kit on the lamp and on the chime
- **THEN** every check passes

#### Scenario: Under the runtime
- **WHEN** the runtime hosts the stand-in core, the lamp and a requester, and the requester switches a lamp on
- **THEN** the request is accepted and the core takes the outcome once; in quiet mode the request is refused with `invalid-state`

#### Scenario: A kill between commit and publish
- **WHEN** the runtime process is killed after the lamp commits a switch and before it publishes anything, then started twice on the same state directory without the requester
- **THEN** at the first restart the lamp sends its state, occurrence and outcome, the core takes the outcome exactly once and acknowledges it, and the lamp forgets it; the second restart sends nothing; and the lamp never receives the command again

#### Scenario: A duplicate command
- **WHEN** a requester sends a lamp command again with the `requestId` the lamp already handled
- **THEN** the lamp accepts it, the device switches once and the core's history holds one outcome for it

#### Scenario: A lamp that cannot be reached
- **WHEN** the lamp's device fails a switch
- **THEN** the command is accepted, the outcome is `failed` with evidence `none`, and the core holds it in history and as a failed inbox operation

#### Scenario: A chime restart
- **WHEN** the runtime restarts while an approval prompt the chime rang for still waits
- **THEN** the chime does not ring for it again

### Requirement: Scenario catalog and in-memory harness

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, and the families a reader copies. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through a `RemoteEdge` on 127.0.0.1 with a run-generated token per part. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, with a duplicate command, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. The deadline answers SHALL follow the SDK on both transports: a command its handler holds at the deadline is `uncertain-result`, and one still queued is `expired`, as `bunny-sdk` "Request and respond with expiry" requires; a requester that closes while its command is queued gets `cancelled` in process and `uncertain-result` remotely, as "One conformance suite for every transport" fixes per transport. A remote requester whose command is in flight when the runtime crashes SHALL get `uncertain-result`, as the remote client settles a call whose connection drops, by the command's deadline plus `REQUESTER_GRACE_MS` at the latest. An in-process requester dies with the runtime; the harness labels its request `lost`, which is not an SDK answer.

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

### Requirement: Simulated modules and the SDK edge

The shipped module list SHALL be a list of module factories, each of which creates its module with its real device transport or with its simulated one; with `--simulate`, the runtime SHALL build every module with its simulated transport. With `--edge`, the runtime SHALL serve the SDK's remote transport (`RemoteEdge`, #883) on its health listener under `/api/sdk/v1/`, on the modules' bus, under the same local-request rules as health. The edge SHALL serve only once every module's start has settled, and only until the runtime stops: before then, and from the start of a stop until the listener closes, its routes SHALL answer 503 with `unavailable`. Its grants SHALL come from `edge-grants.json` in the state directory, `{"schema": "edge-grants/1.0", "grants": [{source, token}]}`: a private file (mode 600, one link, owned by the runtime's user) never reached through a link, with at least one grant, well-formed sources, tokens of 32 to 512 characters without spaces, and no token shared. A grant whose source is the core's (`bunny/core`) or a module's (`bunny/modules/<name>`) SHALL be refused, so no remote part can publish as either. The runtime SHALL refuse to start, before it serves, with `edge-grants-missing`, `edge-grants-not-private`, `edge-grants-invalid` or `edge-grant-source` as the `runtime.failed` record's `error.code`. No refusal or log record SHALL quote a token. The edge SHALL check remote messages against profile 2.0, the core families, the modules' own schemas and any families the caller adds, and the runtime SHALL log the edge's connections, disconnections and refusals. As the diagnostic contract requires, a record SHALL NOT hold the raw message or stack: a refusal's record SHALL hold its route, or `other` when the route is none of the edge's, its granted source if any, its code from the 2.0 error registry and that code's fixed meaning, and never the refusal's detail. The `runtime.started` record SHALL say whether modules are simulated and whether the edge is configured, and a `runtime.edge.serving` record SHALL follow once the edge serves. Stopping the runtime SHALL close the edge before it stops the modules.

#### Scenario: A remote part with a grant
- **WHEN** the runtime runs with an edge, the stand-in core and a grant for `bunny/parts/reader`
- **THEN** a remote part with that grant connects and syncs the core's sessions, one with another token is `unauthenticated`, a call without a token answers 401, the edge's connection is logged with its source, and no token appears in a log record

#### Scenario: Before the modules have started
- **WHEN** a remote part keeps trying to connect with its grant while a module's start is still running
- **THEN** the edge answers 503 with `unavailable` until the start settles, and the same part's next attempt connects; a request with a browser `Origin` answers 403

#### Scenario: While the runtime stops
- **WHEN** the runtime is stopping and a module's stop is still running
- **THEN** the edge's stream and calls answer 503 with `unavailable` until the listener closes

#### Scenario: An edge refusal in the log
- **WHEN** a remote part calls a route the edge does not have, sends a malformed call, or calls without a token
- **THEN** each refusal is logged with its route or `other`, its registry code and that code's meaning, and nothing the caller sent appears in a log record

#### Scenario: A grants file the runtime refuses
- **WHEN** the grants file is missing, has mode 644, is a symbolic link or a second hard link, is not JSON, names another schema, lists no grant, has a short token, a malformed source or a token two grants share
- **THEN** the runtime refuses to start with `edge-grants-missing`, `edge-grants-not-private` or `edge-grants-invalid`, and the refusal never quotes a token

#### Scenario: A grant that acts as the core or a module
- **WHEN** a grant names `bunny/core`, `bunny/modules/lamp` or `bunny/modules/core`, through `startRuntime` or the shipped entry point with `--edge`
- **THEN** the runtime refuses to start with `edge-grant-source`, which the entry point names in `runtime.failed` with exit status 1 and no ready line

#### Scenario: Simulated modules
- **WHEN** the shipped entry point runs with `--simulate` and `--edge` and a private grants file
- **THEN** a remote part with a run grant reaches its edge, the `runtime.started` record says the modules are simulated and the edge is configured, one `runtime.edge.serving` record follows once every module has started, SIGTERM stops it with exit status 0, and each module factory builds its simulated module under `--simulate` and its real one otherwise

### Requirement: Disposable verification runs

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge` and the run's state directory: with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. The run's grants SHALL be generated per run, one per part, into the state directory's grants file, and never printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, at most five times within any minute, and its simulated devices SHALL keep their state. Starts and restarts SHALL run one after another, and only the current runtime's own exit SHALL count as a crash. A child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The run's ready line SHALL name the runtime's health page, which the preview card links. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, arm a crash between the lamp's commit and its publish, lose an acknowledgment, end a part's stream at the edge, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers. Ending a stream SHALL take only a part's source, `bunny/parts/<role>`. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. Its disconnect SHALL end the part's stream at the runtime's edge, so the same remote part reconnects and its subscriptions hear of the gap, as in the in-memory harness. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` and `private-state` SHALL fail the start when a run crosses the boundary, judged from what happened rather than from the runtime's arguments, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only. For `no-outbound-connections`, a guard loaded through `NODE_OPTIONS` into the runtime and into each worker thread and Node process that inherits its environment SHALL refuse every outbound TCP connection and UDP datagram made through Node's network modules before anything leaves, and record each attempt. `private-state` SHALL observe the runtime's home, that nothing exists under its default state directory, and that every database the runtime has open is in the run's state directory.

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

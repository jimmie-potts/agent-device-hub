## ADDED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, which may be empty, and SHALL NOT load modules any other way. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>`, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`. Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0, also when the signal arrives while modules start: the runtime SHALL then stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.0`, positive memory figures and no modules

#### Scenario: Another route
- **WHEN** a client sends GET to `/`, POST to the health path, GET with a query string or GET to another version's path
- **THEN** each answers 404 with `{"error": {"code": "not-found", "retryable": false, "detail": "no such route"}}`

#### Scenario: A request that does not name the listener
- **WHEN** a request names another host, omits the port, carries an `Origin`, or carries `Sec-Fetch-Site` `cross-site` or `same-origin`
- **THEN** it answers 403 with `forbidden`, while requests naming `127.0.0.1:<port>` or `localhost:<port>`, with or without `Sec-Fetch-Site` `none`, answer 200

#### Scenario: Sync restarts in health
- **WHEN** a module's sync copy overflows a buffer of one while its handler is stalled, and restarts its sync
- **THEN** that module's health entry counts one sync restart, another module counts none, and the module keeps running

#### Scenario: Stopping
- **WHEN** the runtime stops, and stops again
- **THEN** the health server no longer accepts connections, and the second stop resolves

#### Scenario: The shipped process
- **WHEN** the shipped entry point runs with `--port 0` and a private state directory
- **THEN** it writes a `runtime.ready` line with its URL, health lists no modules, and SIGTERM stops it with exit status 0

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
- its own participant on the one shared bus, with source `bunny/modules/<name>`;
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

### Requirement: Failure isolation

A module's thrown error, rejected promise or device timeout SHALL stop only that module, and health SHALL show it `failed`. This covers a start that throws, rejects or outlasts the start deadline; a subscription handler or responder that throws; a scheduled callback that throws or rejects; an uncaught error in the module's worker thread; and an error that escapes to the process from the module's own async flow. A failure SHALL be logged with the module, the reason, the error's type and, when it is an identifier, its code; as the diagnostic contract requires, a record SHALL NOT hold the raw message or stack. A dropped delivery SHALL NOT fail its module: each subscription's drops SHALL be logged once at once and then at most once per minute, with the count of later drops.

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
- **WHEN** 1100 messages reach a subscription whose handler is stalled
- **THEN** one `runtime.delivery.dropped` record is written at once with a count of one, one more after a minute with the later drops, none in a quiet minute, every message is either delivered or counted, and the module keeps running

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

The runtime SHALL keep its state in one directory, created with mode 700 when missing. It SHALL refuse to start with a relative path, a path under `/mnt`, a path inside a Git checkout, a path with a link anywhere along it, a file, or a directory that others can open, before it serves health or starts a module. It SHALL check the whole path before it creates anything, and SHALL NOT create anything through a link. A refusal SHALL say why.

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

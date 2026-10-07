# bunny-runtime Specification

## Purpose
Define the B.U.N.N.Y. runtime process under ADR 0012: health with zero modules, the fixed module list with manifests and the API version check, each module's own configuration, secrets and private folder from one private configuration file, the module context, failure isolation, private state and the event-loop lag check. Its shipped list starts with the agent-session core, the one owner of agent sessions, with its store and extension point. With `--edge` it serves the SDK's remote transport to remote parts, each with a grant from its state directory, and with `--simulate` it builds its modules with simulated transports. Its tests hold the fixture modules, which pass the module test kit, the fixture core with stand-in parts, and the runtime's scenario catalog with its in-memory harness, and its disposable verification runs run that catalog against the runtime itself. It is source that later stories add modules to; it claims no installation or device behavior.

## Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`, except the SDK edge's routes while the edge is configured (see "Simulated modules and the SDK edge"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

#### Scenario: Zero modules
- **WHEN** the runtime starts with no modules on port 0
- **THEN** health on a loopback port answers 200 with schema `runtime-health/1.0`, status `ok`, module API version `1.1`, positive memory figures and no modules

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
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running and the playback module `refused` with `not-found`, because the process has no configuration file, and SIGTERM stops it with exit status 0

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
- **WHEN** modules declare API versions `2.0`, `1.2`, `0.9`, `one`, `1.1` and `1.0` to a runtime that supports `1.1`
- **THEN** only the `1.1` and `1.0` modules start, health is `degraded` with status 200, the first three are `refused` with `unsupported-version` and the fourth with `invalid-request`, and a request to a key the refused module would answer is `unavailable`

#### Scenario: Version matching
- **WHEN** a module's API version is compared with a runtime's `1.2`
- **THEN** `1.2` and `1.0` match, `1.3`, `2.0` and `0.2` are `unsupported-version`, and `1`, `1.0.0`, `v1.0`, `01.0`, `1.x` and an empty version are `invalid-request`

#### Scenario: Malformed and duplicate names
- **WHEN** two modules share a name, or a module's name has uppercase letters, an underscore, a leading or trailing hyphen, no characters or more than 64
- **THEN** the first module with a valid name runs, and each other one is `refused` with `invalid-request` and never started

### Requirement: Module context

The runtime SHALL call each module's `start` with a context that gives the module:
- its own participant on the one shared bus, with source `bunny/modules/<name>`, or `bunny/core` for the module named `core`, including `publishMessage`;
- a logger whose records have the one module scope, `bunny.module`, carry the module's name in the attribute `bunny.module`, and carry the trace ID, span ID and flags of a given trace context;
- tracing that starts a span in a given parent's trace, or a new trace without one;
- the runtime's clock and a scheduler on the runtime's scheduler, which also run the bus's `time`, `expiresat` and request deadlines;
- worker threads that the runtime terminates when the module stops;
- the module's own SQLite file, `modules/<name>.sqlite` in the runtime's private state directory, opened with `node:sqlite` on first use, mode 600, and kept across restarts;
- the configuration its manifest's `configure` returned from its own section of the configuration file, or undefined for a module without `configure` (see "Module configuration");
- `secrets.read(name)`, which reads only a secret file that the module's own section names, as "Module configuration" requires;
- `files()`, the absolute path of its own private folder, `modules/<name>/` in the state directory beside its SQLite file, created with mode 700 on first use and kept across restarts;
- `workers.call(file, request, {timeoutMs, signal?, transferList?})`, a bounded worker call as `bunny-sdk` "Bounded worker calls" requires, with its deadline on the runtime's scheduler;
- an abort signal that aborts when the module stops.

A scheduler delay SHALL be an integer from 0 to 2147483647; any other SHALL throw `RangeError`. A worker the module starts with its own `env` SHALL keep the process's `NODE_OPTIONS`, before the module's own and only once, so that what the process preloads, such as a verification run's network guard, also loads in it. A failed worker call SHALL reject only that call and SHALL NOT fail the module. Once the module's stop begins, its participant, scheduler, workers, database, folder and secrets SHALL refuse use with `invalid-state`, and its running worker calls SHALL end as `uncertain-result`, while its configuration, logger, tracing, clock and signal SHALL keep working, so that its `stop` can still log. Log records SHALL be diagnostic-contract records, as "Diagnostic-contract log records" requires, at `info` and above by default.

#### Scenario: Log records name the module and the trace
- **WHEN** a module logs at each level with fields and a span from `trace.span(parent)`
- **THEN** the debug record is dropped at the default level, the others carry their severity, the scope `bunny.module` and the `bunny.module` attribute, which the module's fields cannot replace, as `bunny.provenance` cannot be replaced either, and the record with the span carries the parent's trace ID and the span's own span ID

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

#### Scenario: A module's own configuration, secrets and folder
- **WHEN** two modules each have a section naming their own token file, and one of them reads its token and asks for a secret only the other's section names
- **THEN** each gets only its own section as its configuration and its own token without the trailing line break, the other's secret is `not-found`, and each folder is `modules/<name>/` with mode 700

#### Scenario: A worker call
- **WHEN** a module calls a worker that answers, one that never answers with a 2000 ms deadline on an injected scheduler, and one that throws, then the runtime stops during a fourth call
- **THEN** the first resolves with the worker's reply, the second rejects with `uncertain-result` when the injected scheduler reaches the deadline, the third with `uncertain-result`, the module keeps running, the fourth rejects with `uncertain-result` at the stop, and a call after the stop with `invalid-state`

#### Scenario: A worker with its own environment
- **WHEN** the process has `NODE_OPTIONS` and a module starts workers with an `env` without it, with another value, and with the same value
- **THEN** each worker sees the process's value, before the module's own and only once

### Requirement: Failure isolation

Under ADR 0012's policy A, a module SHALL handle its device's errors and timeouts itself, as outcomes and device state, so they do not stop it. An error that escapes a module SHALL stop only that module, and health SHALL show it `failed` until the runtime restarts; the runtime SHALL NOT restart it. This covers a start that throws, rejects or outlasts the start deadline; a subscription handler or responder that throws; a scheduled callback that throws or rejects; an uncaught error in the module's worker thread; and an error that escapes to the process from the module's own async flow. A refusal or failure SHALL be logged with the module, its 2.0 registry code in `bunny.code`, where it arose in `bunny.phase` (`manifest`, `start`, `handler`, `timer`, `worker` or `async`), the error's type and, when it is an identifier, its code. A problem in a module's stop SHALL be logged with the module and `bunny.phase` but no registry code: a participant close or `stop` that outlasts its deadline (`handlers` or `stop`), a `stop` that throws (`stop`, with the error's type and code), and an error after the module stopped (where it arose, with the error's type and code). As the diagnostic contract requires, a record SHALL NOT hold the reason's sentence, the raw message or the stack. A refusal of a malformed name SHALL leave the name out. A dropped delivery SHALL NOT fail its module: a subscription's first drop SHALL be logged at once, then the drops that go on SHALL be logged once a minute with their count, and a minute without drops SHALL end that, so that the next drop is logged at once.

To stop a module, the runtime SHALL abort its signal, cancel its timers and close its participant, which settles the module's own pending requests, closes its sync copies and owners and waits only for its own running handlers; then it SHALL call the module's `stop` once, terminate its workers and close its database. The participant's close and `stop` SHALL each be bounded by the stop deadline, so `stop` runs after a close that timed out while a hung handler may still run. The whole stop SHALL run in the module's own async flow, whichever flow noticed the failure, so that an error its abort listeners or cleanup throw or reject belongs to that module. A module's stop SHALL NOT wait on another module's handler. The other modules SHALL keep working. An error that escapes to the process from code outside every module SHALL be logged as `runtime.failed` and SHALL exit the process with status 1. The core is the one owner of agent sessions, so its failure SHALL end the runtime: the service process SHALL log `runtime.failed` with `error.code` `core-failed` and exit with status 1, so the service manager restarts it whole.

#### Scenario: A handler throws
- **WHEN** a module's subscription handler throws
- **THEN** health shows it `failed` with `internal` and "a handler threw", its record carries `bunny.code` `internal` and `bunny.phase` `handler`, its stop runs once, its subscription receives nothing more, a request to its responder is `unavailable`, and another module still answers requests

#### Scenario: A start fails or times out
- **WHEN** one module's start rejects, another's throws and a third's never finishes, as when it waits on something that never answers
- **THEN** the first two are `failed` with "start failed", the third is `failed` with `unavailable` after the start deadline, each is stopped, and another module runs

#### Scenario: A scheduled device call times out
- **WHEN** a module's scheduled callback rejects with a `TimeoutError` from its device call that the module did not handle
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

#### Scenario: The core fails
- **WHEN** the shipped runtime's core cannot read its store, or another runtime on the same state directory holds the core's lease
- **THEN** the core is `failed` in its start, the process writes `runtime.failed` with `error.type` `RuntimeError` and `error.code` `core-failed` and exits with status 1 without a ready line, and a runtime that already held the lease keeps serving

### Requirement: Private runtime state

The runtime SHALL keep its state in one directory, created with mode 700 when missing. It SHALL refuse to start with a relative path, a path under `/mnt`, a path inside a Git checkout, a path with a link anywhere along it, a file, or a directory that others can open, before it serves health or starts a module. It SHALL check the whole path before it creates anything, and SHALL NOT create anything through a link. A refusal SHALL say why, and the service process's `runtime.failed` record SHALL carry its stable `error.code`: `state-dir-relative`, `state-dir-mount`, `state-dir-checkout`, `state-dir-link`, `state-dir-not-directory` or `state-dir-not-private`. The same rules SHALL apply to the private files the runtime reads, the configuration file and the modules' secret files: an absolute path off `/mnt`, no link anywhere along it, outside every Git checkout, and a regular file with one link and no permission for group or others, owned by the runtime's user, within a size bound, 1 MiB for the configuration file and 64 KiB for a secret file. The runtime SHALL open such a file without following a link at its last part, and SHALL then refuse it unless the file it opened is the one at that path, as `/proc/self/fd` shows, so that a directory along the path swapped for a link after the checks is refused too. It SHALL check the opened file itself, so that a file swapped in between is checked as well. A file the runtime's user may not read, or one under a directory it may not search, SHALL count as not private. A module's private folder, `modules/<name>/`, SHALL be created with mode 700, and the runtime SHALL refuse with `module-folder-not-private`, and never create anything through, a `modules` directory or folder that is a link, belongs to another user or that others can open. Other refusals the runtime makes itself SHALL carry codes too, such as `posix-host-required` and `port-invalid`, and a Node error SHALL keep its own, such as `EADDRINUSE`.

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

#### Scenario: A configuration or secret file the runtime cannot trust
- **WHEN** the configuration file or a module's secret file is a link, lies under a linked directory, is readable by others, has a second link, has no read permission for the runtime's user, is over its size bound, lies inside a Git checkout or under `/mnt`, or is a directory
- **THEN** a configuration file refuses the runtime's start with its code and a secret file refuses its module, each before anything starts and without quoting the file

#### Scenario: A directory swapped for a link during the read
- **WHEN** a directory along a private file's path is renamed and replaced by a link to another private file's directory after the path's checks and before the open
- **THEN** the read is refused as a link and returns nothing of the other file

#### Scenario: A file under a directory the runtime cannot search
- **WHEN** a module's secret file, or the configuration file, lies under a directory with no permissions for the runtime's user
- **THEN** the module is `refused` with `forbidden`, and the runtime refuses to start with `config-not-private`, not a bare `EACCES`

#### Scenario: A module folder that is not private
- **WHEN** a module's folder or the `modules` directory is a link, or the folder has mode 755
- **THEN** `files()` throws `module-folder-not-private`, and nothing is created in the link's target

### Requirement: Event-loop lag check

The runtime process SHALL detect an event loop that stays stuck for the lag limit, 10 s by default, and SHALL make the service manager restart the whole runtime: a watchdog thread SHALL write a fatal `runtime.stuck` record with the runtime's resource to stderr and kill the process with SIGKILL, which a systemd unit with `Restart=on-failure` restarts. The thread SHALL load the diagnostic contract's pure entry point but never the SDK, and SHALL kill the process even when it cannot write the record. A busy spell shorter than the limit SHALL NOT stop the process. Time in which the watchdog itself did not run, because its wait overran, SHALL NOT count, so a pause of the whole process SHALL NOT restart it; a main thread still stuck SHALL be caught once the watchdog has been awake for the limit. A watchdog thread that ends without being asked SHALL be logged, and health SHALL then show the lag check `stopped` and the runtime `degraded`.

#### Scenario: A stuck event loop
- **WHEN** a module's code blocks the event loop for good, with a lag limit of 300 ms
- **THEN** health answered before the block, the process is killed with SIGKILL within seconds, and stderr holds a fatal `runtime.stuck` record naming the limit, which passes the contract's validator and carries the same resource, environment included, as the process's `runtime.started`

#### Scenario: A stuck process whose stderr is closed
- **WHEN** a module blocks the event loop for good, with a lag limit of 300 ms, in a process whose stderr has no reader
- **THEN** the watchdog cannot write its record and still kills the process with SIGKILL

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

The runtime's tests SHALL hold a fixture module, a simulated lamp that later stories use as their stand-in device module, a consume-only fixture chime, a configured fixture sign, and the fixture core: the real core with stand-in parts. A module that reaches a device SHALL be created by a factory that takes the device's transport, `create<Name>Module({transport})`, with no manifest slot or registry for transports; the lamp (`createLampModule`) and the chime (`createChimeModule`) SHALL show the convention with simulated transports that keep their state when the runtime restarts.

The lamp SHALL serve its lamps through sync, copy the core's mode and sessions, switch a lamp on command, refuse an unknown lamp with `not-found` and switching on in quiet mode with `invalid-state`, and report each switch through its outbox: the lamp's state, an occurrence and the outcome. It SHALL accept a command whose `requestId` it already handled from the same source without acting or reporting again. When its lamp cannot be reached, its outcome SHALL be `failed`, with evidence `none` and the `unavailable` error. Its indicator SHALL show whether a session waits for a person. The chime SHALL ring once for each approval prompt in the sessions it copies, keeping what it rang in its own SQLite file across restarts. Both SHALL pass the module test kit.

The sign (`createSignModule({transport})` with `SimulatedSigns`, Hub #919) SHALL stand in for a device module with settings, a secret and private files. Its `configure` SHALL take a greeting, its signs' IDs and addresses, and its token's file as `secrets.token`, and SHALL name the signs as its devices. Its start SHALL read its token, keep its layout in its private folder and serve its signs' availability through sync, and SHALL return without reaching a sign. It SHALL then reach each sign on the runtime's scheduler with a deadline, to show the greeting it rendered with a worker call and the token: a sign that does not answer SHALL be `unavailable` and tried again with capped backoff, never a module failure, and one that shows the greeting SHALL be `available`. A render that fails, past its deadline included, SHALL be reported against the sign, once per run of failures with its registry code, and tried again, leaving the sign's availability as it was, never a module failure. It SHALL log each change of availability once, not each attempt. It SHALL pass the module test kit, policy A's check included.

The fixture core's stand-in parts SHALL join the core through its extension point. They SHALL serve the mode, take every occurrence and outcome other than a hook's lifecycle observation once by `(source, id)`, keeping what they took in the core store across restarts, and acknowledge each outcome with the kit's stand-in acknowledgment, which the lamp SHALL follow before it republishes. They SHALL stand in for two parts of the core, each until its owner lands: history until Hub #782, recording each outcome as a `stand-in-history` entry; and the inbox items until Hub #923, recording each failed or uncertain outcome as an `inbox-item` operation. They SHALL commit these in the core store's transactions with what they took, and the core SHALL serve the inbox and history families through sync with its sessions.

#### Scenario: The lamp passes the kit
- **WHEN** the runtime's tests run the module test kit on the lamp and on the chime
- **THEN** every check passes

#### Scenario: Under the runtime
- **WHEN** the runtime hosts the fixture core, the lamp and a requester, and the requester switches a lamp on
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

#### Scenario: The sign passes the kit
- **WHEN** the runtime's tests run the module test kit on the sign with its section, its synthetic token and an instance whose sign never answers
- **THEN** every check passes, the offline check included

#### Scenario: A render that fails
- **WHEN** every render the sign asks for ends without a reply
- **THEN** the sign module keeps running, logs one `operation.failed` for the sign with `bunny.code` `uncertain-result`, publishes no availability and never reaches the sign

#### Scenario: A sign that is offline at start
- **WHEN** the runtime starts the sign from a private configuration file while its sign never answers, and the sign later comes online
- **THEN** the sign module is `running` and health `ok` once the starts settle, it reports the sign `unavailable` and stays running, then `available`, the sign shows `HELLO` with no refused token, its layout is in `modules/sign/layout.json`, and no record, message or health holds the token

### Requirement: Scenario catalog and in-memory harness

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, the families a reader copies, when it configures modules, each one's section, and the modules the runtime should refuse. A harness SHALL refuse to start a scenario in which any other module is unhealthy. Each execution adapter SHALL write a configured seed's sections, as an installer would, into a private configuration file with a private token file per module holding a synthetic token, and SHALL start the runtime with it. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through a `RemoteEdge` on 127.0.0.1 with a run-generated token per part. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, a configured module starting while its device is offline and reaching it once it is online, a module whose configuration is invalid refused while the others run, the playback module following the speaker the phone plays to and turning a silent one stale, and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, with a duplicate command, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. The deadline answers SHALL follow the SDK on both transports: a command its handler holds at the deadline is `uncertain-result`, and one still queued is `expired`, as `bunny-sdk` "Request and respond with expiry" requires; a requester that closes while its command is queued gets `cancelled` in process and `uncertain-result` remotely, as "One conformance suite for every transport" fixes per transport. A remote requester whose command is in flight when the runtime crashes SHALL get `uncertain-result`, as the remote client settles a call whose connection drops, by the command's deadline plus `REQUESTER_GRACE_MS` at the latest. An in-process requester dies with the runtime; the harness labels its request `lost`, which is not an SDK answer.

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
- **THEN** the reader's copy of the playback record follows the presented speaker; each pause reaches the presented speaker only and history holds it succeeded with evidence `transmitted`; the silent Move's record turns `stale` with its song kept, a command meanwhile is refused `unavailable` and reaches no speaker, and the module logs one degradation and one recovery; the unanswered command is `uncertain` in history and the inbox and the Move hears it once; and no message, reader copy or log record names a speaker's address or carries the synthetic token

### Requirement: Simulated modules and the SDK edge

The shipped module list SHALL be a list of module factories, each of which creates its module with its real device transport or with its simulated one, and, for a module that takes a configuration, gives a section that configures its simulated build (Hub #844); with `--simulate`, the runtime SHALL build every module with its simulated transport. With `--edge`, the runtime SHALL serve the SDK's remote transport (`RemoteEdge`, #883) on its health listener under `/api/sdk/v1/`, on the modules' bus, under the same local-request rules as health. The edge SHALL serve only once every module's start has settled, and only until the runtime stops: before then, and from the start of a stop until the listener closes, its routes SHALL answer 503 with `unavailable`. Its grants SHALL come from `edge-grants.json` in the state directory, `{"schema": "edge-grants/1.0", "grants": [{source, token}]}`: a private file (mode 600, one link, owned by the runtime's user) never reached through a link, with at least one grant, well-formed sources, tokens of 32 to 512 characters without spaces, and no token shared. A grant whose source is the core's (`bunny/core`) or a module's (`bunny/modules/<name>`) SHALL be refused, so no remote part can publish as either. The runtime SHALL refuse to start, before it serves, with `edge-grants-missing`, `edge-grants-not-private`, `edge-grants-invalid` or `edge-grant-source` as the `runtime.failed` record's `error.code`. No refusal or log record SHALL quote a token. The edge SHALL check remote messages against profile 2.0, the core families, the modules' own schemas and any families the caller adds, and the runtime SHALL log the edge's connections, disconnections and refusals. As the diagnostic contract requires, a record SHALL NOT hold the raw message or stack: a refusal's record SHALL hold its route, or `other` when the route is none of the edge's, its granted source if any, its code from the 2.0 error registry and, in the diagnostic contract's `bunny.reason`, that code's fixed registered reason (none for `internal` or `uncertain-result`, whose effect may have happened), and never the refusal's detail. The `runtime.started` record SHALL say whether modules are simulated and whether the edge is configured, and a `runtime.edge.serving` record SHALL follow once the edge serves; both SHALL carry the listener's port, never its URL. Stopping the runtime SHALL close the edge before it stops the modules.

#### Scenario: A remote part with a grant
- **WHEN** the runtime runs with an edge, the fixture core and a grant for `bunny/parts/reader`
- **THEN** a remote part with that grant connects and syncs the core's sessions, one with another token is `unauthenticated`, a call without a token answers 401, the edge's connection is logged with its source, and no token appears in a log record

#### Scenario: Before the modules have started
- **WHEN** a remote part keeps trying to connect with its grant while a module's start is still running
- **THEN** the edge answers 503 with `unavailable` until the start settles, and the same part's next attempt connects; a request with a browser `Origin` answers 403

#### Scenario: While the runtime stops
- **WHEN** the runtime is stopping and a module's stop is still running
- **THEN** the edge's stream and calls answer 503 with `unavailable` until the listener closes

#### Scenario: An edge refusal in the log
- **WHEN** a remote part calls a route the edge does not have, sends a malformed call, or calls without a token
- **THEN** each refusal is logged with its route or `other`, its registry code and that code's registered reason, and nothing the caller sent appears in a log record

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

`npm run -s verify:runtime -- <operation>` SHALL start, inspect, capture, hand off and stop disposable runs of the runtime through `@jimmie-potts/app-verify` without changing it. A run SHALL serve a supervisor that holds the run's simulated devices and runs the runtime from the checkout as a child, through the runtime's own entry with `--simulate`, `--edge`, `--environment test`, `--log-level info`, `--record-spans`, the run's state directory and, for a scenario whose seed configures modules, `--config` with the configuration file the seed wrote under `<data>/config`, owner-only, with token files holding only the synthetic token: with the shipped module list, or with the fixture modules, whose simulated transports reach the supervisor's devices over the child's IPC channel. The run's grants SHALL be generated per run, one per part, into the state directory's grants file, and never printed. A runtime child that dies on its own SHALL be started again on the same port and state directory, at most five times within any minute, and its simulated devices SHALL keep their state. Starts and restarts SHALL run one after another, and only the current runtime's own exit SHALL count as a crash. A child whose supervisor dies SHALL stop itself, and stopping a run SHALL end its runtime, its listeners and every process it started. The run's ready line SHALL name the runtime's health page, which the preview card links. The supervisor SHALL serve a loopback harness API, announced as the run's `harness` endpoint, that answers only local JSON requests naming its listener, drives the simulated devices and the run's controls (hold, release, fail the next switch, fault the chime, arm a crash between the lamp's commit and its publish, lose an acknowledgment, end a part's stream at the edge, restart) and reports the run's state, which it SHALL bring up to date with the runtime before it answers, and it SHALL answer a query for one request or trace (see "Following one request in a disposable run"). The supervisor SHALL wait for a stopped runtime's stderr to drain, for at most a second, before it starts the next, so that a clean stop's last record is in the journal. Ending a stream SHALL take only a part's source, `bunny/parts/<role>`. A run adapter SHALL implement the scenario catalog's harness contract over that API and the SDK edge, and one capture step per catalog scenario SHALL run it, so every catalog scenario that passes in the in-memory harness passes in a run. A capture step `follow-one-request` SHALL follow one request in each case of the query's proof, and a negative control `control-follow-fails` SHALL fail by expecting to find a request that was never sent. Its disconnect SHALL end the part's stream at the runtime's edge, so the same remote part reconnects and its subscriptions hear of the gap, as in the in-memory harness. A run SHALL never reach an installed service, a port of one, personal state or a device: the boundary checks `simulated-transports`, `no-outbound-connections` and `private-state` SHALL fail the start when a run crosses the boundary, judged from what happened rather than from the runtime's arguments, `doctor` SHALL re-run them, and the negative-control seeds that cross a boundary SHALL be start-only. For `no-outbound-connections`, a guard loaded through `NODE_OPTIONS` into the runtime and into each worker thread and Node process that inherits its environment SHALL refuse every outbound TCP connection and UDP datagram made through Node's network modules before anything leaves, and record each attempt. `private-state` SHALL observe the runtime's home, that nothing exists under its default state directory, and that every database the runtime has open is in the run's state directory.

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

### Requirement: Decision records and recorded spans

The runtime SHALL connect the SDK's `onDiagnostic` on its bus and its edge to its log writer: each bus and edge decision SHALL become one record under the `bunny.runtime` scope, `runtime.<event>`, at the level the SDK set, carrying the work's trace and, as registered attributes, the participant (`bunny.participant`), the routing key (`bunny.routing.key`), `sync <families>` (`bunny.pattern`), the request and message IDs, the outcome, the registry code with its fixed reason, the edge's route, the exception's type (`error.type`) and the attempt count. It SHALL record the bus's spans under `bunny.runtime` and each module's spans from `trace.start` under `bunny.module`, naming the module, through the observability package's `createHostDiagnostics` with tracing on, 100% head sampling that honors a parent's sampled flag, no exporter and a bounded local span sink. Each finished span SHALL go to `RuntimeOptions.spans`, which is a sink or, as `--record-spans` selects, the state directory's span file, or, without one, to an in-memory buffer of the latest 1,024 that `runtime.spans()` returns with the count of older spans it evicted, oldest first, so a reader can tell an evicted span from one that never arrived. The span file SHALL be a pair of owner-only files in the state directory, `spans.ndjson` and `spans.previous.ndjson`, opened without following a link and refused unless each is a regular file of the runtime's user with one link: each segment SHALL hold at most 512 spans or 2 MiB, the next SHALL replace the one before it, and each SHALL start with a header line that counts the spans let go before it, so the pair holds the latest spans, up to 1,024 and at least 512 unless spans are large, since each segment also rotates at 2 MiB, within the contract's 1,024 records and 4 MiB, and a restarted runtime SHALL continue the same files. When the current segment is missing or empty beside a previous one, as after a kill between starting a segment and writing its header, the next header SHALL say that the count of spans let go is unknown, never 0. A span the file cannot take, including one that cannot start a segment, SHALL be lost and counted like any other span a sink fails to take, and the next span SHALL try again, so that recording resumes once the cause has gone. A runtime without the option SHALL write no span file. Stopping the runtime SHALL stop its modules first and then flush its spans within the contract's one-second bound. A failing log or span sink SHALL NOT change a result, and if the host adapter cannot start, the runtime SHALL run without recorded spans and SHALL write one `runtime.tracing.failed` record at ERROR with only the exception's type.

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

### Requirement: Records in the scenario catalog

The scenario catalog SHALL assert the runtime's records on both transports: in the end-to-end path, each command's admission and its one ending record at the ADR's level, with its request ID and trace; the refusal of a command with no responder; and, across the crash, the lost acknowledgment and the restarts, exactly one `outcome.published` record for each outcome, so a replayed outcome makes no second record. The in-memory harness SHALL record the bus's and the modules' spans, and its tests SHALL check that no span has a lost parent and that each replayed outcome's publish span links to its stored context without being its child.

#### Scenario: Records on both transports
- **WHEN** the catalog runs in the in-memory harness, in process and through the edge
- **THEN** every scenario passes with its records asserted, and the end-to-end path's spans have no lost parent and link each replay to its original context

### Requirement: Agent-session core

The runtime SHALL host the agent-session core, the module named `core`, as the one owner of agent sessions, with the source `bunny/core`. It SHALL be first in the shipped module list, as a factory whose real and simulated builds are the same, and SHALL register its sync owner, its subscription to `bunny.event.lifecycle.*` and its `notice-acknowledge` responder before its start first awaits, so that a module that syncs from it or republishes to it in its own start finds it listening. It SHALL run `@jimmie-potts/agent-state`'s owner, imported unchanged, on the core store, with the owner ID `bunny-core` and the consumers `dashboard`, `nanoleaf` and `pixoo` by default.

For each hook observation it SHALL check the message against profile 2.0, drop a duplicate by `(source, id)`, refuse the same `(source, id)` with other content as `duplicate-conflict`, and reduce the observation as the lifecycle 1.2 envelope that MAPPING.md maps it to, without changing anything for a refused one. Each committed change SHALL publish, as `bunny/core` and in the observation's trace, the session state of every record whose content changed, a removal with reason `expired` or `retired` for every record removed, and the occurrences MAPPING.md names: `attention-raised` and `attention-cleared` with its cause, `turn-ended` naming the retained notice, and `session-ended` before a runtime end's removals. A finished turn SHALL stay on its session record as a notice and SHALL NOT become an inbox item. A record's revision SHALL be the core's revision of its last change, one counter for every family the core serves, never below agent-state's revision of the change, so a record's generation is never after its revision.

Each record's freshness SHALL hold at the `time` of the message that carries it. The core SHALL publish a record again at a new revision when it turns uncertain five minutes after its last evidence, and SHALL bring freshness up to date before it serves a sync. After a restart every stored session SHALL be restart-uncertain until fresh lifecycle evidence. The core SHALL keep each root session's latest host session ID with its record, so it survives a restart, and SHALL never use it as an identity. It SHALL serve `session` through sync at its revision. The module test kit SHALL pass for it.

#### Scenario: Sessions from hook observations
- **WHEN** the core runs with no device module and a hook publishes two sessions' observations
- **THEN** health is `ok` with the core running, a synced copy holds both sessions from `bunny/core` in the hook's trace, and the core logs each observation `accepted` with its participant and message ID

#### Scenario: An approval prompt and a finished turn
- **WHEN** a hook observes a turn start, an approval prompt, its resolution and the turn's end
- **THEN** the core publishes `attention.raised`, `attention.cleared` with cause `resolved` and `turn.ended`; the record ends idle with no attention and one unread notice; and nothing in the inbox family is published

#### Scenario: Occurrences as MAPPING.md names them
- **WHEN** an approval without a request ID is forgotten at its turn's end, a newer turn retires one raised on an earlier turn, and a runtime end retires a session and its subagent
- **THEN** `attention.cleared` names cause `turn-ended`, then cause `turn-retired` with the observation's turn and the item's own turn, and `session.ended` precedes one `retired` removal per record at one revision, which history keeps

#### Scenario: Expiry
- **WHEN** a session has had no lifecycle evidence for 24 hours
- **THEN** the core publishes its removal with reason `expired`, and history keeps its earlier `turn.ended`

#### Scenario: Freshness at five minutes
- **WHEN** five minutes pass without evidence for a session, on the runtime's clock
- **THEN** the core's timer publishes the record as `uncertain` at a higher revision, a synced copy applies it, and a millisecond earlier nothing was published

#### Scenario: After a restart
- **WHEN** the core restarts on its store
- **THEN** each stored session is published restart-uncertain and `uncertain` at a revision above every earlier one, keeps its host session ID, and turns current again on fresh lifecycle evidence

#### Scenario: Start order
- **WHEN** a module after the core syncs the sessions and republishes an outcome its outbox kept in its own start
- **THEN** its sync completes and the core's part takes the outcome

#### Scenario: The module test kit
- **WHEN** the module test kit runs on the core
- **THEN** every check passes: its manifest, its start and stop, its sync of `session`, and a refused acknowledgment in the shared error body

#### Scenario: A reference history
- **WHEN** the reference history replays through the core store and its owner
- **THEN** every root session fixture in `packages/event-contracts/fixtures/v2/families.json` is a message the owner published, and every fixture that names the finished turn's notice names the one the owner gave it

### Requirement: Core store transactions and failures

The core store SHALL keep agent-state's durable 2.1 state in the old Hub adapter's format, one JSON row in the table `state`, checked on every load and commit under a compare-and-swap on the revision. It SHALL hold a lease, an exclusive transaction on the lock database `core.sqlite-owner` beside it, taken without writing anything, from the core's start until it stops, including while it opens agent-state's owner again after a failed commit; a second owner, in another process or this one, SHALL wait for it until agent-state's deadline and never get it meanwhile. Each lease SHALL reload the store's revision, commit count and records from the file, and a file that holds another owner's state SHALL be refused before anything is written to it. Each change SHALL commit with the 2.0 messages it publishes, the published records, a history row for each occurrence and removal and the `(source, id)` of the intake it took, kept for 24 hours past the later of the commit and the observation's own instant, in one SQLite transaction through the SDK's outbox, and its messages SHALL go out only after the commit, in order. A change that does not commit, a failed rollback included, SHALL change nothing, publish nothing and never be reported committed. On a full disk the core SHALL refuse the change before anything reports it accepted, log the intake `rejected` with `capacity`, and open agent-state's owner again on what committed, so the next observation is taken once there is room. A full disk SHALL never fail the core: an owner that cannot be opened again, a full disk at the start and a refresh the store refuses SHALL leave it running, refusing durable work with `capacity` or `unavailable` and syncs with `unavailable`, and trying again after a backoff that doubles from 1 s to 60 s. While the store refuses durable work, the core SHALL record the transition once, then a summary at most once a minute, then the recovery, with each attempt at DEBUG. A publication refused after a commit SHALL leave the change standing, be recorded once per run of refusals as `outbox.deferred`, and go out at the next commit or start with the message's stored `id`, `time` and trace context. After a crash between a commit and its publication, the next start SHALL send each stored message once.

#### Scenario: One transaction
- **WHEN** an observation commits a session and an attention item
- **THEN** the state row, the records, the core's revision, the occurrence's history row and the intake's `(source, id)` are stored, and the outbox lets the messages go once they are published

#### Scenario: The old Hub's format
- **WHEN** a store is written and opened again
- **THEN** its `state` table has the Hub adapter's columns, its payload passes agent-state's `validateExport`, and the reopened owner holds what was committed

#### Scenario: A full disk
- **WHEN** the store's file can grow no further and an observation would create a session
- **THEN** agent-state reports `storage-failed`, the store names the failure `full`, every row is unchanged, nothing is published, the runtime logs the intake `rejected` with `capacity` at WARN and no second `accepted`, and once there is room the same message is taken

#### Scenario: A publication refused after the commit
- **WHEN** the core's participant refuses every publish while two observations commit
- **THEN** both are reported taken, the refusal is reported once as `committed, awaiting publication`, the records hold the change, and once publishing is allowed the stored messages go out unchanged

#### Scenario: A crash between commit and publish
- **WHEN** the runtime process is killed after the core commits an observation and before it publishes anything, and the runtime starts again twice on the same state directory
- **THEN** the state and occurrence were stored unpublished; at the first restart each goes out once, with its stored `id`; and the second restart sends neither again

#### Scenario: A duplicate after a restart
- **WHEN** a hook's observation is sent again with the same `(source, id)` after the core restarted, or with other content
- **THEN** the first is a duplicate and the second a conflict

#### Scenario: The lease
- **WHEN** a second owner opens the store while the first holds it, and again once the first lets go
- **THEN** the first attempt is refused at agent-state's deadline, and the second reads what the first committed

#### Scenario: The lease through a failed commit
- **WHEN** a second core waits for the lease while the first has a commit refused on a full disk and opens its owner again, with a pause in which the second keeps trying
- **THEN** the second is refused, the refused change leaves the revision as it was and takes nothing, and the first's next change commits at a higher revision

#### Scenario: A lock that cannot keep a journal
- **WHEN** the lock database's rollback journal cannot be written
- **THEN** the lease is still taken

#### Scenario: A full disk that persists
- **WHEN** maintenance falls due while the disk is full, the core restarts with stored sessions on a full disk, or its start-up maintenance falls on one
- **THEN** the core keeps running and health shows it running; intake is refused with `capacity` and syncs with `unavailable`; within the backoff the core does not try again; and once there is room the next attempt succeeds and the condition ends with one record

#### Scenario: Retries back off
- **WHEN** the store refuses the freshness change for two minutes
- **THEN** the core tries at 0, 1, 3, 7, 15, 31, 63 and 123 s, logs the transition and two summaries with the refusals since, and publishes the record at the next attempt once there is room

#### Scenario: The (source, id) window
- **WHEN** a hook whose clock runs two hours ahead sends an observation, and a day and an hour later another intake prunes what is due
- **THEN** the observation's `(source, id)` is still a duplicate, and one from the commit's own instant is pruned exactly 24 hours on

### Requirement: Core extension point

The core SHALL take parts, the extension point for Hub #782's tracker and history and #923's inbox. A part SHALL be able to create its own tables in the core store once the core holds it, serve its families through the core's sync at the core's revision, derive rows from each committed core change in that change's transaction, and run its own intake through the core store's transactions and outbox. A part that throws in a change's transaction SHALL roll the whole change back.

#### Scenario: A part's rows
- **WHEN** a part derives a row from each committed change, and then throws
- **THEN** the first change's row commits with it, and the throw leaves every row unchanged, publishes nothing and is reported as a failed commit

### Requirement: Module configuration

With `--config <file>` (`RuntimeOptions.configFile`), the runtime SHALL read one private configuration file, as "Private runtime state" requires, before it serves health: `{"schema": "runtime-config/1.0", "modules": {<module name>: <section>}}`. It SHALL refuse to start, with a `RuntimeError` whose `error.code` the `runtime.failed` record carries, a file that is not private (`config-relative`, `config-mount`, `config-missing`, `config-link`, `config-checkout`, `config-not-file`, `config-not-private`, `config-too-large`) or that is not JSON, names another schema, lacks an object `modules` or has another member (`config-invalid`), and no refusal SHALL quote the file. A section for a module the runtime does not host SHALL be ignored, and a lookup SHALL find only the file's own members.

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

### Requirement: Following one request in a disposable run

The run's supervisor SHALL answer, on its loopback harness API, a read-only query for one request ID or one trace ID (`GET follow?request=<id>` or `GET follow?trace=<id>`, with `records` and `spans` limits from 1 to 100 that default to 50, each of the four parameters given at most once and any parameter it does not know ignored), under the harness's local-only checks. The journal SHALL be each line of the runtime's stderr that is a JSON object with an event name, and every other line with content SHALL be counted. The answer SHALL be built only from the journal records and spans that pass the diagnostic contract's validator, from their validated, registered values alone, so it holds no payload, no message and no error text; a record or span that the contract refuses, and a journal line that was not a record, SHALL be counted and never shown. A request ID SHALL match only the records and spans that carry it, never another request's on the same trace; a trace ID SHALL match the records on it, its spans and the spans of other traces that link to it. The answer SHALL say what it matched, returned and left out, the traces the matches touch and what else those traces hold, the bus's decisions among the records, with the level and code of each ending and how many admitted commands have no ending of their own, which pairs each ending with the admission of the same message and counts a refusal that was never admitted, such as one for no responder, as ending no admitted command, how many matched spans have each name, and, for each span, whether its parent is a kept span, the remote caller's context, a stored message's context or missing. It SHALL name each way the evidence is incomplete as a gap with a fixed meaning: a runtime that ended without writing `runtime.stopped`, a runtime that has not recorded its stop, which counts what its queues dropped or its sinks lost only when it stops and loses it if it ended abruptly, telemetry that a runtime reported lost at its stop, spans evicted from the span file or an unknown count, a read that stopped at its bound, a run with no readable span file, journal lines, records and spans the contract refused, spans whose parent is missing, and the query's own caps, which count the records, spans, endings and trace IDs it left out. It SHALL name at most 16 trace IDs and list at most as many endings as the records limit allows. A request or trace that nothing carries SHALL answer `none-found` with the caveats of any answer, that records below the minimum level are not written, that telemetry queues drop under pressure and that a runtime that ends abruptly loses what it had not written, and a note that this is not evidence that nothing happened, and no answer SHALL claim that nothing happened. A selector or limit that is not valid, or a parameter given twice, SHALL answer 400 with `invalid-request` and a fixed message that never repeats it. The `follow-one-request` capture step SHALL run, on a freshly seeded run with the fixture modules, a success, a refusal, an uncertain effect and a replayed outcome, then a command whose runtime was killed before it finished, a request nothing carries and a query over its limits, and SHALL attach each answer and judge what it must and must not say.

#### Scenario: The four cases
- **WHEN** the step follows a switch the lamp accepts, one for a lamp the module does not have, one that the held device answers after its deadline, and one whose outcome a lost acknowledgment and a restart send again
- **THEN** the answers show, in order: one trace with no span's parent missing and no gap but the live runtime's standing one; a `not-found` reply at INFO with no device call and no published outcome; an `uncertain` ending at WARN with `uncertain-result` and the late outcome's record; and one `outcome.published` record with two publish spans, the second a root in its own trace that links to the stored context, and the core's duplicate

#### Scenario: A killed runtime
- **WHEN** the runtime is killed between the lamp's commit and its publish, and the next runtime republishes the outcome
- **THEN** the command's answer says no ending is recorded, names the killed runtime as ended without its stop record, reports no request or execute span because they never ended, names the two spans that did end as having missing parents, and shows the outcome's publish span as a linked root in the next runtime

#### Scenario: A request nothing carries
- **WHEN** the query names a request that was never sent
- **THEN** it answers `none-found` with no record, span or trace, names every reason the evidence could be incomplete, such as the killed runtime and the live runtime that has not counted its losses, and its note carries the same caveats as any answer and says that absence is not evidence that nothing happened

#### Scenario: Evidence that is capped or lost
- **WHEN** a query is limited to two records and one span, a request has more than 16 traces or more endings than the records limit, the span file has let spans go or was read to its bound, a runtime reported lost telemetry, or the query is given journal lines that are not records or lines that are not valid spans
- **THEN** the answer counts what it matched and what it left out, trace IDs and endings included, names each of these as a gap, and counts the journal lines, records and spans it could not read without showing them

#### Scenario: Another request on the same trace
- **WHEN** two requests share a trace and the query names one
- **THEN** only its own records and spans are returned, and the answer counts what else the trace holds, which a query by trace returns

#### Scenario: A secret in an exception
- **WHEN** a handler throws an error whose message holds `tok_SYNTHETIC950`, and records or spans that are not contract records hold it too
- **THEN** the answer holds it nowhere, shows the failure as a span's `error` status, and counts the records and spans it refused

#### Scenario: A selector or limit that is not valid
- **WHEN** a query names no selector, two, a malformed one, a limit of 0 or 101, or a parameter twice
- **THEN** it answers 400 with `invalid-request` and never repeats the input, and a parameter it does not know changes nothing

#### Scenario: A clean restart and a kill
- **WHEN** a run restarts its runtime three times, and later a runtime is killed
- **THEN** each runtime that stopped cleanly has its stop record in the journal and no gap, only the killed one is named as ended without its stop record, and the live one is named as not yet having counted its losses

#### Scenario: An ending that follows no admission
- **WHEN** the journal holds a command's refusal for no responder that was never admitted, an admitted command of the same request with no ending, and the runtime was killed
- **THEN** the decision counts one admitted command and one unended, `ended` is false, and the refusal is listed as an ending that ended no admitted command

#### Scenario: A live runtime
- **WHEN** the query names a request, found or not, in a run whose current runtime has not recorded its stop
- **THEN** the answer names that runtime as a gap that counts its losses only when it stops, and once the runtime has stopped the gap gives way to what it counted

#### Scenario: Cleanup
- **WHEN** a run that holds a span file is stopped
- **THEN** its unit, lease timer and runtime directory are removed with the span file, both ports close, and the proof keeps the attached answers

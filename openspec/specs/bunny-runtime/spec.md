# bunny-runtime Specification

## Purpose
Define the B.U.N.N.Y. runtime process under ADR 0012: health with zero modules, the fixed module list with manifests and the API version check, each module's own configuration, secrets and private folder from one private configuration file, the module context, failure isolation, private state and the event-loop lag check. Its shipped list starts with the agent-session core, the one owner of agent sessions, with its store and extension point. With `--edge` it serves its gateway: the SDK's remote transport to remote parts, the `/api/v2` routes, MCP, the modules' pages and browser sign-in, for the client credentials its configuration file's edge section names and for browser sessions, each with the old Hub's scopes; with `--simulate` it builds its modules with simulated transports. Its tests hold the fixture modules, which pass the module test kit, the fixture core with stand-in parts, and the runtime's scenario catalog with its in-memory harness, and its disposable verification runs run that catalog against the runtime itself. It is source that later stories add modules to; it claims no installation or device behavior.

## Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first, then the device modules, the playback module (`runtime-playback`), the LIFX module (`lifx-module`, Hub #928), the Tidbyt module (`runtime-tidbyt`, Hub #930), the Pixoo module (`bunny-pixoo-module`, Hub #843), the Nanoleaf module (`nanoleaf-module`, Hub #844) and the Codex Desktop module (`runtime-codex-desktop`, Hub #926) so far, and the runtime SHALL also run with no module at all. Without a configuration file, the runtime SHALL refuse each shipped module that takes one, as "Module configuration" requires, with `not-found`, show it `refused` in health, and run the others. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts, `serves` with the families it serves through sync while it serves any (Hub #967), and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port; a health request SHALL also carry no `Origin` and no `Sec-Fetch-Site` other than `none`. Any other request SHALL answer 403 with the shared error body and code `forbidden`. Without an edge, every other method, path or query SHALL answer 404 with the shared error body and code `not-found`; with one, the gateway SHALL serve every other route (see "Simulated modules and the SDK edge" and "Runtime gateway callers"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

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
- **THEN** it writes a `runtime.ready` line with its URL, health is `degraded` and lists the core running at module API `1.2` and each shipped device module, the playback, LIFX, Tidbyt, Pixoo, Nanoleaf and Codex Desktop modules, at the module API version each declares, `refused` with `not-found`, because the process has no configuration file, the records name each refusal, and SIGTERM stops it with exit status 0

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

### Requirement: Module context

The runtime SHALL call each module's `start` with a context that gives the module:
- its own participant on the one shared bus, with source `bunny/modules/<name>`, or `bunny/core` for the module named `core`, including `publishMessage`;
- a logger whose records have the one module scope, `bunny.module`, carry the module's name in the attribute `bunny.module`, and carry the trace ID, span ID and flags of a given trace context;
- tracing that starts a span in a given parent's trace, or a new trace without one;
- the runtime's clock and a scheduler on the runtime's scheduler, which also run the bus's `time`, `expiresat` and request deadlines;
- worker threads that the runtime terminates when the module stops;
- the module's own SQLite file, `modules/<name>.sqlite` in the runtime's private state directory, opened with `node:sqlite` on first use as the SDK's `openModuleDatabaseFile` opens it: with exclusive locking, so the module keeps the file to itself while it runs and SQLite makes no `-shm` file, and in WAL mode at `synchronous = FULL` with foreign keys on, so each commit is durable when it returns; mode 600 like its `-wal` file, and kept across restarts;
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
- **THEN** the file is `modules/<name>.sqlite` with mode 600 in a mode 700 directory, with exclusive locking and in WAL mode at `synchronous = FULL` with foreign keys on, its `-wal` file has mode 600 and there is no `-shm` file, another connection cannot read it while the module runs, a second open in the same process is refused and another process is still refused after it, the second start reads the row, and a module that never asks has no file

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

The lamp SHALL serve its lamps through sync, copy the core's mode and sessions, switch a lamp on its command family `lamp-switch`, on `bunny.cmd.lamp-switch.<lamp>`, named as ADR 0012 names commands so the core's action route reaches it, refuse an unknown lamp with `not-found` and switching on in quiet mode with `invalid-state`, and report each switch through its outbox: the lamp's state, an occurrence and the outcome, which its outbox forgets once the core acknowledges it. It SHALL accept a command whose `requestId` it already handled from the same source without acting or reporting again. When its lamp cannot be reached, its outcome SHALL be `failed`, with evidence `none` and the `unavailable` error. Its indicator SHALL show whether a session waits for a person. The chime SHALL ring once for each approval prompt in the sessions it copies, keeping what it rang in its own SQLite file across restarts. Both SHALL pass the module test kit.

The sign (`createSignModule({transport})` with `SimulatedSigns`, Hub #919) SHALL stand in for a device module with settings, a secret and private files. Its `configure` SHALL take a greeting, its signs' IDs and addresses, and its token's file as `secrets.token`, and SHALL name the signs as its devices. Its start SHALL read its token, keep its layout in its private folder and serve its signs' availability through sync, and SHALL return without reaching a sign. It SHALL then reach each sign on the runtime's scheduler with a deadline, to show the greeting it rendered with a worker call and the token: a sign that does not answer SHALL be `unavailable` and tried again with capped backoff, never a module failure, and one that shows the greeting SHALL be `available`. A render that fails, past its deadline included, SHALL be reported against the sign, once per run of failures with its registry code, and tried again, leaving the sign's availability as it was, never a module failure. It SHALL log each change of availability once, not each attempt. It SHALL pass the module test kit, policy A's check included.

The fixture core SHALL be the real core, with its tracker, history and outcome acknowledgment (Hub #782), and stand-in parts that join it through its extension point. They SHALL serve the mode, until Hub #924, and derive their rows from each tracked action's change, in the tracker's own transaction: until Hub #923's history read API, a readable copy of what history recorded of each action, a `stand-in-history` entry for each outcome the tracker took, by its source, and for each result an action reached without one, by the core; and until Hub #923's inbox, one `inbox-item` operation for each failed or uncertain action, which a later result never removes. The core SHALL serve the inbox and history families through sync with its sessions.

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
- **THEN** the lamp accepts it, the device switches once and the core's history holds one outcome for it; through the core's dispatcher, the core answers the same action itself and never sends it again

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

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, the families a reader copies, when it configures modules, each one's section, and the modules the runtime should refuse. A harness SHALL refuse to start a scenario in which any other module is unhealthy. Each execution adapter SHALL write a seed's sections, as an installer would, into a private configuration file with a private token file per module holding a synthetic token, and the edge's section with a credentials file that grants each part the catalog's `GRANTS` under a run-generated token's digest, and SHALL start the runtime with it. The harness contract SHALL include a `gateway` call that reaches the runtime's gateway over HTTP, on both transports, as a part with its token, as a browser that a trusted loopback page signed in, as a stranger with a made-up token, or with neither, and a `dispatch` call that sends a device's command as a part through the core's dispatcher on the gateway's action route (Hub #782), which labels a call whose connection the runtime's crash ended `lost`. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL mount the runtime's gateway on 127.0.0.1 for each runtime it starts, and SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through the gateway's SDK edge with a run-generated credential per part, whose grant the edge enforces. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, a configured module starting while its device is offline and reaching it once it is online, a module whose configuration is invalid refused while the others run, the playback module following the speaker the phone plays to and turning a silent one stale, the Tidbyt module showing agent status and what plays on a simulated cloud with each tile behind its 15-second gate, the gateway's reads and refusals, a token outside its grant refused and a command sent again refused as a duplicate, an operator's approval recovery after a restart, a module's page, content, settings and MCP tool, Pixoo's Monitor following the core's sessions, a media command to the Pixoo accepted then completed once the media reached it, a Now Playing card for the playback module's presented speaker over Monitor and in a whole takeover of Media while the song plays on unchanged, the Pixoo starting while its device is offline and recovering once it answers, the Nanoleaf wall following an agent session and taking Work, Quiet and Free with its power and availability in its device record (Hub #844), the dashboard's page and the sessions a browser signed in by a trusted loopback page reads as the hook observes them, with an approval prompt raised and cleared, and a finished turn the dashboard shows unread, by the shared status helper, until a new turn or an acknowledgment in the record clears it, never on a timer and never as an inbox item, until its session ends (Hub #922), and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a tracked action, its outcome, history and inbox rows, then sync and read, with the same action sent again, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. Every device command in the catalog SHALL go through the core's dispatcher. The deadline answers SHALL follow the SDK on both transports, with the device kind's 5 s reply deadline: a command its handler holds at the deadline is `uncertain-result` and its operation `uncertain` until its late outcome completes it, and one still queued is `expired` and its operation failed, as `bunny-sdk` "Request and respond with expiry" requires. An action whose HTTP call is in flight when the runtime crashes SHALL be labelled `lost` by the harness, which is not an SDK answer: its fate is the tracker's to know. A requester that closes while its command is queued is the SDK's own case, which "One conformance suite for every transport" fixes per transport, since a caller that goes away does not cancel its action.

#### Scenario: Tier 1 in CI
- **WHEN** `npm run test:runtime:scenarios` runs
- **THEN** every catalog scenario passes in process and through the edge, every part reached the runtime through the edge in the remote run, and no message broke profile 2.0

#### Scenario: A duplicate, a disconnect and a crash on both transports
- **WHEN** the end-to-end scenario sends an action twice with one `requestId`, sends one the lamp cannot carry out, holds one past its deadline with another queued behind it, disconnects the reader while the lamp switches, crashes the runtime between the lamp's commit and its publish, and loses the core's acknowledgment of a later outcome
- **THEN** history holds one outcome for the duplicate, the core answered it itself and the device switched once; the held action is `uncertain` and the queued one `expired`, both in the inbox, and the late outcome completes the held one while history keeps both; the failed command's inbox row reaches the reader and survives the restart; the reader syncs again and hears nothing published while it was away; at the restart the lamp republishes its state, occurrence and outcome once, history takes the outcome once and the lamp receives no command; an outcome whose acknowledgment was lost goes out again at the next clean restart, the core takes it as a duplicate, acknowledges it again and keeps one history entry, and the restart after that republishes nothing

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
- **THEN** the reader's copy of the playback record follows the presented speaker; each pause reaches the presented speaker only and history holds it succeeded with evidence `transmitted`; the silent Move's record turns `stale` with its song kept, a command meanwhile is refused `unavailable` and reaches no speaker, and the module logs one degradation and one recovery; the unanswered command is `uncertain` in history and the inbox, sent again under its request ID it is answered by the core, and the Move hears it once; and no message, reader copy or log record names a speaker's address or carries the synthetic token; every command goes through the core's dispatcher, so the operator's direct request at the SDK edge is `forbidden`; and the reader, whose grant may only read, is refused a playback command with `forbidden`

#### Scenario: The Tidbyt's tiles
- **WHEN** the tidbyt-tiles scenario runs in process and through the edge: the runtime starts with no session and nothing playing over AirPlay, the hook observes a session start and a turn, then an approval prompt, its answer and a second prompt inside the gate, and the phone plays a song to the Move; once the song's card has stood past its gate, the runtime restarts cleanly with the Move answering each call 400 ms late, after the HT-A9; then the phone pauses the song and stops it
- **THEN** the idle start writes nothing to the simulated cloud; the status tile shows the frame the reader's sessions call for, and the burst makes one later push of the latest state, at least 15 seconds after the first; the now-playing tile shows the song's card, which the restart neither removes nor pushes again while the playback record waits for the Move's first read, then the pause marker, behind its own gate, and leaves the rotation when the music stops; after the restart the status tile is pushed again with its session dimmed as uncertain; the reader holds the Tidbyt's device record from `bunny/modules/tidbyt` with no control; and neither the API key nor the cloud device appears in a log record, message, health entry or reader copy

#### Scenario: The gateway on both transports
- **WHEN** the gateway-reads, grants-and-duplicates, approval-recovery and module-contributions scenarios run in process and through the edge
- **THEN** a part reads sessions on `/api/v2`, through the snapshot read API and through the `core_sessions` MCP tool; a malformed family is `invalid-request`, an unknown one `not-found`, a made-up or missing token `unauthenticated`, a credential or browser session used from another site and a hook reading `forbidden`, and a route of the old Hub `not-found`, logged with its route; a hook's, a reader's and the operator's direct lamp command are `forbidden` and switch nothing, a recovery whose subject names another session than its key is `invalid-message`, and a hook's moment occurrence on a lifecycle key is `forbidden` and heard by nobody; a raw notice acknowledgment sent again is `duplicate-conflict` and the core runs it once; the hook's recovery is `forbidden`, a stale revision `revision-conflict`, and the operator's recovery clears the approval with cause `recovered`; the sign's page, preview, settings and tool are served, the page without a session is `unauthenticated`, and the hook, which may not read, is refused the settings with `forbidden`; and no log record, message, health entry or answer holds a part's token

#### Scenario: The Pixoo on both transports
- **WHEN** the four Pixoo scenarios run in process and through the edge, with a simulated Pixoo and the playback module's simulated speakers
- **THEN** the Pixoo shows the waiting session's two-frame dashboard and then a calm one; an import, a playlist and a start complete, the start accepted at once and completed `transmitted` once the Pixoo shows the media; the presented speaker's song pops up as a card over Monitor for ten seconds without dimming, and while it plays on unchanged a whole takeover in Media keeps its current card for more than 30 s, until the song stops; and after a restart while the device is offline the module runs with the device `unavailable`, logs one degradation and one recovery, and the device is `available` once it answers

#### Scenario: The Nanoleaf wall on both transports
- **WHEN** the nanoleaf-wall scenario runs the core and the Nanoleaf module with a simulated Lines controller, in process and through the edge, and the reader follows `device`, `nanoleaf-wall` and `nanoleaf-animations` from `bunny/modules/nanoleaf` by name
- **THEN** health lists those three families in the Nanoleaf module's `serves`; the reader's sync of `device` alone from the module holds the wall's record only, and the module runs on; the reader's copy shows the wall available with the power it reported, the working session on a Line and then its finished turn unread; Quiet, Free and Work are accepted with outcomes history records as observed, since a mode is the module's own state, the Lines dim to the Quiet level and play their saved scene in Free; a moment and an animation in Work are refused with `unsupported-capability`; the wall switched off in its app shows observed power off; an unanswering wall shows unavailable while the module runs, then available, with one `device.unavailable` and one `device.available` record; Quiet sent meanwhile succeeds as observed and holds nothing, so once the wall answers it shows Quiet and a second session takes a Line; a brightness write whose answer is lost is uncertain in history and shows the wall held and `degraded` until the next mode command, its device record's `held` naming that write's request ID, which is the core's tracked operation with its uncertain inbox item, with the hold logged once; and no record, message, health entry or reader copy holds the synthetic token

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
- **WHEN** the runtime runs with `--edge` and no configuration file, a configuration without an edge section, or a credentials file that is missing, has mode 644, is a symbolic link or a second hard link, is not JSON, names another schema, holds a digest that is not one, a malformed source, an unknown scope, a credential that names devices, a token two credentials share or an ID used twice
- **THEN** the runtime refuses to start with `edge-config-missing`, `edge-credentials-missing`, `edge-credentials-not-private` or `edge-credentials-invalid`, and the refusal never quotes a token

#### Scenario: A grant that acts as the core or a module
- **WHEN** a credential names `bunny/core`, `bunny/modules/lamp`, `bunny/modules/core` or `bunny/runtime/gateway`, through `startRuntime` or the shipped entry point with `--edge`
- **THEN** the runtime refuses to start with `edge-credential-source`, which the entry point names in `runtime.failed` with exit status 1 and no ready line

#### Scenario: Device commands through the edge
- **WHEN** remote parts send `device-mode-set`, `power-set` and `lifx-color-set` commands to the LIFX module in the catalog's `lifx-bulbs` scenario, through the core's dispatcher on the gateway's action route, and request one directly at the edge
- **THEN** the gateway checks each as its device or module family, the module answers each, and every message the parts see follows profile 2.0; the direct request is `forbidden` for the operator and for a part whose grant may only read; and the reader and the panel both read their `device` records

#### Scenario: Simulated modules
- **WHEN** the shipped entry point runs with `--simulate`, `--edge` and a configuration whose credentials file grants a reader
- **THEN** a remote part with the reader's token reaches its edge, the `runtime.started` record says the modules are simulated and the edge is configured, one `runtime.edge.serving` record follows once every module has started, SIGTERM stops it with exit status 0, no record holds the token, and each module factory builds its simulated module under `--simulate` and its real one otherwise

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

### Requirement: Diagnostic-contract log records

Every record the runtime writes SHALL be a diagnostic-contract record (`docs/observability-contract.md`) of profile 1.5, built by the contract's `createRecord`, written by default as one JSON line on stderr: `schema_version` `1.5`, the timestamp, the severity pair, a registered event with its static body, the resource, the scope with version `1.0.0`, `bunny.provenance` `source` and only registered attributes. The resource SHALL be service `runtime` in namespace `bunny`, `service.version` the runtime package's version, a neutral `service.instance.id` that the process draws once and that every writer in it and the watchdog thread share, and `deployment.environment.name` from the `--environment` argument: `development` by default, or `test` or `production`; any other value SHALL exit with status 2 and a usage line. The runtime's own records SHALL have scope `bunny.runtime`, and a module's SHALL have scope `bunny.module`. The contract SHALL refuse, and the runtime SHALL drop whole and count, a record with an unregistered event, an event outside its scope or a value outside its registered type; attributes the catalog does not register SHALL be left out, and so SHALL a `bunny.request.id` that its registered pattern refuses, so that the record is kept. A module SHALL log only the events the catalog registers for `bunny.module`. A record SHALL carry a listener's port, never its URL. Beside the stdout ready line, which SHALL stay `{"event":"runtime.ready","url":...}`, the process SHALL write a `runtime.ready` record, and `runtime.stopped` SHALL count the records the writer dropped and its sink lost, with the spans that were invalid, dropped or unfinished at shutdown, or that their sink lost. A sink that throws SHALL lose only its record, and a closed stderr SHALL be ignored, so that neither changes what the runtime or its modules do.

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

The core store SHALL keep agent-state's durable 2.1 state in the old Hub adapter's format, one JSON row in the table `state`, checked on every load and commit under a compare-and-swap on the revision. It SHALL hold a lease, an exclusive transaction on the lock database `core.sqlite-owner` beside it, taken without writing anything, from the core's start until it stops, including while it opens agent-state's owner again after a failed commit; a second owner, in another process or this one, SHALL never get it while the first holds it: one in another runtime SHALL be refused when it opens the core's database, which the first keeps to itself, and one that reaches the lease SHALL wait for it until agent-state's deadline. Each lease SHALL reload the store's revision, commit count and records from the file, and a file that holds another owner's state SHALL be refused before anything is written to it. Each change SHALL commit with the 2.0 messages it publishes, the published records, the history rows of everything it publishes, each state as a compact change event and every removal and occurrence whole (see "Core history"), and the `(source, id)` of the intake it took, kept for 24 hours past the later of the commit and the observation's own instant, in one SQLite transaction through the SDK's outbox, and its messages SHALL go out only after the commit, in order. Each change SHALL take that one commit, and what it published one more after the sends, both at the connection's level; after a crash between the sends and that commit, the next start SHALL send the change's messages again with their stored `id`s. A change that does not commit, a failed rollback included, SHALL change nothing, publish nothing and never be reported committed. On a full disk the core SHALL refuse the change before anything reports it accepted, log the intake `rejected` with `capacity`, and open agent-state's owner again on what committed, so the next observation is taken once there is room. A full disk SHALL never fail the core: an owner that cannot be opened again, a full disk at the start, whether a first start, where the store cannot create its tables, or a start after a clean stop, and a refresh the store refuses SHALL leave it running, refusing durable work with `capacity` or `unavailable` and syncs with `unavailable`, and trying again after a backoff that doubles from 1 s to 60 s. While the store refuses durable work, the core SHALL record the transition once, then a summary at most once a minute, then the recovery, with each attempt at DEBUG. A publication refused after a commit SHALL leave the change standing, be recorded once per run of refusals as `outbox.deferred`, and go out at the next commit or start with the message's stored `id`, `time` and trace context. After a crash between a commit and its publication, the next start SHALL send each stored message once.

#### Scenario: One transaction
- **WHEN** an observation commits a session and an attention item
- **THEN** the state row, the records, the core's revision, the history rows of the session's changes and of the occurrence, and the intake's `(source, id)` are stored, and the outbox lets the messages go once they are published

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

#### Scenario: A real full disk at the start
- **WHEN** the runtime's state directory is on a full disk that refuses every write with ENOSPC, and the core starts on it for the first time, or again after a clean stop
- **THEN** the core opens its database and runs, health shows it running, an observation is refused with `capacity` and a sync with `unavailable`, and once there is room the next observation is taken and syncs are served

#### Scenario: Retries back off
- **WHEN** the store refuses the freshness change for two minutes
- **THEN** the core tries at 0, 1, 3, 7, 15, 31, 63 and 123 s, logs the transition and two summaries with the refusals since, and publishes the record at the next attempt once there is room

#### Scenario: The (source, id) window
- **WHEN** a hook whose clock runs two hours ahead sends an observation, and a day and an hour later another intake prunes what is due
- **THEN** the observation's `(source, id)` is still a duplicate, and one from the commit's own instant is pruned exactly 24 hours on

#### Scenario: Commits per observation
- **WHEN** an observation raises an approval on a session the core already holds, on a store opened as the runtime opens it
- **THEN** the change commits once with its records, history and intake, its state and occurrence go out, and one more commit forgets them, both at FULL

#### Scenario: A crash after the sends
- **WHEN** the core's process dies after an observation's state and occurrence went out and before their bookkeeping committed, and the store starts again twice on its file
- **THEN** the first start sends both again exactly as first sent, so a consumer that drops duplicates takes each once, and the second sends neither

### Requirement: Core extension point

The core SHALL take parts, the extension point for #923's inbox and later core stories; its tracker and history (Hub #782) are its own. A part SHALL be able to create its own tables in the core store once the core holds it, serve its families through the core's sync at the core's revision, derive rows from each committed core change and from each tracked action's change (`tracked`, with the operation, its previous state and the outcome that caused it) in that change's transaction, run its own intake through the core store's transactions and outbox, and dispatch actions and read a tracked action through its `CoreHandle`. History SHALL keep what a part publishes, and a part's transaction MAY keep another participant's message and an action's step in history. A part that throws in a change's transaction SHALL roll the whole change back.

#### Scenario: A part's rows
- **WHEN** a part derives a row from each committed change, and then throws
- **THEN** the first change's row commits with it, and the throw leaves every row unchanged, publishes nothing and is reported as a failed commit

#### Scenario: A part's rows for a tracked action
- **WHEN** a part derives rows from the tracker's changes while an action is sent, accepted and completed
- **THEN** it hears each change in order, the last with its outcome, and its rows commit with each step

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

### Requirement: Modules that serve one family side by side

The runtime SHALL start and run several modules that serve the same sync family, such as `device`, which every device module serves for its own devices (Hub #918, #967). A module's source on the bus SHALL be `bunny/modules/<name>`, or `bunny/core` for the core, so the module names that the shipped module list and health give are the owners a consumer names. Each module's health entry SHALL list in `serves` the families it serves through sync now, and SHALL have no `serves` while it serves none, so a consumer syncs a shared family only from the modules that serve it. A module, or a remote part through the runtime's edge, SHALL sync such a family from each owner by name and get only that owner's records; a sync that names no owner while several serve the family SHALL be refused with `invalid-request` and recorded once as `runtime.sync.refused` at INFO.

The fixture lamp and the configured fixture sign SHALL each serve their own devices' `device/2.0` records beside their own family: the lamp's record names its kind with every capability unsupported, and the sign's carries the sign's availability, which the sign publishes as a device record whenever it publishes the sign's changed state. The scenario catalog's seed SHALL let a reader's copy name its owner, and the reader view SHALL read one owner's copy of a family. The catalog's `device-owners` scenario SHALL run in the in-memory harness on both transports and in a disposable run.

#### Scenario: Two modules that serve device run
- **WHEN** the runtime starts two in-test modules that both serve `device` for their own devices, and a third module that syncs `device` from each by name at its start
- **THEN** health shows all three running with status `ok`, and `serves` lists `device` for the two device modules and is absent for the third; the third module's copy from each owner holds only that owner's devices, a remote part through the edge syncs each owner by name with the same result, and its sync that names no owner is refused with `invalid-request` and recorded once at INFO

#### Scenario: The device-owners scenario
- **WHEN** the catalog's `device-owners` scenario starts the core, the lamp and the configured sign, offline at first, and the reader follows `device` from the lamp and from the sign by name
- **THEN** every module runs, and health names the lamp and the sign, and no other module, as serving `device`; the copy from the lamp holds only lamp-1; the copy from the sign holds only sign-1, unavailable after the sign's deadline and available once it is online; each copy synced once; and the reader's own syncs of `device` with no owner and from the core are refused with `invalid-request` at INFO and `unavailable` at WARN, each recorded once

### Requirement: Runtime gateway callers

With an edge, the runtime's gateway SHALL serve every route of the listener but health, and every refusal SHALL be the shared error body with a code from the 2.0 registry at the HTTP status that fits it, with fixed text that quotes nothing the caller sent, and every JSON answer, health's included, SHALL carry `x-content-type-options: nosniff`. A caller SHALL be either a client credential, which presents its bearer token and SHALL carry no `Origin` and no `Sec-Fetch-Site` other than `none`, or a browser session, which the `bunny-session` cookie carries (`HttpOnly`, `SameSite=Strict`, eight hours, at most 16 sessions) and which acts as `bunny/parts/dashboard` with `read` and `control`. No caller SHALL be limited to some devices (owner decision, 2026-10-07). A browser session SHALL be presented only by this origin's own pages or the browser itself: an `Origin` or `Sec-Fetch-Site` of another site SHALL be refused with `forbidden`, and a change (any method but GET or HEAD) SHALL name this origin and carry `bunny-request: 1`. This origin SHALL be `http://` and the host the request names, `127.0.0.1:<port>` or `localhost:<port>`, so a page on the other loopback name is another origin. When a request carries several session cookies, the one that is a live session SHALL be taken. A credential presented from a page SHALL be refused with `forbidden`, a made-up or revoked token and a request with neither with `unauthenticated`.

A browser SHALL sign in only from this origin's own page, naming it and carrying `bunny-request: 1`: with a launch code at `POST /api/v2/browser/launch`, or, when the edge section sets `browserAccess` `trusted-loopback`, at `POST /api/v2/browser/session`, which otherwise answers `not-found`. The runtime SHALL serve the launcher's socket, `bunny-launch.sock` in its state directory, owner-only, unless the edge section sets `launcher` false; each connection SHALL get the runtime's origin and a code good once for 30 seconds, at most eight waiting. A socket path over 107 bytes SHALL refuse the start with `launcher-path-too-long`. `POST /api/v2/browser/logout` SHALL end the cookie's session and its streams and clear the cookie, and a session evicted by the seventeenth or ended at its expiry SHALL have its streams ended at once too. A session token SHALL travel only in `Set-Cookie`.

At the SDK edge, each caller's scopes SHALL become its grant's calls, routing keys and families: `read` SHALL subscribe and sync every state and event key, `ingest` SHALL publish the `lifecycle` family on `bunny.event.lifecycle.*` only, `control` SHALL request the core's operator commands only, `bunny.cmd.approval-recover.*` and `bunny.cmd.notice-acknowledge.*`, which the core's dispatcher names (Hub #782), and send every other command through the action routes (see "Action routes"), and `admin` SHALL add nothing. So a hook's credential with `ingest` SHALL be refused with `forbidden` for any command, read, subscription or other family's message.

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
- **WHEN** a caller reads a family no module in the runtime serves, by family and by snapshot, and a snapshot of two owners' families, and later the family of a module whose page failed it
- **THEN** the first two are `not-found`, not retryable, saying no module serves it, and the third `invalid-request`, saying to name families that one module serves; and once the only module that serves a family fails, its family read and its snapshot are `unavailable`, retryable, saying the module is not running

#### Scenario: No reader limited to some devices
- **WHEN** a reader with `read` alone reads the family of a module that names two devices in its configuration, a snapshot of it at schema version 2.1, the links and the module list, opens the module's page, content and settings, and syncs the family through the SDK edge
- **THEN** it reads both devices' records and editor links, the module is listed with its page, tool and settings and each of them answers, and its copy and the answer's membership hold both devices

### Requirement: Gateway routes

The gateway SHALL serve, to a caller with `read`: `GET /api/v2/families/<family>`, every record of a core, device or module state family, combining, for a family that several modules serve such as `device`, each owner's records in one answer, each from a copy of that owner it syncs on the first read and keeps following, at most 32 copies, never by polling (a malformed name `invalid-request`, an unknown family `not-found`, a family no module in this runtime serves or served `not-found` with text that says so, one whose every owner is a module that has failed or stopped, or cannot be read, `unavailable`, and an only owner's refusal its code with fixed text for that code). An owner that is down or cannot be read SHALL never fail the others (policy A): the answer SHALL carry `unavailable`, the sources of those owners alone, empty when every owner answered, so a reader never takes their records for absent; `GET /api/v2/snapshot?families=<a>,<b>[&owner=<source>]`, one owner's families at its revision from one sync, with no copy kept, each record in the family its schema names at any version: the named owner's, `not-found` when it does not serve every named family and `unavailable` when it is down, or else the one owner of every named family, and families of more than one owner `invalid-request` with text that says to name one module's families or the owner; `GET /api/v2/modules`; `GET /api/v2/modules/<name>/settings`; `GET /api/v2/links`, the editor links and the place links; and each module's pages and content. The snapshot route SHALL be the gateway's one-off sync, the second implementation of ADR 0012's snapshot read API, for a caller of this one process. It SHALL answer `GET /api/v2/authority?scope=<scope>` for any caller, 200 when it holds the scope and `forbidden` otherwise. Every document SHALL carry `schema` `<family>/2.0`. A module SHALL count as a family's owner, serving or down, only once it has served that family; this is a known limit: a module that never served, refused at admission or failed in its start before it first served, is not counted, so a combined read such as `GET /api/v2/families/device` answers the other owners with `unavailable` empty, and a family only that module would serve reads `not-found`. A reader such as the dashboard therefore cross-checks each module's state in `GET /api/v2/modules`.

A module's pages, content, settings and tools SHALL be every reader's, and the module list SHALL show them once the module is admitted. A module's contribution SHALL be called only while the module runs (otherwise `unavailable`) and SHALL be answered within 5 s (otherwise `unavailable`). An exception that escapes it SHALL fail the module, as one from a handler does, and be answered `internal`. A page SHALL be served in a document whose policy allows no script, frame, form or base and only images and styles from the runtime itself; content SHALL be an image, plain text or JSON of at most 16 MiB; and a page, settings, content of any type, its bytes searched, or tool answer that holds a secret a module read, a tool's refusal included, SHALL never be served (`internal`).

The gateway SHALL serve the dashboard's page and its two assets (Hub #922) on the old Hub's paths, `GET /`, `/dashboard.js` and `/dashboard.css`, from the build's `dist/dashboard/`, without a session, since the page holds no secret and signs in through the browser routes. Each SHALL load from this origin's own pages, a bookmark or the launcher, with no other site's `Origin` or fetch metadata, and `/` also from a link on another local app's page with the same host name: a same-site top-level navigation to a document with no `Origin` (Hub #561). Another site's page, a frame or fetch from another local app, and any of them for an asset SHALL be refused with `forbidden`, another method with `not-found` and a query with `invalid-request`, each logged as `runtime.edge.refused` with the path as its `http.route`; a runtime whose dashboard is not built SHALL answer `not-found`. Each answer SHALL refuse framing, send `Cross-Origin-Opener-Policy: same-origin`, and carry a policy that runs only the page's own script and style and connects only to this origin.

`/mcp` SHALL serve MCP through `packages/mcp`, unchanged, only when the edge section sets `mcp` true, as the old Hub served it only with its `mcp` set, and SHALL otherwise answer `not-found`. It SHALL serve client credentials only, telling a browser session so with `forbidden` before anything else: each module's read tools, as `<module>_<tool>`, to a credential with `read`, and `core_recover_approval` and `core_send_command` (see "Action routes") to one with `control`. A tool's result SHALL be `{result}` and a refusal the shared error body, both under the package's `extension` data. The refusals `packages/mcp` makes itself before a tool runs SHALL keep its released 1.x `gateway-error` result, with the registry's code and no detail: an exception to the shared error body, since the package is reused unchanged. MCP protocol errors SHALL keep the MCP specification.

#### Scenario: MCP by scope
- **WHEN** an operator, a reader and a hook list MCP tools, the reader calls `core_recover_approval`, and the operator calls `sign_status` and `core_recover_approval` for an unknown session, an unknown tool, and with an `Origin`
- **THEN** the operator sees `core_recover_approval`, `core_send_command`, `core_sessions` and `sign_status`, the reader the two read tools, the hook none; the reader's recovery never reaches the core; `sign_status` answers its result, the recovery the core's `not-found` in the shared error body, the unknown tool an MCP protocol error, and the request with an `Origin` `forbidden`

#### Scenario: MCP off, and a browser session on it
- **WHEN** `/mcp` is called with the edge section's `mcp` unset, and with it set by a browser session without the request header
- **THEN** the first answers `not-found`, and the second `forbidden`, saying the route takes a client credential

#### Scenario: Contributions and their failures
- **WHEN** a module's page throws, a module's settings, text content, JSON content, image content and tools answer with a secret it read, one tool refusing with it in its detail and one answering `{"error": null}`, its content has a type the gateway does not serve, and its family's owner refuses a sync with the secret in its detail
- **THEN** the page answers `internal` and its module fails while the core runs, a later request to it is `unavailable`, the settings, contents and tool answers are `internal`, the odd content is `internal`, the family and snapshot reads answer the owner's code without its detail, and the secret appears in no answer or record

#### Scenario: Owners that cannot answer
- **WHEN** three device modules serve `device`, one refuses its syncs, then a second fails, and then the third fails too
- **THEN** the family reads the first two's records with `unavailable` naming the refusing module, then the first's with `unavailable` naming the refusing and the failed modules and the failed module's snapshot `unavailable`, and at last the read is `unavailable`, never serving an owner's detail

#### Scenario: A family that two modules serve
- **WHEN** the lamp and the sign both serve `device`, a reader reads the family, and snapshots of it name no owner, the lamp, the sign with `sign` beside it, an owner that serves no device, an owner that does not serve `session`, a malformed owner and two owners
- **THEN** the family reads as both devices with no owner `unavailable`; the unnamed snapshot is `invalid-request` saying to name the owner; the lamp's holds the lamp, the sign's the sign in both families; the others are `not-found`, `not-found`, `invalid-request` and `invalid-request`, quoting nothing they were given

#### Scenario: A page that loads its preview by reference
- **WHEN** a reader opens the sign's page and its preview, its settings and the links
- **THEN** the page refers to `content/preview.png` under a policy with `default-src 'none'`, `frame-ancestors 'none'` and `form-action 'none'`, the preview is a PNG, the settings show the greeting and signs without the token, and the links hold the sign's editor link and the place links

#### Scenario: A stalled reader
- **WHEN** a reader subscribes to large state messages and stops reading until its socket fills, and the stall limit passes
- **THEN** the gateway's edge ends the stream and logs `runtime.edge.disconnected` at WARN with `capacity` and its reason

#### Scenario: The dashboard's page
- **WHEN** a bookmark, the launcher, this origin's page and a page on the other loopback name load `/` and its assets, another local app's link, frame and fetch reach `/`, that link asks for an asset, another site's page or a link with an `Origin` asks for `/`, `/` is posted to or carries a query, and a runtime whose dashboard is not built is asked
- **THEN** the loads and the link are served without a cookie under the page's policy; the frame, the fetch, the asset, the other site and the `Origin` are `forbidden`, the post `not-found` and the query `invalid-request`, logged by route without the query; and the unbuilt runtime answers `not-found` on all three paths

### Requirement: Edge credentials and their reload

The configuration file's `edge` section SHALL be `{"credentials": <absolute path>, "browserAccess"?: "trusted-loopback", "launcher"?: <boolean>, "mcp"?: <boolean>, "editorLinks"?: {...}, "placeLinks"?: {...}}`, with editor links keyed by device routing ID (at most 16) and place links by ID other than `bunny` (at most 8, with a port), each a loopback `http` link without credentials, query or fragment; anything else SHALL refuse the file with `config-invalid`. The credentials file SHALL be `{"schema": "edge-credentials/1.0", "credentials": [{id, source, digest, scopes}]}`, a private file under the configuration file's rules of at most 64 KiB, with at most 32 credentials, distinct IDs, digests and sources, lowercase hexadecimal SHA-256 digests and never a token, sources not reserved (the core's, a module's, the runtime's own or the browser sessions' `bunny/parts/dashboard`), and distinct scopes from `read`, `control`, `ingest` and `admin`, and no other member, so a credential that names devices SHALL be refused rather than read wider than it was written; the runtime SHALL refuse to start with `edge-credentials-missing`, `edge-credentials-not-private`, `edge-credentials-invalid` or `edge-credential-source`. A token SHALL be compared with each digest in constant time.

`grantCredential`, `revokeCredential` and `writeEdgeCredentials` SHALL rewrite the file whole and owner-only while holding its lock, `<file>.lock`, which names the writer's process: writers in one process SHALL take turns, so changes made at once all take effect, and a writer in another process SHALL be refused with `edge-credentials-busy`; a writer SHALL create the lock with its content in one step and remove only a lock it created; a lock whose process has gone, or an empty or unreadable one over a minute old, SHALL be taken over in one step that never takes another writer's fresh lock: a writer that moved one SHALL put it back and refuse with `edge-credentials-busy`, and a temporary file a crashed writer left SHALL be removed. Each SHALL write a temporary file of its own name beside the file and rename it over the file only if the file still holds what the writer read, and otherwise SHALL refuse with `configuration-changed`, writing nothing. A grant of a credential the file holds as it is SHALL change nothing, and one whose ID the file holds with another digest, source or scopes, or whose source another credential has, SHALL be refused with `edge-credential-conflict`, as the old setup authority refused another owner's; a rotation revokes and then grants. SIGHUP and `Runtime.reload()` SHALL read the file again: a new credential SHALL be taken, a revoked or changed one SHALL have its streams ended and its next call refused with `unauthenticated`, and a file the runtime refuses SHALL keep the credentials it had. A SIGHUP while the runtime starts SHALL be kept and run once the gateway serves. Each reload SHALL log one `runtime.edge.reloaded` record, INFO with `succeeded` and the count, or ERROR with `failed` and the refusal's code.

`convertHubEdge(hubConfig)` SHALL carry the old Hub's credentials, with each ID, digest and scope, acting as `bunny/parts/<the ID in routing form>`, or `bunny/parts/dashboard-credential` for one called `dashboard`, and its `browserAccess`, `mcp`, `editorLinks` and `placeLinks`, with the launcher on, checked as the runtime's reader checks them. It SHALL drop every device grant, since no runtime grant limits a client to some devices (owner decision, 2026-10-07), and SHALL return `widened`, the ID alone of each credential with `read` or `control`, which the old Hub limited to the devices it named and the runtime does not, for the owner to review at the cutover. It SHALL refuse, with `convert-invalid` and no digest in its detail, IDs that would share a source, editor links that are not routing IDs, unknown scopes, another browser access, an `mcp` that is not a boolean, and links or counts the runtime would refuse.

#### Scenario: Grant, revoke and reload
- **WHEN** a producer's credential is granted and a reader's revoked in the file while the reader holds a stream, and the runtime reloads, and later a malformed file is reloaded
- **THEN** before the reload the producer is unauthenticated; after it the producer holds `ingest`, the revoked token is `unauthenticated`, its stream ended and it cannot reconnect; the malformed file's reload fails with `edge-credentials-invalid` while the operator still reads; the reloads are logged as `succeeded` then `failed`; and no token appears in a record, answer, health or span

#### Scenario: The edge section checked whole
- **WHEN** the edge section names a relative credentials path, an unknown member, another browser access, a launcher that is not a boolean, an editor link to another host or with a query, a place link without a port or a place called `bunny`, and a state directory too deep for the launcher's socket
- **THEN** each configuration is refused with `config-invalid`, the deep state directory refuses the start with `launcher-path-too-long`, and with the launcher off the same runtime starts and serves no socket

#### Scenario: The cutover's conversion
- **WHEN** a synthetic Hub configuration with five credentials, two limited to some devices with `read` and `control`, one with `read` and no device, a producer with `ingest` alone and one with `ingest` and a device grant, one of them called `dashboard`, trusted loopback sign-in, MCP on and links is converted, written as the installer would and served
- **THEN** each credential keeps its ID, digest and scopes with its source and no device grant, `dashboard`'s being `bunny/parts/dashboard-credential`; `widened` names, by ID alone, the three with `read` or `control` and neither `ingest` credential; the credentials file names no device; the edge section keeps the sign-in, MCP and links, a Hub without `mcp` converts with MCP off, each converted token holds exactly its scopes at `/api/v2/authority`, trusted loopback sign-in and MCP work, and the conversion refuses colliding IDs, an unknown scope, another browser access, an `mcp` that is not a boolean, an editor link to another host, a place link without a port and nine place links

#### Scenario: One credential per ID and source
- **WHEN** a credentials file gives two credentials one source, or one acts as `bunny/parts/dashboard`, the core, a module or the runtime
- **THEN** the first is `edge-credentials-invalid` and the others `edge-credential-source`

#### Scenario: Writers that never lose a change
- **WHEN** a credential is granted twice, granted again with another token, other scopes or another's source, revoked and granted with a new token; three grants and two revocations run at once; the file changes by hand while a grant and a revocation rewrite it; a live process, then a gone one, holds the lock beside a leftover temporary file; the lock comes to be another writer's while a grant holds it; and a fresh lock takes the place of a crashed writer's between a writer's judgement and its takeover
- **THEN** the second grant changes nothing, the others are `edge-credential-conflict` until the rotation, which takes; all five changes take effect; both writes are `configuration-changed` and the hand's change stands; the live lock is `edge-credentials-busy`, the gone one's lock and temporary file are taken over and removed, and the other writer's lock stands after the grant; and the writer that found a fresh lock puts it back, refuses with `edge-credentials-busy` and writes nothing

#### Scenario: A SIGHUP while the runtime starts
- **WHEN** a runtime with an edge gets SIGHUP while a module's start is still running
- **THEN** once it is ready it logs one `runtime.edge.reloaded` record with `succeeded`, after `runtime.edge.serving`

### Requirement: Route map of the old Hub

The runtime SHALL keep a route map of every route the old Hub serves in `apps/hub/src/server.ts` and its route modules, each with its 2.0 replacement or recorded drop and the story that delivers it, never a replacement left to no owner. The dashboard's `/`, `/dashboard.js` and `/dashboard.css` are served again (see "Gateway routes"). A request to a route the gateway does not serve SHALL answer 404 with `not-found`, whose detail names the replacement when the map knows the route, and SHALL be logged as `runtime.edge.refused` with `bunny.route` `other`, the route's template in `http.route` and its method in `http.request.method`, never the path's values. The old Hub's session label command SHALL map to the core's `session-label-set` command and its dashboard control, owned by #922, its playback routes to the playback module's `GET /api/v2/families/playback`, `sync playback` and `bunny.cmd.playback-control.<id>`, and its lighting routes to the LIFX module's `GET /api/v2/families/device`, `sync device and lifx-light` and `bunny.cmd.<family>.<bulb>`.

#### Scenario: Every route mapped
- **WHEN** a test parses the old Hub's server and automation routes
- **THEN** it finds at least 30 routes, every one is in the map, and requests to a lifecycle, a controller, an automation route and the old Hub's health answer `not-found` and are logged with their templates, with no device ID from the path in a record

### Requirement: Operator approval recovery

The core SHALL answer the `approval-recover` command on `bunny.cmd.approval-recover.<session>` through agent-state's `recoverApproval`, carrying the old Hub's `recover-approval`. It SHALL retire the one approval marker without an attention ID that the session holds on `turnId`, only while the session's evidence is uncertain, five minutes without evidence or since a restart; commit before it replies `accepted`; and publish `attention-cleared` with cause `recovered` and the session at its new revision in the command's trace, with no outcome. It SHALL refuse an unknown session with `not-found`, an `expectedRevision` other than the session record's revision with `revision-conflict`, and a session with no such marker or current evidence with `invalid-state`, changing nothing. The gateway SHALL send it as the caller's source from `POST /api/v2/commands/approval-recover` to a caller with `control`, and from the MCP tool `core_recover_approval`; a remote part with `control` MAY request it through the SDK edge. The core's manifest SHALL contribute the MCP read tool `core_sessions`.

#### Scenario: Recovery only while evidence is uncertain
- **WHEN** an approval without an ID is raised on a turn, an operator recovers it while evidence is current, for an unknown session, then after five minutes with a stale revision, for another turn, with the current revision, and again
- **THEN** the answers are `invalid-state`, `not-found`, `revision-conflict`, `invalid-state`, `accepted` and `invalid-state`; the accepted recovery clears the marker with an `attention-cleared` occurrence of cause `recovered` in the command's trace, and the core publishes no outcome

#### Scenario: The sessions tool
- **WHEN** `core_sessions` is read before the core starts, and then with no filter, `q`, `provider` and a session ID
- **THEN** it answers `unavailable` first, then the sessions at the core's revision, filtered by label, title, project or session ID ignoring case, and by provider

### Requirement: Offline tools hold the runtime's lease

`holdRuntimeLease(stateDir)` in `apps/runtime` SHALL take the core's lease on a state directory, the exclusive transaction on `modules/core.sqlite-owner` that the core holds from its start until it stops, without waiting, and SHALL hold it until `release`. It SHALL refuse with `runtime-running` while a runtime or another tool holds it, and with `lease-unavailable` when the lock file is not a regular file private to the user. It SHALL create `modules/` and the lock file, owner-only, when they are missing, as the core does, and SHALL write nothing to the lock file. An offline tool that changes a module's files, such as the Pixoo library migration, SHALL hold the lease for as long as it runs.

#### Scenario: A tool and a runtime on one state directory
- **WHEN** a runtime runs on a state directory and a tool asks for the lease
- **THEN** the tool is refused `runtime-running`; and when a tool holds the lease and a runtime starts, the runtime's core fails to take it and the runtime exits 1 with `core-failed`

### Requirement: A disposable run on a migrated Pixoo library

The runtime verification adapter SHALL offer the run scenario `pixoo-migrated`: its seed SHALL write a synthetic Pixoo library of the installed schema version 3 to `<data>/pixoo-library`, run the Pixoo library migration's `migrate` and `verify` into the run's state directory, as the installer will at the cutover, keep each one's JSON line in `<data>/migration/`, and fail the start unless both exit 0. The run SHALL then start the shipped runtime, with each module's simulated section, on that state directory, so a reviewer reads the migrated library through the gateway and runs the tool by hand against the run's library.

#### Scenario: The shipped runtime on a migrated library
- **WHEN** a run starts with `pixoo-migrated`
- **THEN** both kept lines report zero mismatches, the Pixoo module is running, the gateway's `pixoo-playlist` and `pixoo-rendition` families hold the migrated playlists, with their items in order, and renditions, and the tool asked to verify the run's state directory while the runtime runs is refused `runtime-running`

### Requirement: Action dispatcher and tracker

The core SHALL dispatch every device command, moment and mode change through one dispatcher, and track each as one operation (ADR 0012, "High-impact messages"; Hub #782). The gateway's action routes and MCP's `core_send_command` SHALL call it through the core module's `actions`, and core parts, such as automation, moments and the Hub mode, through `CoreHandle.dispatch`. An action SHALL be a command on `bunny.cmd.<family>.<target>` whose subject is the target, a type `org.bunny.<entity>.<verb>.requested`, a schema and an object payload, with who asks for it and an optional request ID, which one is generated without. The dispatcher SHALL refuse, before anything is recorded or sent, a malformed key, type, payload or request ID with `invalid-request`, a subject that is not its key's target with `invalid-message`, and the core's own operator commands, `approval-recover` and `notice-acknowledge` (`DIRECT_COMMANDS`), with `invalid-request`.

It SHALL record the action as `sent` in the core store before it sends anything, so a full disk refuses it with `unavailable` and the detail `storage-full` before any reply could say accepted, and nothing is sent. It SHALL send the command once, as `bunny/core`, with its kind's reply deadline as its expiry, inside a server span `bunny.command.request` that the command's request continues, record the owner's reply, and answer the caller with it: `accepted`, the owner's or the bus's refusal, or `uncertain-result`. The kinds and their deadlines, from the moment the action was recorded sent, SHALL be:

| Kind | Families | Reply deadline | Outcome deadline |
| --- | --- | --- | --- |
| device | every command to one device, a module's own families included | 5 s | 30 s |
| moment | `moment-play` | 5 s | 150 s |
| mode | `mode-set` | 5 s | 60 s |

The operation's state machine SHALL be: `sent`, then `accepted` on the owner's `accepted`, then `completed` with the outcome's result and evidence; `rejected` on a refusal, failed with evidence `none`, since a rejection proves no effect; `expired` when the command was still queued at its reply deadline, failed with evidence `none`; and `uncertain` when the handler had it at its reply deadline or no outcome arrived by the outcome deadline, with evidence `none` and `uncertain-result`. A late outcome SHALL complete the record: a definitive one, `succeeded` or `failed`, SHALL replace an uncertain result, history keeping both; an uncertain one SHALL add only its evidence to a definitive result; and a `succeeded` and a `failed` outcome for one operation, in either order, SHALL keep both, with the operation in `conflict` for a person, arrival order never picking a winner. A reply after an outcome SHALL only record what the owner said. A request ID SHALL name one action, ever: the same caller asking for the same action again SHALL get what that action got (`accepted`, its refusal, or `uncertain-result` while its reply is unknown) and nothing SHALL be sent; another action or another caller under that ID SHALL be refused with `duplicate-conflict`. Nothing SHALL ever send a command again: not a timed-out or uncertain one, not after a restart, which SHALL only let each pending operation's deadline pass, ending it `uncertain`. A clean stop closes the core's participant before the core stops, which settles the dispatcher's own requests: an action whose owner's handler has it with no reply SHALL end `uncertain` at once, with `uncertain-result` and the detail `the requester closed before the reply`, not at its deadline, and one still queued SHALL end `rejected` with `cancelled`, failed, never having run. Each step SHALL commit with its history row and each part's rows for it in one transaction, and SHALL be logged once, in the action's trace: `command.queued`, `command.admitted`, `command.rejected` at its code's level and `command.completed` (INFO for success, WARN for a failed, uncertain or conflicting result, and `bunny.reason` `timeout` at a deadline). The tracker's rows with a failed, expired, uncertain or conflicting result SHALL be the rows #923 turns into inbox items.

#### Scenario: Sent, accepted, completed
- **WHEN** an operator's action reaches a module that accepts it and reports its outcome
- **THEN** the operation is `completed` with the outcome's result and evidence, its owner, its command and its payload kept; history holds the steps `sent`, `reply accepted` and `outcome completed` with the outcome itself; each change reached the parts; the module got the command once, from `bunny/core`; and the core logged `command.queued`, `command.admitted` and `command.completed` in one trace with the outcome

#### Scenario: A refusal, a stopped module and an expiry
- **WHEN** a module refuses an action, an action's family has no running module, and an action waits behind one the module's handler holds past the reply deadline
- **THEN** the first two are `rejected`, failed with evidence `none` and their codes, the queued one is `expired` and never reached the module, and the held one is `uncertain`; once released its outcome completes it, and history keeps the uncertain step and the outcome

#### Scenario: An outcome deadline
- **WHEN** an accepted action has no outcome by its kind's outcome deadline, on the runtime's clock, and its outcome arrives later
- **THEN** a millisecond earlier it is still `accepted`, at the deadline it is `uncertain` with a WARN record, and the late `failed` outcome completes it while history keeps both; nothing was sent again

#### Scenario: A restart while an action is pending
- **WHEN** the runtime stops while an accepted action waits for its outcome and starts again on the same state directory
- **THEN** the action is still pending, ends `uncertain` at its deadline, is never sent again, and the same request ID answers what it got without sending

#### Scenario: A clean stop while an action is unanswered
- **WHEN** the runtime stops cleanly while the owner's handler holds one action with no reply and a second waits queued behind it, and starts again on the same state directory
- **THEN** the held one answers `uncertain-result`, `the requester closed before the reply`, and is `uncertain` at the stop, not at its deadline, which later adds nothing; the queued one answers `cancelled` and is failed, never having reached the module; and the restart sends neither

#### Scenario: Late and conflicting outcomes
- **WHEN** an action's module reports `succeeded` and later `failed` for it, another reports `failed` and later `succeeded`, and each sends its last outcome again unchanged
- **THEN** each operation is in `conflict` with both outcomes kept, the parts hear of the conflict, and each retransmission is acknowledged again and changes nothing

#### Scenario: One request ID, one action
- **WHEN** the same caller sends the same action twice under one request ID, then another payload under it, another caller uses it, and a refused action is sent again
- **THEN** the second answers `accepted` and sends nothing, the next two are `duplicate-conflict`, the refused one answers its refusal again, and each was sent once

#### Scenario: What is no tracked action
- **WHEN** the dispatcher gets a state key, a subject that is not its key's target, an approval recovery, a malformed request ID, a moment and a mode change nobody answers
- **THEN** the first four are refused before anything is recorded, and the moment and the mode change are tracked as kinds `moment` and `mode` with their deadlines, failed `unavailable`

#### Scenario: A full disk
- **WHEN** the core store is full and an operator sends an action
- **THEN** it is refused with `unavailable` and the detail `storage-full`, nothing is recorded, and the module never gets the command

### Requirement: Outcome intake and acknowledgment

The core SHALL take every state, removal, occurrence and outcome another participant publishes, on one subscription to every published key, so history keeps each participant's messages in order; it SHALL leave a hook's lifecycle observation to its reducer and keep no acknowledgment. The intake SHALL commit in bounded groups, at most 100 messages or about 50 ms of its own work each, with a turn of the event loop between groups, so a burst never holds the runtime for one commit per message; within a group each message SHALL keep its own verdict, as below, and a full disk SHALL refuse the whole group. A message delivered to the intake but not yet committed is lost when the intake queue overflows, when the runtime crashes or stops before the message's group commits, or when a full disk refuses that group. On an overflow the bus drops what the subscription's bounded queue cannot hold, and the core SHALL record each such gap as `operation.failed` with `capacity` and the dropped count. An outcome is never lost in these ways, since it stays unacknowledged in its module's outbox until the core commits it and comes again at the module's next start; an occurrence or removal is lost, and a lost state's change shows in its entity's next state. It SHALL drop a duplicate removal, occurrence or outcome by `(source, id)` durably, since history keeps each whole message once, across restarts. It SHALL refuse the same `(source, id)` with other content as `duplicate-conflict`, record it at WARN, keep the message apart for diagnosis, the latest 1,000, and change no operation, open no inbox item and send no acknowledgment. An outcome SHALL advance the operation whose request ID it names, when its subject is the operation's target, its type the command's outcome type and, once the owner replied, its source the owner; any other outcome SHALL be kept in history only.

Once a new outcome commits with its history rows and its operation's change, the core SHALL acknowledge it to its module with `outcome-recorded` (`bunny-message-profile`, "Outcome acknowledgment"), added in that transaction so it goes out after the commit. It SHALL acknowledge an exact duplicate again, with no durable work and no second change, so a lost acknowledgment recovers at the module's next start. A commit the store refuses SHALL send no acknowledgment, so the module keeps the outcome and sends it again. Every intake record SHALL be `message.received`, carrying the incoming message's trace and span: INFO for an outcome, occurrence or removal taken and for a duplicate outcome, which recovers an acknowledgment, DEBUG for any other duplicate, WARN for a conflict, and, for one the store refused, its code at that code's level, so a full disk's `unavailable` is WARN. Each module shipped with the runtime SHALL forget an acknowledged outcome through its outbox (`bunny-sdk`, "Per-module outbox").

#### Scenario: A module's crash between saving and reporting
- **WHEN** a module saves an outcome and the runtime stops before it goes out, and the runtime starts again
- **THEN** the module reports it at its start, history takes it once, the operation completes, the module is acknowledged, and no command is sent again

#### Scenario: A resent outcome
- **WHEN** the core's acknowledgment of an outcome is lost and the module restarts
- **THEN** the module sends the outcome again, the core records it as a duplicate at INFO, acknowledges it again and keeps one history row, and the next start sends it no more

#### Scenario: A reused (source, id)
- **WHEN** a module sends an outcome again with its message ID and other content
- **THEN** it is refused with `duplicate-conflict` at WARN in the message's trace, kept for diagnosis, the stored outcome stands, no part hears a change and no acknowledgment is sent

#### Scenario: A full disk
- **WHEN** an outcome arrives while the core store is full, and is sent again once there is room
- **THEN** the first is refused at WARN with `unavailable` and not acknowledged, its operation stays pending, and the second completes it and is acknowledged

#### Scenario: A burst
- **WHEN** a module publishes 600 occurrences in one turn
- **THEN** history takes all 600 in a few grouped commits, a timer set after the burst runs between two of them, and a service process at the default lag limit stays up

#### Scenario: Verdicts within a group
- **WHEN** one group holds a copy of a message history holds, the same `(source, id)` with other content, a new occurrence with its copy and a conflicting one, a duplicate outcome and a new outcome with its copy
- **THEN** each copy is a duplicate, each conflict is refused and kept, the duplicate outcome is acknowledged again, the new outcome completes its action and is acknowledged once, and the group commits once

#### Scenario: An intake queue overflow
- **WHEN** a module publishes more messages in one turn than the intake's queue holds
- **THEN** the core records one `operation.failed` with `capacity` and the dropped count, and history takes every message that was not dropped

#### Scenario: Trace context on the intake record
- **WHEN** the core takes an outcome, and a disposable run's follow query asks for that outcome's trace
- **THEN** the core's `message.received` carries the outcome's trace and span, and the trace query finds it with the outcome's publication

### Requirement: Core history

The core SHALL keep history in private rows of the core store, with no time limit, each written in the transaction that commits what it records: every removal, occurrence and outcome whole, the core's own and every other participant's; each state change, the core's own and every module's, as a compact change event, what changed since the record history held for that entity (`previous`, its revision, or null for a new entity, whose every member changed), each changed top-level member with its new value and each removed member, never a whole snapshot, a state that changed nothing or is stale adding nothing; and each step of every tracked action, as its event, status, result, evidence, error and the outcome that caused it. A removal SHALL leave a tombstone at its revision, so a late state at or below it adds nothing. History SHALL keep no hook's raw lifecycle observation, whose changes it keeps, and no acknowledgment. Viewing history SHALL never trigger a device or automation; its read API with filters and the timeline are Hub #923's (owner decision, 2026-10-07).

#### Scenario: What changed
- **WHEN** a module publishes a record, a change of one member, the same record again, an older one, a record without a member, an occurrence twice with one ID, a removal and a later state at the removal's revision
- **THEN** history holds three change events, the first with `previous` null and every member, the second with the one member, the third with the member removed, then the occurrence once and whole, and the removal, and nothing else

#### Scenario: The core's own changes
- **WHEN** a hook observes a session start and an approval prompt
- **THEN** history holds the two session states as change events, the second holding only what changed, and `attention.raised` whole, in the commits that published them

### Requirement: Action routes

With an edge, the gateway SHALL serve `POST /api/v2/commands/<family>` to a caller with `control`: `{target, data, requestId?}`, the device's routing ID, the command's payload without a request ID and an optional request ID, sent through the core's dispatcher as `bunny.cmd.<family>.<target>` for the caller's source, with the type `org.bunny.<entity>.<verb>.requested` and the schema `<family>/2.0` that follow from the family. The route SHALL check the command against its family's schema, as the edge checks a remote message, before the dispatcher has it: a body or target that is malformed, a payload that names a request ID or fails the schema, a family that is no command family, and the core's own operator commands SHALL be `invalid-request`, a family whose schema the runtime does not know `not-found`, and nothing SHALL be tracked or sent. A known family that no running module answers passes the check: the dispatcher SHALL track it, and the bus's refusal SHALL answer it, 503 `unavailable`, recorded failed. It SHALL answer `{"schema": "command-reply/2.0", "status": "accepted", requestId}`, or the dispatcher's refusal or `uncertain-result` in the shared error body at its status, and `unavailable` when the runtime hosts no core or the core is not running. MCP SHALL offer `core_send_command`, `{family, target, data, requestId?}`, to a credential with `control`, which sends the same action. At the SDK edge, a remote grant SHALL request only the core's operator commands directly (`DIRECT_COMMANDS`): a device's command, a moment, a mode change and a module's own family, module-internal ones included, SHALL be `forbidden`, so no action bypasses tracking.

#### Scenario: An operator's action
- **WHEN** an operator sends a lamp switch on the action route, sends it again under its request ID, sends another under that ID, and sends one without a request ID
- **THEN** the first answers `accepted` with its request ID and is tracked to its outcome as the operator's; the second answers the same and sends nothing; the third is `duplicate-conflict`; the fourth gets a generated request ID; and the lamp switched once for the first

#### Scenario: Registry codes for invalid input
- **WHEN** the route gets a body that is not JSON, an extra member, a target that is not a routing ID, a payload with a request ID or outside its schema, a malformed request ID, a family whose schema the runtime does not know, a family that is no command, a state family, the core's notice acknowledgment, a reader's and a hook's action, a query and no token
- **THEN** they answer 400 `invalid-request` for the malformed ones, 404 `not-found` for the unknown family, 403 `forbidden` for the reader and the hook, and 401 `unauthenticated` without a token, nothing reaches the lamp, and the refusals are logged by route template, never what the caller sent

#### Scenario: A known family with no running module
- **WHEN** an operator sends an action of a known command family that no module in the runtime answers
- **THEN** it answers 503 `unavailable`, not `not-found`, and the operation is tracked, `rejected`, failed with `unavailable`

#### Scenario: Direct requests at the edge
- **WHEN** an operator's remote part requests a lamp switch, a mode change and a notice acknowledgment directly through the SDK edge
- **THEN** the first two are `forbidden`, and the third reaches the core, which answers it

#### Scenario: MCP's action
- **WHEN** an operator calls `core_send_command` with a valid and an invalid payload, and a reader calls it
- **THEN** the first answers `accepted` and is tracked as the operator's, the second answers `invalid-request` in the shared error body, and the reader's never reaches the core

#### Scenario: Without the core
- **WHEN** the runtime hosts no core and an operator sends an action
- **THEN** it answers 503 `unavailable` and nothing is sent

### Requirement: Agent hooks and Codex Desktop in the catalog and disposable runs

The harness contract SHALL include a `hook` call that runs the 2.0 hook script (`runtime-agent-hooks`) once, as a client's hook command does, with an unchanged lifecycle 1.x producer file naming the runtime's port and a payload on stdin, and that, asked with `runtime: 'stopped'`, runs it while the runtime is stopped and starts the runtime again on the same state directory and port afterwards. Each execution adapter SHALL grant the agent hooks' converted producer credential (`PRODUCER`, with `ingest` alone, under a run-generated token in the Hub's form with the synthetic prefix `tok_SYNTHETIC835`) beside the parts' credentials, and its `gateway` call SHALL also act as that producer. The hook's environment SHALL carry no Claude Code variable and no `CODEX_HOME` of the process that runs it. The catalog SHALL also cover the agent hooks through the 2.0 hook script and the Codex Desktop module with a simulated marker (`runtime-codex-desktop`). In a disposable run the supervisor SHALL write the producer file once it knows the runtime's port, at `<data>/config/producer/producer.json`, owner-only; its harness API SHALL drive the simulated marker, and its restart SHALL take an optional `holdMs`, a whole number of milliseconds up to 10,000, for which it keeps the runtime stopped before it starts it again; the runtime's child SHALL reach the simulated marker over its IPC channel without a path; and the served candidate SHALL include the hook script and the module's build, whose sources `build-current` watches.

#### Scenario: Agent hooks on both transports and in a run
- **WHEN** `agent-hooks` runs in process, through the edge and in a disposable run: the hook script reports a Claude Code session's start, a prompt with a private canary, a permission dialog, the tool that ends it and the turn's end; the producer's credential sends a command and reads; a hook runs while the runtime is stopped; and the next hook runs after the restart
- **THEN** each hook exits 0 within 3 s and writes nothing; the session appears with its project, holds the turn, raises the approval prompt and clears it as resolved, and ends idle with its notice; the producer's command and read are `forbidden` and its authority is `ingest`; the hook while the runtime is stopped is lost, so after the restart the session keeps its turn and is uncertain, until the next hook makes it current on the new turn; and no record, message or answer holds the canary or a token

#### Scenario: Codex Desktop's marker on both transports and in a run
- **WHEN** `codex-desktop-read` runs in process, through the edge and in a disposable run
- **THEN** it passes as `runtime-codex-desktop` "Simulated marker and acceptance tiers" requires, and every message the parts see follows profile 2.0

### Requirement: Core save cost

The core store SHALL measure each save that commits: agent-state's commit through the store's lease, from before it applies the change to the last committed state, which clones, validates and serializes the whole state, until the outbox's transaction has committed, before any of its messages is published. A save's size SHALL be the byte length of the state block it stores, and its time SHALL be read from a monotonic clock. The store SHALL log `storage.cost.high` at WARN as the state block passes half of the 16 MiB limit, carrying the block's size in `bunny.state.bytes`, and as one save takes longer than 100 ms, carrying its time in whole milliseconds rounded up in `bunny.save.duration_ms`; each condition SHALL be recorded once per run, and the first save back within its limit SHALL log `storage.cost.normal` at INFO with that save's size or time. Both records SHALL carry `bunny.operation` `storage` and no other field, never the state's content. A save that does not commit SHALL change neither condition, the runs SHALL be kept in memory only, and a logger that throws SHALL lose only its record: the save SHALL stand and agent-state's owner SHALL NOT be faulted. The 16 MiB limit and its `state-capacity` refusal SHALL be unchanged, and the intake's grouped transactions and freshness refreshes, which do not write the state block, SHALL NOT be measured.

#### Scenario: A state block past its limit
- **WHEN** a second session's start takes the state block past a lowered limit, a further change keeps it there, a day later agent-state's maintenance lets go of what it keeps for a day, and two more saves stay within the limit
- **THEN** the store logs one `storage.cost.high` WARN with the size of the block that passed the limit and one `storage.cost.normal` INFO with the size of the first block back within it, and each is written whole as a profile 1.5 module record of the core

#### Scenario: A slow save
- **WHEN** saves take 5 ms, exactly 100 ms, 100.25 ms, 250 ms, 5 ms and 5 ms of work in their transactions, and each message's publication after its commit takes a second
- **THEN** the store logs one `storage.cost.high` WARN with 101 ms and one `storage.cost.normal` INFO with 5 ms, publication counts toward no save, and every save commits

#### Scenario: A save that does not commit
- **WHEN** a slow save commits, a quick one is rolled back by a part that throws, and after the owner opens again a quick save commits
- **THEN** the store logs the WARN, nothing for the refused save, and the INFO only for the save that committed

#### Scenario: A logger that throws
- **WHEN** a slow save and then a quick one commit while the logger throws on every record
- **THEN** both observations are `applied` at revisions 1 and 2, and the state row holds revision 2

### Requirement: Observe the verification child's private home without inspecting process environments

Disposable runtime verification SHALL obtain HOME as one bounded, child-observed field over the directly forked child's private IPC channel, for both fixture and shipped runtimes (Hub #1015). It SHALL NOT read process-environment files or serialize an environment object. Only the current child and generation may supply the observation; every spawn SHALL reset prior evidence. Missing or malformed evidence SHALL leave the existing private-state check failing, and an observed path outside the run SHALL fail it. Startup SHALL wait at most one second after runtime readiness for the observation, without inferring a value or resending. The observation SHALL remain in the existing private boundary report, with no new log or diagnostic payload. Open-file, default-state, credential-file, network guard, restart and cleanup checks SHALL retain their existing behavior.

#### Scenario: Both entry points report their own home
- **WHEN** a disposable fixture or shipped runtime starts with a private run HOME
- **THEN** verification observes that child's HOME through IPC and the existing private-state check passes when its other conditions hold, without reading a process-environment file

#### Scenario: Missing or invalid home evidence
- **WHEN** the current child reports no HOME, a malformed or oversized report, or an absolute HOME outside the run
- **THEN** private-state verification fails, no environment object is serialized, and no intended launch path substitutes for missing evidence

#### Scenario: A restart replaces the observation
- **WHEN** a runtime restarts and an old child or generation reports a HOME
- **THEN** that report cannot qualify the new child, which starts with missing evidence and qualifies only through its own valid report

#### Scenario: Process-environment inspection is reintroduced
- **WHEN** a runtime verification source adds a process-environment-file path
- **THEN** the source regression check fails without executing the read

### Requirement: The shipped list from module registrations

The runtime's build SHALL write a registry with one static import of the `registration` of each package in a folder under `modules/`, in folder order, so the runtime loads no module at run time and the shipped set is fixed when it is built (Hub #999). The shipped list SHALL hold the agent-session core first, by construction, then every registration that ships, each after the modules its `after` names, and otherwise by `order`, then by name. The list SHALL NOT assemble when a registration is named `core`, two registrations share a name, an `order` is not a finite number, an `after` names a module that does not ship, or registrations wait on each other. The shipped order SHALL be the one before registration: the core, then the playback, LIFX, Tidbyt, Pixoo, Nanoleaf and Codex Desktop modules.

#### Scenario: The core first, then each shipped registration
- **WHEN** the shipped list is built from registrations with orders, ties and an `after` that names a module with a higher order
- **THEN** the core is first, a lower order starts first, a tie starts by name, the `after` module starts before the one that names it, and a module that does not ship is left out

#### Scenario: A list that breaks a rule
- **WHEN** a registration is named `core`, two share a name, one names an unknown or an unshipped module in `after`, two wait on each other, or one's order is not a number
- **THEN** the shipped list does not assemble, and the error names the rule

#### Scenario: A module added in its own folder
- **WHEN** a throwaway module is written only under its own folder in a scratch checkout, with its registration, its simulated device and its scenario file
- **THEN** the registry the build writes imports it, the shipped list places it by its order when it declares itself shipped and leaves it out when it does not, the catalog's collection takes its scenario file, and its scenario passes in the in-memory harness on both transports

### Requirement: Harnesses drive registered modules through their registrations

The in-memory harness and a disposable run SHALL build and simulate each registered module through its registration's `simulation`, and SHALL keep code of their own only for the core and the fixture modules (Hub #999). The in-memory harness SHALL create each registered module's simulated device once, on its own clock and scheduler, so the device outlives the runtime's restarts and crashes. A disposable run's supervisor SHALL hold each registered module's `run` half, which outlives the runtime child, and SHALL answer each call the child's module makes over the IPC channel; a call the module abandons SHALL abort the supervisor's call, a runtime that ends SHALL abort its calls, and an answer that comes after SHALL be dropped. The supervisor SHALL hand each new child what the last one left, and SHALL push a simulation to the child's module when its registration asks. Both harnesses SHALL refuse a simulation whose device, action or other field the registration does not take, and the supervisor's state document SHALL key each registered device by its module's name. Both harnesses SHALL take one list of payload schemas, the fixture families' and every registration's, and one validator that registers each registration's families with its checks. The catalog SHALL hold the core's and the fixture modules' scenarios, and SHALL collect each registered module's scenarios and disposable runs from its own file under `tests/scenarios/modules/`, after the core's, in file-name order. A workflow check SHALL fail when a shared file of the runtime or the harnesses names a device module.

#### Scenario: The same catalog through registrations
- **WHEN** `npm run test:runtime:scenarios` and the disposable runs' tests run after the refactor
- **THEN** the catalog lists the same scenarios by name, each passes in process and through the edge, and the disposable runs keep the same run scenarios, capture steps and results

#### Scenario: A disposable run's link
- **WHEN** a module built over the link calls its device, a simulation is pushed, a call is abandoned, and the runtime that made a call ends
- **THEN** the call reaches the supervisor's device and the answer comes back, the push reaches the module's process, the abandoned call and the ended runtime's call abort the supervisor's own call, a call aborted before it is sent is never sent, and a device that refuses a call answers `failed`

#### Scenario: A shared file names a module
- **WHEN** a module's name, in any letter case and with its hyphens as hyphens, spaces or nothing, is added to a shared file
- **THEN** `npm run test:workflow` fails, naming the file, the line and the module, while the core's and a fixture module's names pass

### Requirement: Core storage classifies wrapped full-disk errors
The core store SHALL use the SDK full-disk classifier for errors raised while opening its tables and committing a transaction. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL follow the existing full-disk path, preserving durable admission, no-publication-before-commit, and recovery behavior. The core's separate lease `SQLITE_BUSY` retry SHALL remain unchanged.

#### Scenario: Wrapped ENOSPC while opening the core store
- **WHEN** creating the core store tables fails with an error caused by `ENOSPC`
- **THEN** startup reports storage unavailable and the core records the existing full-disk failure state

#### Scenario: Wrapped ENOSPC during a core transaction
- **WHEN** a core transaction fails with an error caused by `ENOSPC`
- **THEN** the change is refused as full, no observation is published or committed, and the core retains its existing recovery behavior

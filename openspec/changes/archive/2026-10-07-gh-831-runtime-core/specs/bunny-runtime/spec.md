## ADDED Requirements

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

The core store SHALL keep agent-state's durable 2.1 state in the old Hub adapter's format, one JSON row in the table `state`, checked on every load and commit under a compare-and-swap on the revision. It SHALL hold a lease, an exclusive transaction on the lock database `core.sqlite-owner` beside it, for the owner's life, and a second owner, in another process or this one, SHALL wait for it until agent-state's deadline. Each change SHALL commit with the 2.0 messages it publishes, the published records, a history row for each occurrence and removal and the `(source, id)` of the intake it took, kept for 24 hours, in one SQLite transaction through the SDK's outbox, and its messages SHALL go out only after the commit, in order. A change that does not commit SHALL change nothing and publish nothing. On a full disk the core SHALL refuse the change before anything reports it accepted, log the intake `rejected` with `capacity`, and open agent-state's owner again on what committed, so the next observation is taken once there is room. A publication refused after a commit SHALL leave the change standing, be reported once per run of refusals as committed and awaiting publication, and go out at the next commit or start with the message's stored `id`, `time` and trace context. After a crash between a commit and its publication, the next start SHALL send each stored message once.

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

### Requirement: Core extension point

The core SHALL take parts, the extension point for Hub #782's tracker and history and #923's inbox. A part SHALL be able to create its own tables in the core store once the core holds it, serve its families through the core's sync at the core's revision, derive rows from each committed core change in that change's transaction, and run its own intake through the core store's transactions and outbox. A part that throws in a change's transaction SHALL roll the whole change back.

#### Scenario: A part's rows
- **WHEN** a part derives a row from each committed change, and then throws
- **THEN** the first change's row commits with it, and the throw leaves every row unchanged, publishes nothing and is reported as a failed commit

## MODIFIED Requirements

### Requirement: Start and serve health with zero modules

The runtime SHALL start with the fixed module list shipped in its code, and SHALL NOT load modules any other way. The shipped list SHALL hold the agent-session core first and no device module yet, and the runtime SHALL also run with no module at all. It SHALL serve `GET /api/runtime/v1/health` on the loopback address at a configured port, where 0 picks a free port. Health SHALL answer 200 with a `runtime-health/1.0` document while the process serves: `status` `ok` when every module runs and the lag check, if any, is active, and `degraded` otherwise; the supported module API version, the start time, uptime, the process's memory, the lag check's status; and one entry per module with its name, API version, state, `healthy`, its count of sync restarts and, when refused or failed, a reason whose code comes from the 2.0 error registry. The server SHALL answer only a request that names it as its host, `127.0.0.1:<port>` or `localhost:<port>` in any letter case with the exact port, and carries no `Origin` and no `Sec-Fetch-Site` other than `none`; any other request SHALL answer 403 with the shared error body and code `forbidden`. Every other method, path or query SHALL answer 404 with the shared error body and code `not-found`, except the SDK edge's routes while the edge is configured (see "Simulated modules and the SDK edge"). Stopping the runtime SHALL stop every module and close the health server; stopping again SHALL return the same result. In the service process, SIGTERM or SIGINT SHALL stop every module and exit 0. The entry point SHALL catch both signals before the rest of the runtime loads: a signal while it loads SHALL exit 0 before anything is created, and a signal while modules start SHALL stop them once their starts settle, without a ready line.

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
- **THEN** it writes a `runtime.ready` line with its URL, health lists the core running and no other module, and SIGTERM stops it with exit status 0

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

### Requirement: Module context

The runtime SHALL call each module's `start` with a context that gives the module:
- its own participant on the one shared bus, with source `bunny/modules/<name>`, or `bunny/core` for the module named `core`, including `publishMessage`;
- a logger whose records have the one module scope, `bunny.module`, carry the module's name in the attribute `bunny.module`, and carry the trace ID, span ID and flags of a given trace context;
- tracing that starts a span in a given parent's trace, or a new trace without one;
- the runtime's clock and a scheduler on the runtime's scheduler, which also run the bus's `time`, `expiresat` and request deadlines;
- worker threads that the runtime terminates when the module stops;
- the module's own SQLite file, `modules/<name>.sqlite` in the runtime's private state directory, opened with `node:sqlite` on first use, mode 600, and kept across restarts;
- an abort signal that aborts when the module stops.

A scheduler delay SHALL be an integer from 0 to 2147483647; any other SHALL throw `RangeError`. Once the module's stop begins, its participant, scheduler, workers and database SHALL refuse use with `invalid-state`, while its logger, tracing, clock and signal SHALL keep working, so that its `stop` can still log. Log records SHALL be diagnostic-contract records, as "Diagnostic-contract log records" requires, at `info` and above by default.

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

### Requirement: Fixture module

The runtime's tests SHALL hold a fixture module, a simulated lamp that later stories use as their stand-in device module, a consume-only fixture chime, and the fixture core: the real core with stand-in parts. A module that reaches a device SHALL be created by a factory that takes the device's transport, `create<Name>Module({transport})`, with no manifest slot or registry for transports; the lamp (`createLampModule`) and the chime (`createChimeModule`) SHALL show the convention with simulated transports that keep their state when the runtime restarts.

The lamp SHALL serve its lamps through sync, copy the core's mode and sessions, switch a lamp on command, refuse an unknown lamp with `not-found` and switching on in quiet mode with `invalid-state`, and report each switch through its outbox: the lamp's state, an occurrence and the outcome. It SHALL accept a command whose `requestId` it already handled from the same source without acting or reporting again. When its lamp cannot be reached, its outcome SHALL be `failed`, with evidence `none` and the `unavailable` error. Its indicator SHALL show whether a session waits for a person. The chime SHALL ring once for each approval prompt in the sessions it copies, keeping what it rang in its own SQLite file across restarts. Both SHALL pass the module test kit.

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

### Requirement: Scenario catalog and in-memory harness

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, and the families a reader copies. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through a `RemoteEdge` on 127.0.0.1 with a run-generated token per part. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, with a duplicate command, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. The deadline answers SHALL follow the SDK on both transports: a command its handler holds at the deadline is `uncertain-result`, and one still queued is `expired`, as `bunny-sdk` "Request and respond with expiry" requires; a requester that closes while its command is queued gets `cancelled` in process and `uncertain-result` remotely, as "One conformance suite for every transport" fixes per transport. A remote requester whose command is in flight when the runtime crashes SHALL get `uncertain-result`, as the remote client settles a call whose connection drops, by the command's deadline plus `REQUESTER_GRACE_MS` at the latest. An in-process requester dies with the runtime; the harness labels its request `lost`, which is not an SDK answer.

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

### Requirement: Simulated modules and the SDK edge

The shipped module list SHALL be a list of module factories, each of which creates its module with its real device transport or with its simulated one; with `--simulate`, the runtime SHALL build every module with its simulated transport. With `--edge`, the runtime SHALL serve the SDK's remote transport (`RemoteEdge`, #883) on its health listener under `/api/sdk/v1/`, on the modules' bus, under the same local-request rules as health. The edge SHALL serve only once every module's start has settled, and only until the runtime stops: before then, and from the start of a stop until the listener closes, its routes SHALL answer 503 with `unavailable`. Its grants SHALL come from `edge-grants.json` in the state directory, `{"schema": "edge-grants/1.0", "grants": [{source, token}]}`: a private file (mode 600, one link, owned by the runtime's user) never reached through a link, with at least one grant, well-formed sources, tokens of 32 to 512 characters without spaces, and no token shared. A grant whose source is the core's (`bunny/core`) or a module's (`bunny/modules/<name>`) SHALL be refused, so no remote part can publish as either. The runtime SHALL refuse to start, before it serves, with `edge-grants-missing`, `edge-grants-not-private`, `edge-grants-invalid` or `edge-grant-source` as the `runtime.failed` record's `error.code`. No refusal or log record SHALL quote a token. The edge SHALL check remote messages against profile 2.0, the core families, the modules' own schemas and any families the caller adds, and the runtime SHALL log the edge's connections, disconnections and refusals. As the diagnostic contract requires, a record SHALL NOT hold the raw message or stack: a refusal's record SHALL hold its route, or `other` when the route is none of the edge's, its granted source if any, its code from the 2.0 error registry and, in the diagnostic contract's `bunny.reason`, that code's fixed registered reason (none for `internal` or `uncertain-result`, whose effect may have happened), and never the refusal's detail. The `runtime.started` record SHALL say whether modules are simulated and whether the edge is configured, and a `runtime.edge.serving` record SHALL follow once the edge serves; both SHALL carry the listener's port, never its URL. Stopping the runtime SHALL close the edge before it stops the modules.

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

## MODIFIED Requirements

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

### Requirement: Core store transactions and failures

The core store SHALL keep agent-state's durable 2.1 state in the old Hub adapter's format, one JSON row in the table `state`, checked on every load and commit under a compare-and-swap on the revision. It SHALL hold a lease, an exclusive transaction on the lock database `core.sqlite-owner` beside it, taken without writing anything, from the core's start until it stops, including while it opens agent-state's owner again after a failed commit; a second owner, in another process or this one, SHALL never get it while the first holds it: one in another runtime SHALL be refused when it opens the core's database, which the first keeps to itself, and one that reaches the lease SHALL wait for it until agent-state's deadline. Each lease SHALL reload the store's revision, commit count and records from the file, and a file that holds another owner's state SHALL be refused before anything is written to it. Each change SHALL commit with the 2.0 messages it publishes, the published records, a history row for each occurrence and removal and the `(source, id)` of the intake it took, kept for 24 hours past the later of the commit and the observation's own instant, in one SQLite transaction through the SDK's outbox, and its messages SHALL go out only after the commit, in order. Each change SHALL take that one commit, and what it published one more after the sends, both at the connection's level; after a crash between the sends and that commit, the next start SHALL send the change's messages again with their stored `id`s. A change that does not commit, a failed rollback included, SHALL change nothing, publish nothing and never be reported committed. On a full disk the core SHALL refuse the change before anything reports it accepted, log the intake `rejected` with `capacity`, and open agent-state's owner again on what committed, so the next observation is taken once there is room. A full disk SHALL never fail the core: an owner that cannot be opened again, a full disk at the start, whether a first start, where the store cannot create its tables, or a start after a clean stop, and a refresh the store refuses SHALL leave it running, refusing durable work with `capacity` or `unavailable` and syncs with `unavailable`, and trying again after a backoff that doubles from 1 s to 60 s. While the store refuses durable work, the core SHALL record the transition once, then a summary at most once a minute, then the recovery, with each attempt at DEBUG. A publication refused after a commit SHALL leave the change standing, be recorded once per run of refusals as `outbox.deferred`, and go out at the next commit or start with the message's stored `id`, `time` and trace context. After a crash between a commit and its publication, the next start SHALL send each stored message once.

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

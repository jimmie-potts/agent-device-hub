## Context

The runtime is one Node process: every module, the core and the SDK edge that agent hooks reach share one event loop.
`node:sqlite` is synchronous, so each commit at `synchronous = FULL` blocks that loop for a sync to disk. Module
databases were in SQLite's default rollback journal mode, which syncs the journal and then the file on every commit.

The outbox stored a transaction's messages in that transaction's one commit, which is right, and then marked or deleted
each published row in a commit of its own. The core already commits each change, with its records, history and intake,
in one outbox transaction, so its extra commits were the per-message bookkeeping.

ADR 0012's rules bound the change: committed is not published, a crash never loses an outcome, the core drops
duplicates by `(source, id)`, an `accepted` reply means the owner stored what it needs to report the outcome, nothing
resends a command, and delivery has no replay of occurrences. The in-process bus does not drop duplicates, so a
subscriber other than the core may act on a resent occurrence.

## Goals / Non-Goals

**Goals:**
- Fewer commits per command and per published batch, and less loop time per commit, with the outbox's guarantees
  unchanged.
- Kill tests at both crash points of the publication, each with a negative control.
- A recorded decision on `synchronous`, and before and after numbers for #123 from a repeatable probe.

**Non-Goals:**
- A module's own commits outside the outbox, such as LIFX's write that marks a command started. With this change a LIFX
  command costs five synced commits and 29-51 ms of loop time on the probe's simulated bulbs, against the hooks' 250 ms
  p95 budget, so no follow-up is needed for them. A later baseline on
  [#123](https://github.com/jimmie-potts/agent-device-hub/issues/123) can reopen it. PR #971 combines Pixoo's own.
- Batching several observations into one core transaction. agent-state's owner commits each `ingest` and the core
  replies after it, so that would change agent-state's API and the core's one-at-a-time queue. Revisit it if the save
  warning of [#976](https://github.com/jimmie-potts/agent-device-hub/issues/976) fires on the real install, or its
  post-cutover reading shows saves over 100 ms.

## Decisions

- **One bookkeeping commit per publication batch, after the sends settle.** A batch is what one send takes: the rows
  waiting when it starts. It sends them in order, and then one transaction deletes the states, removals and occurrences
  that went out and marks the outcomes. A refusal stops the send, and the commit still covers what went out before it.
  Transactions that commit before a queued send starts chain behind it, and that send takes their rows too, so they
  share one bookkeeping commit; one that commits while a send is under way waits for the next send. Rejected:
  committing the bookkeeping before the sends, which would lose every message of a process killed between that commit
  and the send, as the kill test shows, and deferring it into the next transaction, which leaves no commit for the last
  batch before a clean stop, so a clean restart would replay states and occurrences.
- **A crash between the sends and that commit sends the batch again.** That window existed for one message before; it
  now covers the batch. The messages go out again with their stored `id`, `time` and trace context. The core drops them
  by `(source, id)`; another in-process subscriber may hear them twice. In process, a batch's sends and its commit run
  in one turn of the loop, so the window is that turn; for a remote part, whose sends are HTTP calls, it spans them. A
  bookkeeping commit that fails leaves the rows to go out again with the next send, and is reported as a refused publish
  is, with `internal`: the fixed detail `committed, awaiting publication` then means the messages went out and wait to
  be marked.
- **Every commit at the connection's level.** The work's commit, the bookkeeping commit and `acknowledge` all run at the
  module's `synchronous = FULL`. `NORMAL` is rejected for each of them:
  - For the work: in WAL mode it skips the sync at commit, so a power loss, a kernel crash or a stopped WSL VM
    (`wsl --shutdown`, a Windows restart) can undo a commit that already returned. That would lose an outcome after the
    device acted, or the record of a command already answered `accepted`, which ADR 0012 rules out. A process crash
    alone loses nothing in either mode.
  - For the bookkeeping: a power loss could undo it long after the sends, up to the next synced commit, and the next
    start would then send its states and occurrences again. ADR 0012 rules out replaying occurrences, and the
    in-process bus does not drop them. It would also record a second `outcome.published`.
  - For `acknowledge`: an undone acknowledgment sends the outcome again at the next start to every subscriber after the
    core recorded it. The core acknowledges the copy again, but nothing shows that no other subscriber acts on it, and
    keeping the level costs one synced commit per acknowledged outcome.

  The first round ran the bookkeeping and `acknowledge` at `NORMAL`. Moving them to FULL costs one synced commit per
  intake observation, about 7-8 ms of loop time each on this host (below).
- **An outcome's first publication is recorded at most once, after that commit.** A process killed before the commit
  never recorded it, and the run that sends it again does. A kill right after the commit and before the record leaves
  it out, as on the base. An acknowledgment that lands after the outcome went out and before its batch's commit records
  the publication itself, since the row is gone and no later send will.
- **An outcome already marked needs no write.** A start's republish of outcomes the core has not acknowledged wrote one
  commit per outcome before; it now writes nothing.
- **WAL mode at `synchronous = FULL` for every module database.** Each commit appends to the log and syncs it once, and
  stays durable when it returns ([SQLite, `PRAGMA synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)).
  On this host a synced commit took about a third as long as a rollback-journal commit (below). Pixoo's own stores
  already use WAL at FULL. SQLite creates the log with the file's mode, and a clean stop checkpoints and removes it.
- **Exclusive locking for every module database.** The SDK's `openModuleDatabaseFile` sets `locking_mode = EXCLUSIVE`
  before anything reads the file, so SQLite keeps the WAL index in memory and never creates a `-shm` file
  ([SQLite, WAL without shared memory](https://www.sqlite.org/wal.html#noshm)). Reopening a WAL database with shared
  locking needs a new `-shm` file, and on a full disk that open failed with `disk I/O error`, so the core failed into a
  restart loop, against `bunny-runtime`'s "A full disk SHALL never fail the core". With exclusive locking the open needs
  no new space. The module holds the file's lock until it stops, so another connection is refused with `SQLITE_BUSY`.
  That lock is a POSIX lock, which closing any descriptor of the file in the same process drops, so the runtime never
  opens an existing module file outside SQLite: it checks the file with `lstat` and creates a missing one with
  `O_EXCL`. Before, the opener's own check opened and closed the file, so a refused second open in the same process
  freed the file for another process to write beside the live connection.
  No supported reader needs shared access: AGENTS.md rules out concurrent access to a component's SQLite file, and
  #935's backups copy stopped stores. A second runtime on the same state directory now fails its core when it opens
  the core's database, at once, instead of at agent-state's 3 s lease deadline; the lease still orders owners that
  reach it. A database first created on a full disk cannot take WAL mode, whose header it cannot write: it keeps the
  rollback journal, at the same level, until it is opened again with room. Rejected: mapping the open failure to
  `unavailable`, which needs a reopen path in the runtime's `database()` and the core, and still fails every other
  module's start on a full disk.
- **The core's start on a full disk.** A first start on a full disk cannot create the store's tables. The store names
  that failure `full`, so the core runs and refuses intake with `capacity`, as it already did for a full disk at a
  later start. An observation or a sync that finds the store unopened opens agent-state's owner first, on the usual
  backoff, or is refused: intake with the owner's code and syncs with `unavailable`.
- **The module test kit opens module databases as the runtime does.** Both call `openModuleDatabaseFile`, so a
  module's tests commit with the runtime's journal, locking and sync level. A test reads or changes a running
  module's rows through `ModuleHarness.moduleDatabase()`, the module's own connection. The LIFX tests' full-disk helper
  leaves WAL for its VACUUM. The playback tests made commits fail by holding the database's write lock from a second
  connection, which exclusive locking rules out; they now set `query_only` on the module's own connection, which
  SQLite refuses as a read-only database, and the module logs that as `internal` at ERROR rather than `unavailable` at
  WARN. The `runtime-playback` scenarios name a database that refuses writes instead of another writer. The Tidbyt,
  Pixoo and Nanoleaf tests that came with #973, #971 and #968 do the same: they read through the module's own
  connection, and refuse writes with `query_only` or, where reads must fail too, with an authorizer that denies every
  statement. The `runtime-tidbyt` and `nanoleaf-module` scenarios that named another connection now name a database
  that refuses writes; a second Tidbyt instance on the same state directory is now refused at the module's database,
  before its lease. A test takes the lease before the module starts, so the module's refused-lease path, a `busy`
  startup warning, an `unavailable` record and no cloud call, keeps its own test and scenario. The Tidbyt store
  refusal now logs `internal` at ERROR, and its mapping of a busy or locked database to `unavailable` is gone, since no
  other writer can hold the file. The in-memory
  scenario harness restarts a crashed runtime in the same process; its crash now closes that runtime's module
  databases at once, as a process's end releases them, so the next generation can open them.
- **No `journal_size_limit`.** With one connection, every automatic checkpoint completes, so the log stays within the
  1000-page checkpoint threshold, about 4 MiB, plus the largest transaction. SQLite reuses the log's space after a
  checkpoint, so on a full disk a commit that fits in it still succeeds; a limit would give that space back after each
  checkpoint.
- **The core's write path needs no change.** Each change is already one outbox transaction, so the batching and the
  module database's settings give it one commit for the change and one for its publication. Folding the bookkeeping
  into the next change's transaction would save that commit at the cost of a clean stop's replay above.
- **The full-disk test fixture leaves WAL for its VACUUM.** It shrinks the page size so a session's rows need new pages,
  and a database in WAL mode keeps its page size through a VACUUM.
- **The probe wraps `node:sqlite` in its own process.** `apps/runtime/scripts/measure-commits.mjs` counts a `COMMIT`, or
  a write outside a transaction that changed a row, on module databases, and sums every SQLite call's time. A commit is
  synced when it waits for the disk at its level or ran a WAL checkpoint, which it tells by the database file's
  modification time; the probe reports synced and unsynced commit times apart, and checkpoints with their own times.
  It drives the shipped core with hooks' observations, the shipped LIFX module on its simulated bulbs, and the outbox
  alone. The A/B runs swap the compiled outbox and module-database opener between rounds, so each variant sees the
  same disk. The blocked time covers SQLite calls only: serializing and cloning the core's state payload outside SQLite
  took a further 15-20% of a burst's drain time in the performance review.

## Measurements

Host: WSL 2 (kernel 6.6.87.2), Ryzen 9 7950X, Node 24.21.0, ext4 on a shared disk with other agents' work running, so
times vary between runs; commit counts do not. Each cell is the range over three interleaved rounds of
`measure-commits.mjs --runs 1`, rotating the order of the variants.

The variants: base `ff4677f3`; the first round `121f242a`, with the bookkeeping and `acknowledge` at `NORMAL` and
shared locking; and this head, with every commit at FULL and exclusive locking. Each run is a cold start: a new state
directory and 30 s of load, or 20 commands. A synced commit waits for the disk.

| Path | Measure | Base | First round | Head |
| --- | --- | --- | --- | --- |
| Core intake, 20 observations a second for 30 s | Commits per observation (synced) | 2.75 (2.75) | 2 (1) | 2 (2) |
| | Loop blocked in SQLite per observation | 65-83 ms | 10-11 ms | 17-19 ms |
| | Loop blocked per minute | 56-57 s | 12-13 s | 20-22 s |
| | Event-loop delay p99 | 125-139 ms | 14-15 ms | 24-26 ms |
| | Time to take 600 observations | 42-53 s (fell behind) | 30.5 s (kept pace) | 30.5 s (kept pace) |
| | WAL checkpoints per minute, longest | none | 51, 36-47 ms | 51, 37-43 ms |
| LIFX power-set on simulated bulbs, 20 commands | Commits per command (synced) | 6 (6) | 5 (3) | 5 (5) |
| | Loop blocked per command | 133-213 ms | 22-30 ms | 29-51 ms |
| | Reply p50 | 69-98 ms | 15-19 ms | 18-33 ms |
| | Outcome p50 | 130-217 ms | 22-28 ms | 30-54 ms |
| Outbox alone: pending state, then state, outcome and pending count, acknowledged | Commits per command (synced) | 6 (6) | 5 (2) | 5 (5) |
| | Loop blocked per command | 134-231 ms | 16-23 ms | 35-49 ms |
| All paths | Synced commit p50 | 19-34 ms | 6-11 ms | 5-10 ms |
| | Synced commit p90 | 31-53 ms | 12-17 ms | 8-16 ms |

The base fell behind the load, so its per-minute rates cover fewer observations; per observation it blocked the loop
for 65-83 ms against a 50 ms interval. A synced commit is about three times faster in WAL mode than in the rollback
journal; the first round's unsynced commits took under 0.1 ms. Earlier four-variant runs on the first round attributed
the gain, per intake observation: batching alone 2 commits and 49-66 ms blocked, WAL alone 2.75 commits and 28-29 ms.
The event-loop delay percentiles are meaningful for the intake only. The LIFX and outbox scenarios drive their commands
back to back as one chain of promises, so the delay monitor sees the whole loop as one stall: its maximum was
2.7-4.7 s on the base and 0.7-1.1 s on the head for 20 commands. Pixoo's 104-161 commits for 20 commands are not
measured here: the Pixoo module is not on main yet.

## Risks / Trade-offs

- [A crash between the sends and the bookkeeping commit resends the whole batch] → In process the window is one turn of
  the loop, and the kill test shows the core taking each message once. A subscriber that does not drop duplicates may
  hear the batch twice, as it could hear one message twice before.
- [WAL checkpoint stalls] → A checkpoint copies the log into the file and syncs both on the event loop, in the commit
  that crosses the 1000-page threshold. The table's cold-start runs show about 51 a minute of up to 47 ms. In the
  performance review's 10-minute run at 20 observations a second, checkpoints of 30-160 ms rose from 84 to 300 a minute
  and the delay p99 from 22 to 85 ms, because each core commit rewrites agent-state's whole state payload, which grows
  with its 24-hour journal. That cost predates this change; #976 watches it (below), and the steady-state figures go on
  #123.
- [Every commit syncs] → The bookkeeping costs one synced commit per batch, 7-8 ms of loop time per intake observation
  on this host, in exchange for no resend after a power loss.
- [A running module's database cannot be opened by anything else] → Tools and copies work on a stopped store; a second
  runtime fails at once. The README says so.
- [WAL adds a `-wal` file beside each module database] → It has the file's mode, and a clean stop checkpoints and
  removes it. After a crash it may hold commits the file lacks, so every copy follows the rule under hand-offs.
- [Modules keep commits of their own outside the outbox] → The probe's per-database numbers show them.

## Hand-offs and follow-ups

- **Copying a store.** Copy a stopped store with its `-wal` file, or use SQLite's backup API; the file alone can lose
  commits that a crash left in the log. This binds the cutover's migration
  ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)), backup and recovery
  ([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)), the Mac mini move of a stopped copy
  ([#568](https://github.com/jimmie-potts/agent-device-hub/issues/568)), and
  [#931](https://github.com/jimmie-potts/agent-device-hub/issues/931) and
  [#933](https://github.com/jimmie-potts/agent-device-hub/issues/933) if they build a database file and move it into
  place.
- **The core's save cost.** [#976](https://github.com/jimmie-potts/agent-device-hub/issues/976) is a cheap warning
  plus one post-cutover reading, with row storage and yielding deferred behind its trigger. It covers each core commit
  rewriting agent-state's whole payload, which drives the checkpoint rate above, and the core draining an intake
  backlog without yielding.
- **New modules.** A module test that opens its module's file while the module runs must use `moduleDatabase()`,
  and a full-disk VACUUM must leave WAL first. The Tidbyt, Pixoo and Nanoleaf tests follow this since the rebase.

## Context

The runtime is one Node process: every module, the core and the SDK edge that agent hooks reach share one event loop.
`node:sqlite` is synchronous, so each commit at `synchronous = FULL` blocks that loop for a sync to disk. Module
databases were in SQLite's default rollback journal mode, which syncs the journal and then the file on every commit.

The outbox stored a transaction's messages in that transaction's one commit, which is right, and then marked or deleted
each published row in a commit of its own. The core already commits each change, with its records, history and intake,
in one outbox transaction, so its extra commits were the per-message bookkeeping.

ADR 0012's rules bound the change: committed is not published, a crash never loses an outcome, the core drops
duplicates by `(source, id)`, an `accepted` reply means the owner stored what it needs to report the outcome, and
nothing resends a command.

## Goals / Non-Goals

**Goals:**
- Fewer commits per command and per published batch, and less loop time per commit, with the outbox's guarantees
  unchanged.
- Kill tests at both crash points of the publication, each with a negative control.
- A recorded decision on `synchronous`, and before and after numbers for #123 from a repeatable probe.

**Non-Goals:**
- A module's own commits outside the outbox, such as LIFX's write that marks a command started. Each module's story
  owns them; PR #971 combines Pixoo's.
- Batching several observations into one core transaction. agent-state's owner commits each `ingest` and the core
  replies after it, so that would change agent-state's API and the core's one-at-a-time queue.
- The module test kit's harness database, which stays in rollback journal mode.

## Decisions

- **One bookkeeping commit per publication batch, after the sends settle.** A batch is what one send takes: the rows
  waiting when it starts. It sends them in order, and then one transaction deletes the states, removals and occurrences
  that went out and marks the outcomes. A refusal stops the send, and the commit still covers what went out before it.
  Transactions that commit while a send is under way chain behind it, and the first send takes their rows too, so they
  share one bookkeeping commit. Rejected: committing the bookkeeping before the sends, which would lose every message of
  a process killed between that commit and the send, as the kill test shows, and deferring it into the next
  transaction, which leaves no commit for the last batch before a clean stop, so a clean restart would replay states and
  occurrences.
- **A crash between the sends and that commit sends the batch again.** That window existed for one message before; it
  now covers the batch. The messages go out again with their stored `id`, `time` and trace context, and consumers drop
  them by `(source, id)`, as the core does for outcomes. In process, a batch's sends and its commit run in one turn of
  the loop, so the window is that turn; for a remote part, whose sends are HTTP calls, it spans them.
- **An outcome's first publication is recorded after that commit.** A process killed before the commit never recorded
  it, and the run that sends it again does, so `outcome.published` stays once per outcome across a crash.
- **An outcome already marked needs no write.** A start's republish of outcomes the core has not acknowledged wrote one
  commit per outcome before; it now writes nothing.
- **`synchronous = NORMAL` for the work is rejected.** In WAL mode it skips the sync at commit, so a power loss, a
  kernel crash or a stopped WSL VM (`wsl --shutdown`, a Windows restart) can undo a commit that already returned. That
  would lose an outcome after the device acted, or the record of a command already answered `accepted`, which ADR 0012
  rules out. A process crash alone loses nothing in either mode.
- **WAL mode at `synchronous = FULL` for every module database.** Each commit appends to the log and syncs it once, and
  stays durable when it returns ([SQLite, `PRAGMA synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous)).
  On this host a synced commit took a quarter to a half as long as a rollback-journal commit (below). Pixoo's own
  stores already use WAL at FULL. SQLite creates the log and its index with the file's mode, and a clean stop
  checkpoints and removes the log. A copy of the file alone may miss commits still in the log, so a copy, such as the
  cutover's ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)), takes the `-wal` file too or uses
  SQLite's backup.
- **Bookkeeping and acknowledgments at `NORMAL` in WAL mode.** They only forget or mark rows the work stored. In WAL mode
  a commit at `NORMAL` is consistent and may roll back after a power loss
  ([SQLite, WAL](https://www.sqlite.org/wal.html)); the log is append-only, so the next commit at FULL, or a checkpoint,
  syncs it with everything before it. A lost bookkeeping commit leaves its rows to go out again, and a lost
  acknowledgment leaves its outcome to go out at the next start, which the core acknowledges again: neither loses a
  message. The outbox sets `NORMAL` only for its own statement or transaction, and restores the connection's level in the
  same synchronous call, so no other commit runs at it. In rollback journal mode `NORMAL` still syncs, only less, and a
  power loss at the wrong moment can corrupt the file; inside someone else's open transaction the level cannot apply to
  the outbox's rows alone. The outbox leaves the level as it is in both.
- **The core needs no code change.** Each change is already one outbox transaction, so the batching and the module
  database's settings give it one commit at FULL and one at `NORMAL` per change. Folding the bookkeeping into the next
  change's transaction would save only that unsynced commit, at the cost of a clean stop's replay above.
- **The full-disk test fixture leaves WAL for its VACUUM.** It shrinks the page size so a session's rows need new pages,
  and a database in WAL mode keeps its page size through a VACUUM.
- **The probe wraps `node:sqlite` in its own process.** `apps/runtime/scripts/measure-commits.mjs` counts a `COMMIT`, or
  a write outside a transaction that changed a row, on module databases, and sums every SQLite call's time. It drives the
  shipped core with hooks' observations, the shipped LIFX module on its simulated bulbs, and the outbox alone. The A/B
  runs swap the compiled outbox and module-database opener between rounds, so each variant sees the same disk.

## Measurements

Host: WSL 2 (kernel 6.6.87.2), Ryzen 9 7950X, Node 24.21.0, ext4 on a shared disk with other agents' work running, so
times vary between runs; commit counts do not. Each cell is the range over three interleaved rounds.

Base is `df7854b7`; head is this change. `measure-commits.mjs --runs 1`, three interleaved rounds of base and head on the
same disk (`ab-final`). A synced commit waits for the disk.

| Path | Measure | Base | Head |
| --- | --- | --- | --- |
| Core intake, 20 observations a second for 30 s | Commits per observation (synced) | 2.75 (2.75) | 2 (1) |
| | Loop blocked in SQLite per observation | 71-124 ms | 8-12 ms |
| | Loop blocked per minute | 57-58 s | 10-15 s |
| | Event-loop delay p99 | 121-198 ms | 12-17 ms |
| | Time to take 600 observations | 45-77 s (fell behind) | 30.5 s (kept pace) |
| LIFX power-set on simulated bulbs, 20 commands | Commits per command (synced) | 6 (6) | 5 (3) |
| | Loop blocked per command | 147-229 ms | 21-30 ms |
| | Reply p50 | 68-117 ms | 13-20 ms |
| | Outcome p50 | 138-240 ms | 22-31 ms |
| Outbox alone: pending state, then state, outcome and pending count, acknowledged | Commits per command (synced) | 6 (6) | 5 (2) |
| | Loop blocked per command | 131-279 ms | 14-19 ms |
| All paths | Synced commit p50 | 19-45 ms | 5-6 ms |

The base fell behind the load, so its per-minute rates cover fewer observations; per observation it blocked the loop
for 71-124 ms against a 50 ms interval. Each part's share, from four interleaved variants (`ab`), per observation of
the intake: batching alone 2 commits and 49-66 ms blocked; WAL alone 2.75 commits and 28-29 ms; both with the
bookkeeping at `NORMAL`, 2 commits (1 synced) and 9-12 ms. The event-loop delay is meaningful for the intake only: the
LIFX and outbox scenarios run each command as one chain of promises, which the delay monitor does not sample. Pixoo's
104-161 commits for 20 commands are not measured here: the Pixoo module is not on main yet.

## Risks / Trade-offs

- [A crash between the sends and the bookkeeping commit resends the whole batch] → Consumers drop by `(source, id)`; in
  process the window is the commit, and the kill test shows each message taken once.
- [WAL adds `-wal` and `-shm` files beside each module database] → They have the file's mode, a clean stop removes the
  log, and the README says how to copy a database; #840's migration needs to copy them or use SQLite's backup.
- [Bookkeeping at `NORMAL` relies on SQLite's WAL semantics] → The tests check the level of every commit; a lost
  bookkeeping commit is the same case as the kill test.
- [The harness keeps rollback journal mode] → Module tests run every commit at FULL, which is the stricter case; the
  SDK and runtime tests cover WAL.
- [Modules keep commits of their own outside the outbox] → The probe's per-database numbers show them for each module's
  story.

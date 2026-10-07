## Why

Every SQLite commit at `synchronous = FULL` is a sync to disk on the runtime's one event loop, which agent hooks share
with a p95 budget of 250 ms. The SDK outbox marks or deletes each published row in its own commit, so a command that
publishes a state, an outcome and a pending count pays four commits where two would do, and the core pays one commit
per published message on top of each change. PR #971's performance review measured 10.6 ms a commit at p50 and 31 to
38 s of blocked loop a minute under 20 session changes a second. [Hub #972](https://github.com/jimmie-potts/agent-device-hub/issues/972)
cuts those commits on the shared SDK path and the core's write path without changing what
[ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) guarantees: committed is not published, and a crash never
loses an outcome or makes a consumer take one twice.

## What Changes

- **One bookkeeping commit per publication batch.** Once a send's messages settle, the outbox forgets the states,
  removals and occurrences that went out and marks the outcomes in one transaction, after the sends, refused or not.
  Transactions that commit before a queued send starts share it. Republishing outcomes that already went out writes
  nothing. An outcome's first publication is recorded at most once, once that commit lands, or by an acknowledgment
  that lands before it.
- **Every commit at the module's level.** The bookkeeping commit and `acknowledge` run at the connection's
  `synchronous` level, like the work's own commit. `NORMAL` is rejected for all of them: a power loss could undo a
  committed outcome or an accepted command, or undo a bookkeeping commit and send states and occurrences again, which
  ADR 0012 rules out and the in-process bus does not filter.
- **Module databases with exclusive locking, in WAL mode at `synchronous = FULL`.** The SDK's new
  `openModuleDatabaseFile` opens each module's file, for the runtime and for the module test kit alike. Each commit
  stays durable when it returns, with one sync of the log instead of a rollback journal's syncs. Exclusive locking
  keeps the log's index in memory, so no `-shm` file is ever created and opening a database needs no new space.
- **A full disk at the start never fails the core.** Started for the first time on a full disk, or again after a clean
  stop, the core runs, refuses intake with `capacity` and syncs with `unavailable`, and takes work once there is room.
- **A repeatable probe.** `apps/runtime/scripts/measure-commits.mjs` counts commits, blocked time and event-loop delay
  for the core's intake at 20 observations a second, a LIFX command on simulated bulbs and the outbox alone, for #123.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: the per-module outbox's bookkeeping commits once per publication batch at the connection's level, a
  failed bookkeeping commit is reported as a deferral, and an outcome's first publication is recorded at most once,
  after that commit or by an acknowledgment that lands before it.
- `bunny-runtime`: a module's own SQLite file has exclusive locking and is in WAL mode at `synchronous = FULL`; the
  core store commits each change once and its publication bookkeeping once, and a full disk at a first start or a
  restart leaves the core running.
- `runtime-playback`: the database-refusal scenarios name a database that refuses writes, since the module keeps its
  file to itself and no other writer can hold it.

## Impact

- **Code:** `packages/sdk/src/outbox.ts`, `packages/sdk/src/database.ts` (new), the kit's harness and commit counter,
  and `apps/runtime/src/state.ts`. The core's write path needs no change: it already commits each change in one outbox
  transaction. Two small core changes serve the full-disk start: the store names a first start's failure to create its
  tables `full`, and an observation or sync that finds the store unopened opens the owner first or is refused.
- **Tests:** the SDK's outbox tests with a crash fixture that kills a module process with SIGKILL; the runtime's
  context and core store tests, a store test world that opens its file as the runtime does, and a real-ENOSPC test of
  the core's start on a small tmpfs in a user namespace; the LIFX and playback module tests, which now read their
  module's rows through its own connection and leave WAL for a full-disk VACUUM; and the in-memory scenario harness,
  whose simulated crash now closes the crashed runtime's module databases at once, as a process's end would.
- **Docs:** the SDK and runtime READMEs and `docs/development.md`.
- **Shared users:** the LIFX and playback modules on main, and the Nanoleaf and Pixoo modules in review, use the outbox
  and the kit through the SDK; a test of theirs that opens the module's file while the module runs must use
  `moduleDatabase()`. Their own commits are theirs to batch.
- **Unchanged:** `packages/sdk/src/module.ts`, agent-state, released 1.x contracts and the message formats.
- **Delivery:** source-only. The change has no observable behavior for an Acceptance review: nothing a person or a
  device notices changes. Its effects are commit timing, the module databases' `-wal` files and the core's start on a
  full disk, which the tests and the specialist reviews check.

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
  Transactions that commit while a send is under way share it. Republishing outcomes that already went out writes
  nothing. An outcome's first publication is recorded once that commit lands.
- **Bookkeeping without its own sync in WAL mode.** In WAL mode the bookkeeping commit and `acknowledge` run at
  `synchronous = NORMAL`, and the connection's level comes back at once. A power loss can only undo them, which leaves
  the rows to go out again with the same `id`; the work's own commit keeps the module's level.
- **Module databases in WAL mode at `synchronous = FULL`.** The runtime opens each module's file in WAL mode. Each
  commit stays durable when it returns, with one sync of the log instead of a rollback journal's syncs. `NORMAL` for the
  work is rejected: a power loss or a stopped WSL VM could then undo a committed outcome or an accepted command.
- **A repeatable probe.** `apps/runtime/scripts/measure-commits.mjs` counts commits, blocked time and event-loop delay
  for the core's intake at 20 observations a second, a LIFX command on simulated bulbs and the outbox alone, for #123.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: the per-module outbox's bookkeeping commits once per publication batch, in WAL mode without its own
  sync, and an outcome's first publication is recorded after that commit.
- `bunny-runtime`: a module's own SQLite file is in WAL mode at `synchronous = FULL`, and the core store commits each
  change once and its publication bookkeeping once.

## Impact

- **Code:** `packages/sdk/src/outbox.ts` and `apps/runtime/src/state.ts`. The core (`apps/runtime/src/core/*`) needs no
  code change: it already commits each change in one outbox transaction, and its publication goes through the outbox.
- **Tests:** the SDK's outbox tests with a new crash fixture that kills a module process with SIGKILL; the runtime's
  context and core store tests, a commit-counting fixture, a WAL option and a hang-after-send mode for the store's test
  world, and the full-disk fixture, which leaves WAL for its VACUUM.
- **Docs:** the SDK and runtime READMEs.
- **Shared users:** the LIFX and playback modules on main, and the Nanoleaf and Pixoo modules in review, use the outbox
  through the SDK; their own commits are theirs to batch.
- **Unchanged:** `packages/sdk/src/module.ts`, the module test kit's harness, which keeps its rollback-journal
  database, agent-state, released 1.x contracts and the message formats.
- **Delivery:** source-only. The module databases' journal mode is visible in a disposable run's state directory
  (`<name>.sqlite-wal` and `-shm` while it runs), so the change has observable behavior for an Acceptance review in a
  `verify:runtime` run.

## 1. Measure first

- [x] 1.1 Add `apps/runtime/scripts/measure-commits.mjs` and record the base revision's commits per observation and per command, blocked time and event-loop delay under 20 observations a second.

## 2. One bookkeeping commit per publication batch

- [x] 2.1 Assert, red against the old outbox, that a batch's bookkeeping commits once after its sends, that transactions committing before a queued send starts share it, that a republish of published outcomes writes nothing, and that a send refused partway commits what went out before it and records its publication (`packages/sdk/tests/outbox.test.ts`).
- [x] 2.2 Add a module process fixture that SIGKILLs itself after its sends and before their bookkeeping, and between its commit and its first send, and assert that the next starts send each message so a consumer that drops duplicates takes it once, the second only the outcome, with one `outcome.published` record (`packages/sdk/tests/fixtures/outbox-crash.ts`).
- [x] 2.3 Commit each batch's bookkeeping once after the sends settle, skip outcomes already marked, and record a first publication after that commit.

## 3. `synchronous` and WAL

- [x] 3.1 Assert, red against the old code, that module databases open with exclusive locking in WAL mode at `synchronous = FULL` with a private `-wal` file and no `-shm` file (`apps/runtime/tests/context.test.ts`), and that the work, the bookkeeping and acknowledgments all commit at FULL.
- [x] 3.2 Open module databases with `openModuleDatabaseFile`, in the runtime and the module test kit alike, and run every outbox commit at the connection's level.
- [x] 3.3 Record the `synchronous` decision and its reason in `design.md`.

## 4. The core's write path

- [x] 4.1 Assert, red against the old outbox, that an observation commits its change once and what it published once more, both at FULL, and that a crash after the sends and before their bookkeeping sends the change again exactly as first sent (`apps/runtime/tests/core-store.test.ts`).
- [x] 4.2 Keep the full-disk fixture's small pages under WAL by leaving WAL for its VACUUM.

## 5. Qualification

- [x] 5.1 Show negative controls fail named tests: per-row bookkeeping commits, bookkeeping committed before the sends, the first publication recorded before the bookkeeping commit, the rollback journal for module databases, already-published outcomes written again, and the fix round's controls in 6.6.
- [x] 5.2 Record the after measurements, interleaved with the base, in `design.md` for #123.
- [x] 5.3 Run build, typecheck, lint, the SDK, runtime, scenario, verification, event, maintenance, LIFX module, playback and workflow checks, and OpenSpec validation.
- [x] 5.4 Update the SDK and runtime READMEs, synchronize the affected specifications and archive the change.

## 6. Fix round 1

- [x] 6.1 Run every bookkeeping commit and `acknowledge` at the connection's level, and drop `NORMAL`, so a power loss never resends a state or occurrence; measure again.
- [x] 6.2 Open module databases with exclusive locking, and prove with a real-ENOSPC test on a small tmpfs in a user namespace that a first start and a restart after a clean stop on a full disk leave the core running (`apps/runtime/tests/full-disk.test.ts`).
- [x] 6.3 Test a transaction that commits during a send, a failed bookkeeping commit and an acknowledgment that lands before the bookkeeping, in process and across a kill.
- [x] 6.4 Open the kit's module databases as the runtime does, move the LIFX and playback tests to the module's own connection, and close a crashed generation's module databases at once in the in-memory scenario harness.
- [x] 6.5 Report commit times per sync level and checkpoints in the probe, warm the delay monitor up, and correct the measurements, risks and hand-offs in `design.md`.
- [x] 6.6 Show the fix round's negative controls fail named tests.

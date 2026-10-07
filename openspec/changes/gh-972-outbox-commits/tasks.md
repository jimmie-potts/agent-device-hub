## 1. Measure first

- [x] 1.1 Add `apps/runtime/scripts/measure-commits.mjs` and record the base revision's commits per observation and per command, blocked time and event-loop delay under 20 observations a second.

## 2. One bookkeeping commit per publication batch

- [x] 2.1 Assert, red against the old outbox, that a batch's bookkeeping commits once after its sends, that transactions committing during a send share it, that a republish of published outcomes writes nothing, and that a send refused partway commits what went out before it and records its publication (`packages/sdk/tests/outbox.test.ts`).
- [x] 2.2 Add a module process fixture that SIGKILLs itself after its sends and before their bookkeeping, and between its commit and its first send, and assert that the next starts send each message so a consumer that drops duplicates takes it once, the second only the outcome, with one `outcome.published` record (`packages/sdk/tests/fixtures/outbox-crash.ts`).
- [x] 2.3 Commit each batch's bookkeeping once after the sends settle, skip outcomes already marked, and record a first publication after that commit.

## 3. `synchronous` and WAL

- [x] 3.1 Assert, red against the old code, that module databases open in WAL mode at `synchronous = FULL` with private `-wal` and `-shm` files (`apps/runtime/tests/context.test.ts`), and that in WAL mode the work commits at FULL and the bookkeeping and acknowledgments at NORMAL, with every commit at FULL out of WAL mode.
- [x] 3.2 Open module databases in WAL mode at FULL, and run the outbox's bookkeeping and `acknowledge` at NORMAL in WAL mode only, restoring the connection's level at once.
- [x] 3.3 Record the `synchronous` decision and its reason in `design.md`.

## 4. The core's write path

- [x] 4.1 Assert, red against the old outbox, that an observation commits its change once and what it published once more, at FULL and then NORMAL in WAL mode, and that a crash after the sends and before their bookkeeping sends the change again exactly as first sent (`apps/runtime/tests/core-store.test.ts`).
- [x] 4.2 Keep the full-disk fixture's small pages under WAL by leaving WAL for its VACUUM.

## 5. Qualification

- [x] 5.1 Show negative controls fail named tests: per-row bookkeeping commits, bookkeeping committed before the sends, `NORMAL` left on after the bookkeeping, `NORMAL` for the work, `NORMAL` outside WAL mode, the first publication recorded before the bookkeeping commit, and the rollback journal for module databases.
- [x] 5.2 Record the after measurements, interleaved with the base, in `design.md` for #123.
- [x] 5.3 Run build, typecheck, lint, the SDK, runtime, scenario, verification, event, maintenance, LIFX module, playback and workflow checks, and OpenSpec validation.
- [x] 5.4 Update the SDK and runtime READMEs, synchronize the affected specifications and archive the change.

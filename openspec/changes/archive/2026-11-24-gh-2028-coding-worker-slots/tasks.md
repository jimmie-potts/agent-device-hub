## 1. Contracts

- [x] 1.1 Red: `coding.test.mjs` cases for `coding-endpoint/2.2` slots, `coding-work/2.1` companion and `coding-state/2.2` runs and waiting. Evidence: with the three registrations removed, 3 of 11 tests fail; with the payload checks replaced, 2 fail (PR).
- [x] 1.2 Schemas, types, payload checks and fixtures; `families.test.mjs` version list. Evidence: the event-contract tests pass.

## 2. Coordinator and module

- [x] 2.1 Red: coordinator tests for three companions at once, the connection-only binding, cancel of a waiting hand-off, per-run timeout and loss, restart with a waiting and a sending hand-off, a refused waiting dispatch, an older worker and the 2.2 state. Evidence: negative controls fail the matching tests (PR).
- [x] 2.2 `coordinator.ts` and `store.ts`: runs by operation, a reservation per slot, the durable waiting line, `handOff`, the drain, per-run settlement and `coding-state/2.2`. Evidence: `coding-coordinator.test.js` passes 16 of 16.
- [x] 2.3 Engine and module: the delegate seam returns `waiting`, the proposal binds to the worker connection and is offered while the slot is busy, and a run is tagged with its task's companion. Evidence: `coding-slots.test.js` and the waiting title test pass.

## 3. Worker

- [x] 3.1 Three slots, one per companion, the 2.2 declaration, per-run cancel, a lost endpoint freeing every slot, reports only on the starting endpoint and serialized git setup per repository. Evidence: `coding-worker.test.js` passes; negative controls fail (PR).

## 4. Page

- [x] 4.1 Worker slots, the companion's slot, plan usage, the busy approval note and the waiting card. Evidence: `coding-status.test.js` and the `coding-slots` browser journey pass.

## 5. Documentation and archive

- [x] 5.1 docs/coding-worker.md, the companions and event-contracts READMEs, docs/development.md and apps/runtime/UPGRADE.md. Evidence: readback.
- [x] 5.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.

## 6. Review round 1 on PR 2087

- [x] 6.1 A tool that starts after its run was stopped is killed as it appears; stopped runs keep their slots until they end, and the worker declares its next endpoint only then. Evidence: the new worker test fails with the kill removed and with the slots cleared on close (PR).
- [x] 6.2 A waiting hand-off is sent only while its task still waits on it. Evidence: the coordinator restart test and the module test with a missed cancel fail without the check (PR).
- [x] 6.3 An older core refuses `coding-endpoint/2.2` as `unsupported-version`; the rollback note covers rows caught mid-dispatch. Evidence: readback.
- [x] 6.4 Unused `known()` and `busy` removed. Evidence: build and lint.
- [x] 6.5 Tests for the per-repository git setup order and for a cancel while a waiting hand-off's dispatch is on its way. Evidence: each fails with its code removed (PR).
- [x] 6.6 A waiting hand-off reads "Waiting to delegate" until it is sent, then "Delegated". Evidence: `coding-slots.test.js` and the browser journey; the module test fails without it.
- [x] 6.7 A lost answer after the module accepted a waiting hand-off's run keeps the run. Evidence: the coordinator test fails without the check.
- [x] 6.8 The coordinator's deadline after a start adds the worker's queued git setup bound. Evidence: the timeout test fails without it.

## 7. Review round 2 on PR 2087

- [x] 7.1 The worker waits for stopped runs at most fifteen seconds before it declares again; a run still alive keeps only its companion's slot busy. Evidence: the new worker test fails when the bound never fires (PR).
- [x] 7.2 `stop()` waits for stopped runs within the same bound, so a test never removes a repository under a running git step. Evidence: the test asserts no git command runs after `stop()` and fails without the wait; 12 repeated runs, three at a time, pass.
- [x] 7.3 A waiting hand-off whose task cannot be read keeps its place. Evidence: the new coordinator test fails when the row is dropped (PR).
- [x] 7.4 The 34-minute bound for a connected but silent worker is stated in docs/coding-worker.md and apps/runtime/UPGRADE.md. Evidence: readback.
- [x] 7.5 A waiting hand-off sent before its line is saved reads "Delegated to" at once. Evidence: the new `coding-slots` test fails without the check (PR).

## 8. Review round 3 on PR 2087

- [x] 8.1 A slot whose oldest waiting hand-off cannot be checked sends nothing else that pass, so its line keeps first in, first out. Evidence: the new coordinator test fails when only that row is skipped (PR).
- [x] 8.2 A coordinator test covers `accepted()` for an active run and a recorded one. Evidence: it fails with `accepted()` forced false (PR).
- [x] 8.3 docs/coding-worker.md says a companion whose stopped run outlives the bound has its next hand-off fail with `capacity` rather than wait. Evidence: readback.

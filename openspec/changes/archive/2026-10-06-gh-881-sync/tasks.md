## 1. Tests first

- [x] 1.1 Write the sync and overflow-signal tests in `packages/sdk/tests/sync.test.ts` and `tests/overflow.test.ts` against stub `sync`, `serveSync` and `onOverflow`, with every participant wrapped by `checked`. All 16 new tests fail and the 31 existing tests pass.

## 2. Overflow signal

- [x] 2.1 Count each subscription's dropped messages and call `onOverflow({dropped})` in its queue before the next delivery (`src/in-process.ts`). Both overflow tests pass, and `onError` still receives each `capacity` report. With the call disabled, seven tests fail: both overflow tests and five sync tests that rely on the restart.

## 3. Sync

- [x] 3.1 Add the transport-neutral consumer (`src/sync.ts`): subscribe first, buffer live messages, take the snapshot, replace membership and apply buffered messages above the revision in one step, then tell the handler. Restart on overflow, and drop duplicates and stale revisions.
- [x] 3.2 Add the in-process owner side (`src/in-process-sync.ts`): one owner per family, answers straight to the requester, the refusal codes, deadlines and expiry. All SDK tests pass.
- [x] 3.3 Add Hub #842's final scenario, a removal during a sync followed by a late state. It passes, and dropping the tombstone check fails it and the stale-revision test.
- [x] 3.4 Run the negative controls, each restored afterwards:
  - skipping the buffered messages after a sync fails three tests (buffered apply, the a@5/y@15 probe and the removal during a sync);
  - dropping an overflowing message without a restart fails the buffer overflow test;
  - keeping non-members fails the membership test;
  - serving an empty snapshot instead of the owner's refusal fails the refusal test;
  - never calling `onOverflow` fails the seven tests in 2.1.

## 4. Docs and validation

- [x] 4.1 Document sync, `serveSync` and `onOverflow` in `packages/sdk/README.md`, and note sync in `docs/development.md` and `docs/architecture.md`.
- [x] 4.2 Validate this change with `--strict`, then sync and archive it. `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:sdk:built` three times (48 tests), `npm run test:events:built`, `npm run test:workflow`, `npm run check:workflow` and `npm run openspec -- validate --specs --strict` all exit zero.

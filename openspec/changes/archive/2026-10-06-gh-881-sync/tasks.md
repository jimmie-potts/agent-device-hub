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

## 5. Review fixes (PR #894)

- [x] 5.1 Write the review tests first: a stalled handler, a second consumer, a copy's own requests against a one-request owner queue, a first sync that keeps overflowing, a transport that rejects, a message without an entity and an owner of 38 families. Seven fail before the fix. Further tests pin existing branches: a refused copy staying stopped, the live buffer bound, the membership revision guard, closing during a change, the joined-families cap, the 4096-state cap, the ID pattern and the higher tombstone.
- [x] 5.2 Keep one sync request outstanding per copy (`src/sync.ts`). An overflow marks the copy as wanting a sync and raises its generation. The worker sends the request once none is outstanding and the handler has returned, and does not apply an answer from an older generation. The first sync gets `timeoutMs` from its first request, then the time left, then `unavailable`. A rejected transport request is reported and refused with `unavailable`. A message without a string `dataschema` is reported and ignored. Owners are not held to the request caps. All 65 SDK tests pass.
- [x] 5.3 Start the first-sync deadline at the first request, so that request always gets the full `timeoutMs`. Before this, a millisecond tick could shorten it to 4999 ms, which a control run exposed.
- [x] 5.4 Drive all eight #842 fixture scenarios through SDK copies (`tests/scenarios.test.ts`). They pass, and skipping buffered messages fails two of them.
- [x] 5.5 Run a negative control for each new test, each restored afterwards:
  - sending on every overflow fails the stalled-handler, second-consumer and own-queue tests;
  - removing the first-sync bound fails the overflowing first-sync test;
  - removing the generation check fails the buffer-overflow and overflowing first-sync tests;
  - not stopping a refused copy fails both stays-stopped tests;
  - bounding the buffer only during a sync fails the stalled-handler test;
  - dropping the membership revision guard fails the older-snapshot test;
  - telling a closed copy fails the close-during-a-change test;
  - each of the joined-families cap, the 4096-state cap and the ID pattern, when removed, fails its test;
  - lowering a tombstone fails the stale-revision test;
  - a `schemaFamily` that throws fails the missing-entity test;
  - removing the rejection handler fails the transport test;
  - capping owners fails the owner test.
- [x] 5.6 Update the README (`synced`, the `onOverflow` gap position, one outstanding request, the first-sync bound, owner caps), this spec and its synced copy, and design.md (one outstanding request, tombstone growth, and the #880 and #883 deferrals). `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:sdk:built` three times (65 tests), `npm run test:events:built`, `npm run test:workflow`, `npm run check:workflow` and `npm run openspec -- validate --specs --strict` all exit zero.

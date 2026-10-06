## 1. Tests first

- [x] 1.1 Write the bus tests in `packages/sdk/tests/` for patterns, request and reply, the error body, the deadline, expiry, slow subscribers and trace context, against a stub bus; all 25 tests fail.

## 2. Bus

- [x] 2.1 Add routing keys, patterns and the kind-to-key-class rule (`src/routing.ts`, `src/in-process.ts`); `publish.test.ts` passes.
- [x] 2.2 Add per-subscriber bounded queues (`src/queue.ts`); `delivery.test.ts` passes, and with one shared delivery chain instead, four of its tests fail and two time out.
- [x] 2.3 Add request and respond with expiry, the shared error body and `uncertain-result` (`src/in-process.ts`); `request.test.ts` and `expiry.test.ts` pass. Without the deadline timer four tests fail, and without the responder's expiry check two fail.
- [x] 2.4 Add W3C trace propagation (`src/trace.ts`); `trace.test.ts` passes, and when the parent is ignored two tests fail.
- [x] 2.5 Give each SDK test a timeout, so a lost delivery fails the test instead of hanging the run; the shared-chain check above then ends in about 20 seconds.

## 3. Wiring and docs

- [x] 3.1 Add the workspace to `build` and `typecheck`, add `test:sdk` and `test:sdk:built`, and add one core CI step with its `tests/workflow_checks.cjs` entry; `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:workflow`, `npm run check:workflow`, `npm run test:sdk:built` (27 tests) and `npm run test:events:built` all exit zero.
- [x] 3.2 Document the API in `packages/sdk/README.md` and add "SDK checks" to `docs/development.md`.
- [x] 3.3 Validate this change with `--strict`, then sync and archive it; `npm run check:workflow` and `npm run test:workflow` exit zero.

## 4. Review fixes

- [x] 4.1 Run each delivery in an AsyncLocalStorage context, so `close()` called from its own handler resolves at once; the subscriber and responder self-close tests fail without it and pass with it.
- [x] 4.2 Make the default `onError` emit a `BunnySdkWarning` naming the source and pattern, with the original error as its `cause`, and refuse a command type that does not end in `.requested`; both tests fail before the change.
- [x] 4.3 Pin the responder-queue `capacity` result, the `unavailable` trace ID on close, the outcome key class and the cleared deadline timer; rewriting `capacity` as `unavailable` without IDs, dropping that `traceId` or skipping `clearTimeout` each fails one test.
- [x] 4.4 Check every message each test sees against profile 2.0 through the `checked` test wrapper; an invalid reply type fails 12 tests.
- [x] 4.5 Record the accepted decisions here, update the README, this spec and `docs/architecture.md`; `npm run openspec -- validate --specs --strict`, `npm run check:workflow` and `npm run test:workflow` exit zero.

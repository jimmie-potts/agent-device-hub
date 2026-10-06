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

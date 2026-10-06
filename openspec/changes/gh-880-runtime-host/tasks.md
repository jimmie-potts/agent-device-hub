## 1. SDK changes the host needs

- [x] 1.1 Write failing SDK tests for participant close, deadlines on an injected scheduler and `expired` for a command still queued at its deadline or reaching the responder after its expiry, against stubs; 10 tests fail. Add tests that pin the queue's identity and `done` guards and the `maxQueued` `RangeError`; removing either guard fails its own test.
- [x] 1.2 Add `Participant.close`, `BusOptions.scheduler`, `DeliveryQueue.remove` and `expired` (`src/in-process.ts`, `src/queue.ts`, `src/sdk.ts`); all 42 SDK tests pass.
- [x] 1.3 Explain in the README, this spec and the `close()` doc comment that close detection follows the handler's async flow, and that two handlers awaiting each other's close deadlock; fix the capacity wording in the archived #879 proposal.
- [x] 1.4 Negative controls: answering `uncertain` at every deadline fails 1 SDK test; skipping the settling of pending requests in participant close fails 3 SDK tests and 1 runtime test; leaving subscriptions open fails 3 SDK tests and 2 runtime tests; ignoring the injected scheduler fails 3 SDK tests and 1 runtime test.

## 2. Runtime tests first

- [x] 2.1 Add the module API to the SDK (`src/module.ts`), `apps/runtime` stubs under the strict profile, the workspace in `build` and `typecheck`, and `test:runtime` and `test:runtime:built`; all 32 runtime tests fail against the stubs.

## 3. Runtime

- [x] 3.1 Serve health with zero modules and keep state private and outside Git checkouts (`src/runtime.ts`, `src/state.ts`); `health.test.ts` passes.
- [x] 3.2 Check manifests and API versions (`src/host.ts`); `manifest.test.ts` passes. Matching any minor version fails 3 tests, and skipping the version check fails 2.
- [x] 3.3 Build the module context: participant, logger, tracing, clock, scheduler, workers, SQLite and signal (`src/host.ts`, `src/log.ts`, `src/record.ts`, `src/state.ts`); `context.test.ts` passes.
- [x] 3.4 Contain failures: stop a failed module through its participant's close, attribute escaped errors by async context, bound each stop phase (`src/host.ts`); `isolation.test.ts` passes. Not stopping a failed module fails 5 tests, and never attributing an escaped error fails 2.
- [x] 3.5 Add the service process and the event-loop lag check (`src/process.ts`, `src/watchdog.ts`, `src/watchdog-worker.ts`, `src/main.ts`); `process.test.ts` passes. A watchdog that never kills fails the stuck-loop test.
- [x] 3.6 Release blocked responders in hooks registered before a test's runtime stops, so a failed assertion cannot hang the suite.
- [x] 3.7 Measure the zero-module memory after startup settles, for #123: the shipped process at 60 s, from `/proc/<pid>/status` and health's `process.memoryUsage()`.

## 4. Wiring and docs

- [x] 4.1 Add one core CI step, `npm run test:runtime:built`, with its `tests/workflow_checks.cjs` entry; `npm run test:workflow` passes.
- [x] 4.2 Add `apps/runtime/README.md`, "Runtime checks" in `docs/development.md`, the SDK README's Modules section and the architecture note.
- [x] 4.3 Validate this change with `--strict`, then sync and archive it. `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:sdk:built`, `npm run test:runtime:built`, `npm run test:events:built`, `npm run test:workflow`, `npm run check:workflow` and `npm run openspec -- validate --specs --strict` exit zero, each suite twice.

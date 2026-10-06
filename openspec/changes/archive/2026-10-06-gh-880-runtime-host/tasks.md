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

## 5. Review round (PR #899)

- [x] 5.1 Write failing tests for each finding and for the #881 fold-in, against stubs that keep the old behavior: 11 runtime tests and 4 SDK tests fail, and the watchdog's pause decision fails 2 unit tests.
- [x] 5.2 Run a module's whole stop in its own async flow; abort listeners that throw or reject on a handler error, a failed start and the runtime's stop stay with their module, and SIGTERM exits 0. Without it the abort-listener process test fails.
- [x] 5.3 Narrow the context's refusal and `stop()`'s handler wording in `module.ts`, both READMEs, `bunny-runtime` and design.md.
- [x] 5.4 Install the signal handlers before the runtime starts and stop once the starts settle; without it the process dies by SIGTERM and the startup-signal test fails.
- [x] 5.5 Discount the watchdog's own overrun, and detect a watchdog that exits; health shows `lagCheck`. Without the discount 2 lag unit tests fail; without exit detection the lag-check health test fails.
- [x] 5.6 Check the whole state path before creating anything and never create through a link; refuse a dangling link and a file with clear messages; cover `/mnt`. With the old order the link test fails.
- [x] 5.7 Record the error's type and code, never its raw message; check the Host header, Origin and Sec-Fetch-Site; aggregate dropped-delivery warnings per subscription per minute. Without the Host check its test fails.
- [x] 5.8 Fold in #881: participant close covers sync copies, owners and deadlines; a queued sync request leaves the owner's queue at its deadline and stays `unavailable`; `onSyncRestart`; health counts sync restarts; reorder the "even when an overflow comes first" sentence.
- [x] 5.9 Amend ADR 0012 for `expired`, make the two-handler deadlock explicit in `bunny-sdk`, and send a later command in the at-expiry test.
- [x] 5.10 Add `apps/runtime/scripts/measure-memory.mjs` and record the zero-module baseline for #123.
- [x] 5.11 Keep this change's deltas identical to the synced `bunny-runtime` and `bunny-sdk` specs; `npm run openspec -- validate --specs --strict`, `npm run check:workflow` and `npm run test:workflow` exit zero.

## 6. Review round 3 (PR #899)

- [x] 6.1 Write failing tests: 2 SDK tests for a copy closed while it subscribes, and 5 runtime tests for a sync begun in a failed start, rolling drop windows, Host letter case, refusal codes in the process's `runtime.failed` record and a signal while the runtime loads.
- [x] 6.2 Stop a copy's subscribing once it closes, and refuse a closed participant's sync subscriptions. Reverting both, or the copy's check alone, fails 2 SDK tests and 1 runtime test; the transport's refusal alone is defense in depth, which the fixed copy never reaches.
- [x] 6.3 Give runtime refusals a stable `error.code` in a `RuntimeError`; dropping the link code fails the journal test.
- [x] 6.4 Load the runtime through a launcher that catches signals first and yields one loop turn after loading; without the handlers or the loop turn, the loading-signal test fails.
- [x] 6.5 Compare Host without letter case, and roll dropped-delivery windows; reverting either fails its test.
- [x] 6.6 Make design.md say 13 MiB, describe the launcher and the codes, and keep this change's deltas identical to the synced specs.


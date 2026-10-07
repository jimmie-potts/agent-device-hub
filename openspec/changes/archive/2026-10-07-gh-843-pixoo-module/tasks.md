## 1. One package under the strict profile

- [x] 1.1 Regroup the six `@pixoo/*` packages into `@jimmie-potts/pixoo` with relative imports, compile its tests with it, and run the moved Vitest suite from `dist/tests`, where its 302 moved tests pass.
- [x] 1.2 Take `modules/pixoo` out of `staged`, drop the `@pixoo/` scope and its 59 baseline entries, and update the strict profile test; `npx eslint modules/pixoo` reports nothing.
- [x] 1.3 Clear the strict and safe-error findings with behavior kept: a busy lock by SQLite's code, an oversized image by its declared size; the moved suite still passes.

## 2. 2.0 sources and command handling

- [x] 2.1 Assert the dashboard and Now Playing views over `session/2.0` and `playback/2.0` records, with the synthetic previews' frame hashes unchanged (`agent-dashboard`, `now-playing`, `dashboard-service` tests).
- [x] 2.2 Read 2.0 records in the presentation, render through injectable renderers, and drop the agent-state and observability imports.
- [x] 2.3 Assert each completion's result and evidence, a start a whole takeover holds back completed `observed` and one a newer command superseded kept `cancelled`, and the three restored cancellation cases (`control.test.ts`, `monitor-presentation.test.ts`), then add `PixooControl`.

## 3. The module

- [x] 3.1 Assert the kit's checks with policy A's silent device (`conformance.test.ts`), the configuration and conversion (`configuration.test.ts`), and Monitor, Media, Now Playing, offline start, a failed render, a corrupt and an oversized image, the child's heap, a restart before an outcome, a repeated request, refusals, the catalog cap, a late playback owner, another module serving `device` beside it, named by its readers, and dismissal (`module.test.ts`).
- [x] 3.2 Add `createPixooModule`, `configurePixoo`, `convertPixooSettings`, `SimulatedPixoo`, the HTTP transport, the module store, the render worker and `Library.attach`.
- [x] 3.3 Assert a reused request ID refused with `duplicate-conflict`, a rollback that leaves what is served, a 257th playlist started, at most five commits a command, and a hosted library whose start reads no frames and whose frames are checked once (`module.test.ts`).
- [x] 3.4 Read the catalog after the start, keep each rendition's hosted check, commit acceptance with the pending count, apply served state after commit, and let the outbox's record be an outcome's only one.

## 4. Runtime

- [x] 4.1 Ship `pixooFactory`, and assert the shipped process, its log records and the journal intake's clean run with the Pixoo (`process`, `log`, maintenance `runtime-journal` tests).
- [x] 4.2 Add the four Pixoo scenarios, Now Playing on the playback module (#929), and play them in the in-memory harness on both transports (`test:runtime:scenarios`).
- [x] 4.3 Reach the child's simulated Pixoo from the supervisor, and watch the module's sources in `build-current` (`verify/tests/build.test.ts`).
- [x] 4.4 Give the factory a `simulatedSection`, which main's one helper (`tests/fixtures/simulated.ts`) writes for the shipped process, the `shipped` run, the journal intake's clean run and the memory script's `simulated` variant.

## 5. Documentation and qualification

- [x] 5.1 Document the module, its commands, its rules and the expected webcam results for #840 in its README, and the runtime, verification and development guides.
- [x] 5.2 Run build, typecheck, lint, the SDK, runtime, scenario, verify, event, maintenance, workflow and Pixoo checks, and OpenSpec validation.
- [x] 5.3 Show negative controls fail named tests: a start that waits on the device, a resent command after a restart, a module-local effect claimed `transmitted`, an upload taken by another command, a dismissal for another consumer, a warning per probe, the restored cancellation removed, and the factory's simulated section removed.
- [x] 5.4 Synchronize the affected specifications and archive the change.

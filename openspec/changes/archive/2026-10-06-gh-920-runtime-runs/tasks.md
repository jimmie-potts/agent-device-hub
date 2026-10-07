## 1. Tests first

- [x] 1.1 Write the launch-option tests (the edge with a grant, before the modules start, refused grants files, the grant-source rule, the `runtime.started` record, module factories, the shipped entry point with `--simulate --edge`) and the adapter's tests (every capture step, the boundary checks and their controls, the supervisor's stop, orphan, crash and harness API, and the wrapper against real units) against stubs; 7 of 74 runtime tests and 9 of 11 verification tests fail.

## 2. Launch options

- [x] 2.1 Make `src/modules.ts` the shipped factory list, add `--simulate` and `--edge`, read and check the grants file, and mount the edge once every module has started; all 74 runtime tests pass.

## 3. The runtime adapter

- [x] 3.1 Build the supervisor, the runtime child with the fixture modules over IPC, the network guard, the harness API with its flush, the run adapter, the boundary checks, the plug-in and the wrapper; all 11 verification tests pass, the lifecycle ones on this host's user manager.
- [x] 3.2 Fix what the first runs found: overlapping refreshes appended the same log records twice; a zero-module run's edge did not know the fixture families the catalog's parts send; an orphaned child spun on its closed pipes instead of stopping; and two tests left a runtime or a remote part running when they failed.

## 4. Negative controls

- [x] 4.1 Each restored:
  - a supervisor whose stop leaves its runtime running fails the cleanup test;
  - a child without the guard's disconnect handler keeps running after its supervisor dies, and the orphan test fails;
  - without the grant-source rule, the edge and process tests fail;
  - an edge that takes any token as the first grant fails the edge test and the `edge-grants` capture step;
  - an edge mounted before the modules start fails the 503 test;
  - a guard that blocks without reporting lets `control-installed-port` pass its check, and the boundary test fails;
  - a state read without the flush passed the reconnect scenario in 5 of 5 tries: the race it guards against did not happen on an idle host, so the flush stays as a guard.

## 5. Commands, CI and docs

- [x] 5.1 Add `verify:runtime`, `test:runtime:verify` and its `:built` variant, run it in the App verification CI job, and update the workflow checks.
- [x] 5.2 Document the edge and flags in the runtime README, the adapter in its README and docs/app-verification.md, the checks in docs/development.md, and the command in docs/sdlc.md's Acceptance review step 2.
- [x] 5.3 Run the edge tests 20 times in sequence and 8 times at once, and the verification suite 10 times in sequence and 4 times at once, with no failure.
- [x] 5.4 Validate this change with `--strict`, then sync and archive it; `npm run check:workflow`, `npm run test:workflow` and `openspec validate --specs --strict` exit zero.

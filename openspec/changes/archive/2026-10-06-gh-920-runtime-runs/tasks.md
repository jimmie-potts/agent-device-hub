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

## 6. Review fixes (PR #942)

- [x] 6.1 Add failing tests first: 3 of 76 runtime tests, 10 of 18 verification tests and 2 of 18 verify-host tests failed for the findings' reasons. `http.request`, `http.get` and `https.request` connected under the guard; overlapping restarts answered 500, 500 and 200; and the run's disconnect left the reader's subscription with no gap notice.
- [x] 6.2 Load the guard through `NODE_OPTIONS`, so worker threads and child Node processes load it too. Treat only a non-empty string path as a pipe, refuse UDP sends and connects, and write each refusal to the run's report file.
- [x] 6.3 Have the run's `disconnect` end the part's stream at the edge through `runMain`'s `onEdge` hook, so the same remote part reconnects, and hold its timers until the next wait. The catalog now counts the reader's gap notices.
- [x] 6.4 Judge `private-state` from what happened: the runtime's home from `/proc`, nothing under `<home>/.local/state`, and every open SQLite file under `<data>/state`. Add `packages/event-contracts` to `build-current` and to the served candidate, and test both against the run's import graph.
- [x] 6.5 Answer 503 while the runtime stops, log `runtime.edge.serving` once the edge serves, and log refusals with a known route, a registry code and its meaning, never the edge's detail.
- [x] 6.6 Serialize starts and restarts, count only the current runtime's exit as a crash, and limit crash restarts to five in any minute. Link the health page from the ready line, reload it before each step's screenshot, and add `--app runtime` to `verify:host`.
- [x] 6.7 Negative controls, each restored and caught:
  - with the old pipe rule, `node:http` and `node:https` connect and the guard test fails;
  - without the UDP patch, a datagram is sent;
  - a guard that drops `NODE_OPTIONS` lets a child Node process connect;
  - a fresh connection in place of the run's disconnect fails `scenario-reconnect-and-sync` on its gap check;
  - a disconnect that does not hold the part's timers fails the adapter test;
  - a disconnect control that takes any source fails the 400 check;
  - an unobserved default state or open databases fail the boundary test;
  - `build-current` without `packages/event-contracts` fails both build tests;
  - an unserialized lifecycle fails the overlapping-restart test;
  - a burst limit that never forgets fails its window test;
  - a ready line without the health path fails the preview test;
  - a stopping edge that answers 404, a logged detail or a raw route, and a serving record logged before the modules start each fail their edge test;
  - an edge mounted before the modules start fails the retry test.
- [x] 6.8 Run the verification suite 6 times in sequence with the user manager and 4 times at once with the bus hidden, the edge tests 20 times in sequence and 8 at once, and the scenario catalog 5 times, with no failure. A real `fixtures` run's card links the health page, its `end-to-end` capture passed and its `after.png` shows the final runtime's health, and `verify:host --app runtime -- prerequisites` cleaned up its command unit.

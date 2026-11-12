## 1. Virtual time by default

- [x] 1.1 Remove `runClock` and write `clock: "virtual"` for every catalog scenario's run; `steps.test.ts` expects `virtual` in every catalog proof. Evidence: every `scenario-*` capture passes on virtual time.
- [x] 1.2 The run's clocks for a remote module (`RemoteSimulationOptions`) and the run's monotonic clock for `run.create`, given only on virtual time, with Playback, Nanoleaf and MicroDuck simulations on them. Evidence: `tidbyt-tiles`, `automation-lines-moment` and `microduck-simulator-controls` pass on virtual time; Playback's and MicroDuck's `registration.test.ts` show that without them the modules keep `performance.now()`, and `process.hrtime` with `setInterval`, and fail when the default is changed.
- [x] 1.3 A stopped hook on virtual time through `untilReleased` and `POST /release`, refused on the real clock. Evidence: `verify/tests/clock.test.ts`, which fails with `release answered 409` when the restart does not wait; the real-clock and shipped runs answer 409 to both and keep their generation.
- [x] 1.4 The page's clock at the run's time during a capture, with the run held still. Evidence: all eight browser captures pass on virtual time.
- [x] 1.5 A virtual resync bounded in real time as well; the two adapter tests about real elapsed time on a real-clock run. Evidence: the gated adapter test, which fails without the change; the adapter suite passes.

## 2. Pins

- [x] 2.1 Pin the art show lead, the art schedule's lead and holds, the Tidbyt tile gate, Playback's poll and call timeout, and the music capture windows. Evidence: each pin passes, and changing the Pixoo hold and the art show lead fails their pins.

## 3. Guards and delivery

- [x] 3.1 Update `apps/runtime/verify/README.md`, then run build, typecheck, lint, the workflow checks, the SDK and module suites, the scenario catalog and the whole verification suite, and record the results and the per-case durations in the PR.
- [x] 3.2 Sync and archive this change on the delivery branch. Independent review and merge follow outside this change.

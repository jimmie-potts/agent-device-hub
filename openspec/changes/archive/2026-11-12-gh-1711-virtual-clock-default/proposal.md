## Why

Most of a hosted capture loop is real-timer waiting: about 670 to 790 s of about 1,140 s (#1680). Story 6 ([#1710](https://github.com/jimmie-potts/agent-device-hub/issues/1710)) put a disposable run on virtual time, opt-in per catalog scenario, and converted two cases. This is story 7 of the mocked-clock design ([#1705](https://github.com/jimmie-potts/agent-device-hub/issues/1705), comment 6799578184, sections 3 and 5): [#1711](https://github.com/jimmie-potts/agent-device-hub/issues/1711) makes virtual time the default for every catalog capture, in the pull-request verification jobs and in release qualification's packaged lanes, which run the same capture file. The owner withdrew the one real-clock capture on 2026-11-12 (#1711, comment 6812198229), so no catalog capture stays on the real clock.

## What Changes

- Every catalog scenario's run is on virtual time. The per-scenario opt-in (`runClock`) is removed, and the seed writes `clock: "virtual"` for each catalog scenario's run. Every other run keeps the real clock: `fixtures`, `mac-codex-local`, the module runs, the negative controls and every run of the shipped runtime. Every catalog capture's proof records `clock: "virtual"`.
- A hook against a stopped runtime works on virtual time. `POST /restart` takes `untilReleased`, and the new `POST /release` ends the wait, which exists before the runtime stops. On virtual time the run adapter asks for a restart that waits for a release, runs the hook against the stopped runtime, then releases it; the restart's hold then advances virtual time, and the adapter's clock follows. A run on the real clock refuses both with 409 `invalid-state`, as it refuses the clock routes.
- The SDK's `DeviceSimulation.run.remote(link, options?)` takes the run's clocks (`RemoteSimulationOptions`: `now`, `scheduler`, `monotonic`), and `run.create`'s options carry the run's `monotonic` clock. The verification child and the supervisor pass them only on virtual time. Without them a module or device keeps exactly the clocks it had. Playback's remote judges freshness on the run's monotonic clock when given one. MicroDuck's remote polls on the run's scheduler and reads the run's wall clock when given its clocks, and its supervisor device stamps its sensor on the run's clock when given a monotonic clock; otherwise both keep `process.hrtime` and `setInterval`. The supervisor's Playback and Nanoleaf devices use the wall clock and scheduler that `run.create` already received.
- On virtual time the page's clock starts at the run's time before a capture's browser journey, so the deadlines the page stamps on its requests mean what they say to the runtime. The run does not move during the journey; all eight browser captures pass so.
- On virtual time a restart's wait for the reader to come back fails only once its 15 s bound has passed in real time as well as in the run's time, since the reader comes back over real I/O. The two adapter tests whose subject is real elapsed time run on a real-clock run through a test-only option.
- Pin tests assert the shipped durations that the captures now follow only on virtual time: the art show lead, the art schedule's preparation lead and its Tidbyt and Pixoo holds, the Tidbyt tile gate, Playback's poll and call timeout, and the music capture windows. The operation deadlines were already pinned.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: the requirement "A disposable run on virtual time" makes virtual time the default for catalog scenario runs, adds the release route, the run's clocks for a remote module and a simulated device, the page's clock during a capture and a real-time bound on a virtual resync, and drops the refusal of a hook against a stopped runtime on virtual time.

## Impact

- `apps/runtime/verify/`: `seed.ts`, `supervisor.ts`, `link.ts`, `adapter.ts`, `child.ts`, `child-clock.ts`, `plugin.ts`, `README.md`, and the tests `clock.test.ts`, `steps.test.ts`, `adapter.test.ts`, `supervisor.test.ts` and `support.ts`.
- `apps/runtime/tests/scenarios/`: `framework.ts` loses `runClock`; `inbox.ts` and `modules/art.ts` lose their opt-in.
- `packages/sdk/src/registration.ts` and `index.ts`: `RemoteSimulationOptions` and the optional argument of `run.remote`.
- `modules/playback`, `modules/nanoleaf` and `modules/microduck` registrations: simulation code that only a disposable run builds. Playback and MicroDuck gain tests that without the run's clocks they keep `performance.now()`, and `process.hrtime` with `setInterval`.
- Pin tests in `packages/event-contracts`, `apps/runtime/tests/art-schedule.test.ts`, `modules/tidbyt` and `modules/playback`.
- No change to installed entry points, product timing values, message contracts, events, attributes or error shapes. The harness routes use the shared error body. No gate-policy file changes: pull requests and release qualification run the same capture file. Installation is not affected: the verification harness is not run by an installed runtime.

## Why

Every wait in a disposable run's capture case is real time: the runtime child, the supervisor's simulated devices and the run adapter's parts all use the real clock. The two prototype cases spend most of their time waiting on product timers: `scenario-shared-inbox-history` 60.1 s of its 64.6 s on the 60 s mode outcome deadline, and `scenario-art-show` 21.1 s of its 24.8 s on the 20 s common start (#1680, local). The mocked-clock design ([#1705](https://github.com/jimmie-potts/agent-device-hub/issues/1705), comment 6799578184, sections 2.1, 2.3 and 3) puts a run on a clock the run advances. Story 5 (#1709) added the guarded seam in the runtime process. This is story 6 ([#1710](https://github.com/jimmie-potts/agent-device-hub/issues/1710)): a run on virtual time, opt-in per run, prototyped on those two cases.

## What Changes

- A run can be on virtual time. The run file names the clock (`clock: "virtual"`), which the seed writes when the catalog scenario asks for it (`runClock: 'virtual'`). Only a run of the fixture runtime can be virtual. Real-clock runs are unchanged and stay the default.
- The supervisor is the authority for the run's virtual time. It starts at the real time when the run starts, holds its simulated devices on a manual clock, starts each runtime child at the current virtual time, and moves time only when its loopback harness API is asked: `GET /clock` and `POST /clock/advance {ms}`. Both answer `409 invalid-state` in a run on the real clock, and a run of the shipped runtime is always on the real clock. A restart's hold advances virtual time instead of waiting in real time.
- The child and the supervisor gain an IPC pair, `advance {id, toMs}` and `advanced {id, nowMs, nextDueMs, busy, lines}`, which extends their existing harness protocol and carries nothing on the bus. The child runs the runtime on a manual clock passed to `runMain` as its test clock, and gives the fixture core the same monotonic clock. An advance waits for held worker calls, moves the clock and gives real work its turn, with the in-memory harness's code, now shared: `stepThrough`, `realWork`/`settle`, and the worker hold and manual clock moved to `tests/scenarios/virtual-time.ts`.
- The run adapter learns the run's clock from `GET /clock`. On virtual time its `now()` is virtual, its `wait()` advances the run, split at its parts' own timers, and its parts run on a manual clock that stamps their messages. A wait in which no timer is due anywhere, after an advance that found nothing in flight and changed nothing, passes without a call to the run; the run gets that time before anything else reaches it.
- A capture's `scenario-result.json` records `clock: "virtual" | "real"`.
- With a test clock, the runtime process also refuses the default state directory (the advisory point from #1709's review): an IPC channel alone does not prove the verification supervisor.
- `scenario-shared-inbox-history` and `scenario-art-show` run on virtual time.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: a new requirement for a disposable run on virtual time, and the test-clock requirement tightened now that the verification child passes one.

## Impact

- `apps/runtime/verify/`: `supervisor.ts`, `child.ts`, the new `child-clock.ts`, `adapter.ts`, `protocol.ts`, `link.ts`, `paths.ts`, `seed.ts`, `plugin.ts`, `README.md`, and the tests `clock.test.ts`, `steps.test.ts` and `adapter.test.ts`.
- `apps/runtime/tests/scenarios/`: the new shared `virtual-time.ts`, `memory.ts` on it, `framework.ts` (`runClock`), and the two converted scenarios. `tests/support.ts` re-exports the manual clock.
- `apps/runtime/src/process.ts` and its test: the default state directory refusal.
- `eslint.config.mjs` and `docs/static-analysis.md`: the verification child joins the named stream owners, since on virtual time it counts the lines it writes to stderr.
- No change to installed entry points, product timing values, message contracts, events, attributes or error shapes. The harness routes use the shared error body. Installation is not affected: the verification harness is not run by an installed runtime.

## Why

A disposable verification run's runtime always runs on the real clock: `startRuntime` takes a clock and scheduler, but the process entry never passes one. The mocked-clock design ([#1705](https://github.com/jimmie-potts/agent-device-hub/issues/1705), comment 6799578184, sections 1 and 2.2) puts a run's runtime on a clock the run advances. Before any run can do that, the runtime needs a guarded way to take such a clock that is never reachable in an installed runtime. The installed image contains the verification child (`dist/verify/child.js`), so the guard cannot rely on that file being absent. This is story 5 of that design ([#1709](https://github.com/jimmie-potts/agent-device-hub/issues/1709)); the owner approved the design and this product change on 2026-11-11.

## What Changes

- `runMain` and `runProcess` take an optional `testClock` (a wall clock, a scheduler and a monotonic clock) as a programmatic input, meant for the verification run's child (`apps/runtime/verify/child.ts`) only. `runProcess` passes its clock and scheduler to `startRuntime`. The fixture core's options now accept a monotonic clock (`CoreOptions.monotonic`, #1695), so the child can pass the test clock's own once a run gives one.
- With a test clock, `runProcess` requires `--simulate`, `--environment test`, `--edge` and an IPC channel. Without any one of them it fails before any module starts or any port is bound, through its existing failure path: exit 1 and one `runtime.failed` record with `error.code` `invalid-state`.
- No argument or environment variable selects a clock. `parseArguments` stays strict and refuses any clock argument with a usage error. The installed entry points (`src/main.ts` through `launch.ts` and `modules.ts`, and `deploy/container/entrypoint.mjs`) construct and pass no clock, scheduler or monotonic clock, and a source check keeps it so.
- No behavior changes by itself: with no test clock, the runtime uses the real clock as before, and the verification child passes none yet.
- **Left for later stories of #1705:** the virtual-clock disposable run itself (the supervisor's clock authority, the child's advance and settle, the adapter's virtual `now` and `wait`, the harness API's clock routes and the proof's `clock` field) is story 6, and running catalog captures on it by default is story 7. Each changes the "Disposable verification runs" requirement in its own OpenSpec change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: a new requirement that the runtime takes a test clock only in a disposable verification run.

## Impact

- `apps/runtime/src/process.ts` and `index.ts`: the `testClock` input, its `TestClock` and `ChildInputs` types, and the refusal.
- `apps/runtime/tests/process.test.ts` and its process fixture: the refusal, source-check, positive-control and default-wiring tests.
- `apps/runtime/tests/fixtures/core.ts`: the fixture core's options take `monotonic`. `apps/runtime/verify/child.ts`: a comment on where a run's test clock goes.
- No message format, error shape, event, attribute, storage or contract change. The refusal uses the existing `runtime.failed` record and the registry's `invalid-state`. Installation follows the runtime upgrade procedure separately, with no installed behavior change.

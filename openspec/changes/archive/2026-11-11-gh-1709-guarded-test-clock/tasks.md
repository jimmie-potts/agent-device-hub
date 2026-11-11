## 1. Refusal tests first

- [x] 1.1 Write failing tests in `apps/runtime/tests/process.test.ts` for #1709's acceptance: each missing condition alone (production environment, no `--simulate`, no `--edge`, no IPC channel) exits 1 with one `runtime.failed` record and nothing else; a positive control whose `runtime.started` record carries the test clock's time; parser refusals of clock arguments; the installed entry points' source check including `monotonic`; and a short module timer that fires in real time with no clock given. Evidence: the refusal and positive-control tests fail before the guard.

## 2. The guarded input

- [x] 2.1 Add `testClock` to `runMain` and `runProcess` through a `ChildInputs` type, pass its clock and scheduler to `startRuntime`, and refuse it outside a simulated test run with an edge and an IPC channel through `fail` with `invalid-state`. Evidence: the tests above pass.
- [x] 2.2 Let the fixture core's options take `monotonic` for the child, and note in `verify/child.ts` where a run's test clock goes. Evidence: build, typecheck and lint.

## 3. Delivery

- [x] 3.1 Run build, lint, typecheck, the runtime unit suite, the workflow checks and the focused verification tests, and record the actual results in the PR.
- [x] 3.2 Sync and archive this change on the delivery branch. Stories 6 and 7 of #1705 change the "Disposable verification runs" requirement in their own changes. Independent review, merge and installation follow outside this change.

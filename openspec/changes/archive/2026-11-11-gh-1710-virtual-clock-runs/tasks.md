## 1. Smallest vertical slice

- [x] 1.1 Share the in-memory harness's manual clock and worker hold in `tests/scenarios/virtual-time.ts`, with `memory.ts` and `tests/support.ts` on it. Evidence: build, typecheck and the scenario catalog.
- [x] 1.2 The child's clock (`verify/child-clock.ts`) and its `advance`/`advanced` pair, the supervisor's clock authority with `GET /clock` and `POST /clock/advance`, the run file's `clock` and the scenario's `runClock`, and `scenario-shared-inbox-history` on virtual time. Evidence: the case passes on virtual time before anything else is built.

## 2. The rest of the prototype

- [x] 2.1 The adapter's virtual `now` and `wait`, its parts on a manual clock, and the idle-poll fast path with owed time. Evidence: both converted cases pass repeatedly; measurements with and without the fast path and with no event-loop turns after an advance.
- [x] 2.2 The proof's `clock` field and its check in `steps.test.ts`; `scenario-art-show` on virtual time. Evidence: both captures record `virtual`, every other scenario `real`.
- [x] 2.3 A restart's hold on virtual time, and a stopped-runtime hook refused on it. Evidence: `verify/tests/clock.test.ts`.
- [x] 2.4 The guard refuses the default state directory with a test clock. Evidence: `tests/process.test.ts`, failing without the check.

## 3. Guards and delivery

- [x] 3.1 Regression tests with negative controls: 409 on a real-clock and a shipped run, 404 on the gateway (the harness's 200 is the control), the child's monotonic clock, and the default state directory. Evidence: each fails with its guard removed.
- [x] 3.2 Update `apps/runtime/verify/README.md`, then run build, typecheck, lint, the workflow checks, the runtime unit suite, the scenario catalog, the verification tests for the changed files, both converted cases natively and in a 2-CPU container, and record the results in the PR.
- [x] 3.3 Sync and archive this change on the delivery branch. Running more captures, release qualification or any default on virtual time is #1705 story 7. Independent review and merge follow outside this change.

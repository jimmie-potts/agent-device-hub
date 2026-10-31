## 1. Core routines

- [x] 1.1 Generalize `power-schedules.ts` to routines: parse an action list with per-family payloads and mode defaults, fire actions in order with fresh identity and guards, skip on the mode precondition, log `busy` on overlap, add Run now, and migrate `power-window/1.0` rows once; unit tests on the fake clock cover each rule and the migration.
- [x] 1.2 Rename the automation routes to `routines` with `run`, widen the log entry's family, and adapt the gateway tests.

## 2. Page and scenarios

- [x] 2.1 Replace the power-schedule editor with the routine editor (action list, per-action precondition, Run now) and update the dashboard unit and browser tests.
- [x] 2.2 Rename the `weekly-power-schedules` scenario to `weekly-routines` and add `routine-actions` with the simulated Pixoo and LIFX; run both in the Linux in-memory catalog.

## 3. Documentation and specification

- [x] 3.1 Update the runtime README, development, upgrade and verify guides and the runtime spec's Automation sentence.
- [x] 3.2 Run the shared build/type/lint/workflow checks and the runtime suites; synchronize this capability and archive the change on the delivery branch before final review.

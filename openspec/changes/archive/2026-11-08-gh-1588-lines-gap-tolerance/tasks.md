## 1. Behavior

- [x] 1.1 Keep the Music input fresh across a forward discontinuity, and retire it only on expiry, reversed source time, clock invalidity or explicit retirement. Verify with input tests.
- [x] 1.2 Continue rendering across a forward discontinuity as for an ordinary gap, and retire the renderer only on reversed source time. Verify that output across a discontinuity equals output across the same gap.
- [x] 1.3 Verify that a live Lines session keeps playing across a missed window and ends `source-lost` with restoration once input expires.

## 2. Documentation and delivery

- [x] 2.1 Update the Nanoleaf README's input and live-session descriptions.
- [x] 2.2 Run build, typecheck, lint, Nanoleaf and workflow checks; record actual results.
- [x] 2.3 Sync and archive this change on the delivery branch. Independent Standards and Specification review and a focused device-command safety review follow on the PR.

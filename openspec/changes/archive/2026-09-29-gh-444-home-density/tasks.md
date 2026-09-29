## 1. Reproduce the installed layout failure

- [x] 1.1 Add a six-component desktop browser assertion for full widget visibility and verify it fails on the prior layout at 1,440 × 900.
- [x] 1.2 Record the owner's 2,133 × 1,200 CSS viewport and verify the same six-component scenario at that size. Browser zoom was not reported; the measured CSS viewport already captures its effect on layout.

## 2. Correct the dashboard layout

- [x] 2.1 Arrange the six component widgets in rows alongside Sessions and verify the desktop browser assertion passes with no text overlap.
- [x] 2.2 Verify Home remains usable at 390 px and the session panel remains readable on desktop through browser checks and visual inspection.
- [x] 2.3 Update `docs/development.md` with the changed first-screen regression and verify its commands match the existing Dashboard CI job.

## 3. Validate the source candidate

- [x] 3.1 Run the required dashboard, hub and shared build/type/contract/workflow checks from this worktree; record exact outcomes outside the reviewed revision.
- [x] 3.2 Validate the OpenSpec delta, synchronize `unified-dashboard` and archive this change on the delivery branch after all applicable task evidence is complete.

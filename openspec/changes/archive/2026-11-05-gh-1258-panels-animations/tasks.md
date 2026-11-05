## 1. Requested animation behavior

- [x] 1.1 Add a failing normal module NL22 request case, record the expected Lines-only refusal before implementation, and cover the synthetic NL22 encoder.
- [x] 1.2 Extend selected-device geometry, encoding, admission and worker execution, then pass NL22 preset, explicit and favorite playback tests with per-device queue, cancellation and failure evidence.
- [x] 1.3 Publish per-device animation options and shared favorite changes, then pass mode, scene, queue and snapshot-isolation checks.

## 2. Integration and delivery

- [x] 2.1 Update the module guide and retain the scoped capability scenarios, then pass build, typecheck, lint, Nanoleaf, applicable runtime and workflow checks.
- [x] 2.2 Complete a disposable normal-entry-point acceptance exercise and synchronize/archive the verified capability delta before independent review.

## Evidence

- The first normal module NL22 request test failed with `rejected` instead of `accepted` before implementation.
- Build, typecheck and lint passed. Nanoleaf passed 568 tests with one existing platform skip. The focused runtime consumer tests and the `nanoleaf-wall` catalog scenarios each passed two tests.
- Workflow checks passed with 90 capability specs and this one change; all 277 workflow tests passed before archival.
- A disposable runtime through `runMain --simulate --edge` accepted tracked HTTP commands for Panels preset, explicit and shared favorite playback, kept Lines transmission separate, played a Lines request and published one terminal outcome per command. The exact child stopped cleanly.
- The managed `verify:runtime start` launcher could not run on macOS because `systemctl` is absent. The disposable entry-point exercise above supplies the local runtime acceptance evidence. No installed runtime or physical device was used.
- Both modified requirements were synchronized, preserving all earlier scenarios; strict validation passed for all 90 capability specs.

## 1. Adopt SDK classification
- [x] 1.1 Add core startup and transaction wrapped-ENOSPC regressions; observe both fail before production edits and pass with `fullDisk`.
- [x] 1.2 Add wrapped-ENOSPC consumer regressions for LIFX, Tidbyt and playback; observe red before edits and green after adoption.
- [x] 1.3 Restore each former local predicate as a negative control and verify its consumer regression fails, then restore SDK delegation.
- [x] 1.4 Preserve explicit `SdkError`, core BUSY lease, playback BUSY/LOCKED, admission, diagnostics, and no-effect-before-durable-admission behavior.

## 2. Guard and specify
- [x] 2.1 Add a workflow guard for local full-disk checks across runtime and module sources with a negative-control fixture.
- [x] 2.2 Add observable deltas for core, LIFX, Tidbyt and playback storage classification.
- [x] 2.3 Update owning package documentation where it clarifies the classification contract.

## 3. Validate and hand off
- [x] 3.1 Run focused pure consumer tests, shared build/type/lint/SDK/contracts/workflow gates, and strict OpenSpec validation; record exact results.
- [x] 3.2 Obtain host-slot runtime/scenario/verification acceptance and archive only after all required evidence is complete.

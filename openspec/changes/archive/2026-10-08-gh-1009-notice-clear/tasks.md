## 1. Atomic owner command

- [x] 1.1 Add the notice-clear family and verify valid/invalid contract fixtures.
- [x] 1.2 Add one queued all-consumer owner save and verify one-save, unchanged independent evidence and newer-notice refusal.
- [x] 1.3 Reuse operator admission and atomic completion; verify authorization, no-notice, unknown/stale selection, rollback, save-time guard and restart/no-resend tests.

## 2. Connections control and evidence

- [x] 2.1 Implement a standalone confirmed OperatorTools component and evidence helper; verify typed props and helper unit tests against the existing copies.
- [x] 2.2 Integrate the minimal Connections insertion with #922; verify the focused browser journey for confirmation, passive row, synced result, keyboard/axe, read-only presentation and no replay.
- [x] 2.3 Exercise the one notice-clear catalog scenario over simulated Nanoleaf/Pixoo records in memory and a disposable run; retain actual exits and cleanup proof.
- [x] 2.4 Complete affected mandatory shared checks and independent Acceptance on the clean integrated candidate; retain receipts.

## 3. Contracts and documentation

- [x] 3.1 Document the override, consumer self-acknowledgment and passive session-row clearing; verify diff and workflow checks.
- [x] 3.2 After Acceptance, synchronize all four affected specs and verify strict spec validation.

Archive after synchronization and task completion, then validate the archived inventory and workflow. Independent Standards/Specification review and hosted PR/main CI remain downstream delivery gates. Source-only delivery installs at #840. The coordinator owns publication, integration and final delivery.

Acceptance passed clean head `9b6d3777` in disposable run `runtime-20261008T165418Z-e70066`: catalog12steps, confirmed real browser action, reconnect/reload without replay and four focused accessibility scans. Its initial observer consumer-count mismatch was corrected; no product change resulted. The six-commit story patch is unchanged by the rebase onto merged #922.

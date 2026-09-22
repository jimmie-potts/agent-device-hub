## 1. Confinement and evidence
- [x] 1.1 Implement staged source validation, isolated supervision and failure reports; observe failing then passing tests for invalid inputs, confinement and timeout/detached-child cleanup.
- [x] 1.2 Implement target evaluation and sample completeness; observe failing then passing tests that reject missing consumers, failures and exceeded hard/resource limits.
## 2. Real source scenarios
- [x] 2.1 Integrate the actual hook, standalone owner and pinned real consumers; verify 1/10-task samples and a bounded 50-task burst in a confined run.
- [x] 2.2 Add browser/control, stalled/offline consumer, host outage/restart and ownership scenarios; verify retained state, healthy-consumer progress, resync and cleanup in the report.
## 3. Qualification and delivery
- [x] 3.1 Wire correctness checks into documented commands and CI; run shared canonical checks and relevant consumer regressions, retaining actual outcomes.
- [x] 3.2 Run qualification against a committed source revision and publish its report including failures, targets, source pins and limitations; synchronize the guide.
- [x] 3.3 Validate and synchronize the capability, archive the completed change, prepare the complete candidate for independent fixed-revision review. Reviews, CI and guarded delivery remain SDLC gates after archive.

Evidence: docs/performance/standalone-2026-09-22/README.md and report.json. Source review, hosted CI and guarded delivery remain separate post-archive gates.

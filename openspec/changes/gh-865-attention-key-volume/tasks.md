## 1. Acceptance examples first

- [x] 1.1 Write failing profile, router, lights, panel, keyboard, Windows adapter and adapter-contract tests for the Attention key, the black-key map and the volume knob (evidence: commit "Write acceptance tests for PROMPTI's Attention key and volume knob" and its failing run).

## 2. Implementation

- [x] 2.1 Add `sendVolumeKey` as OS adapter interface version 4 to the Windows adapter, the unsupported adapter and the simulated desktop, and cover the volume keys in the native check without sending them (evidence: `windows-keyboard.test.mjs`, `windows-adapter.test.mjs`, `os-adapter.test.mjs`, `adapter-contract.test.mjs`, `tests/native.mjs`).
- [x] 2.2 Add the optional `keys`, `volume` and `timing.attentionRepeatMs` profile fields with conflict checks and older-profile defaults (evidence: `routing-profile.test.mjs`).
- [x] 2.3 Route the Attention key, black-key Back and the volume knob, including the first-seen order, repeat window, refusal, the Record interaction and the lights (evidence: `routing-router.test.mjs`, `routing-lights.test.mjs`).

## 3. Verification harness

- [x] 3.1 Add the `attention-key` and `volume-knob` catalog scenarios (evidence: `test:chompi-bridge:scenarios`, `scenarios.test.mjs`, `scenario-attention-key` and `scenario-volume-knob` in `verify/tests/steps.test.mjs`).
- [x] 3.2 Give the Attention key and the volume knob light roles from the router's key map, and show volume keys and the system volume on the control page (evidence: `panel.test.mjs`, `verify/tests/page.browser.mjs`).

## 4. Documentation and validation

- [x] 4.1 Update the bridge README, the verification README, the qualification report (control map and installed checks for #865, run by #745) and the development guide (evidence: those files).
- [x] 4.2 Run build, typecheck, lint, the bridge suites, the contracts suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 4.3 Synchronize the specs and archive this change (evidence: the synced specs match the deltas).
- [x] 4.4 Hand installation and the physical checks to #745 (evidence: the qualification report's installed checks for #865; receipts go on #745, not in this change).

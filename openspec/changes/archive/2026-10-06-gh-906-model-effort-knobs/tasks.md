## 1. Acceptance examples first

- [x] 1.1 Write failing router, profile, lights, panel, keyboard, Windows adapter, helper, client-file and adapter-contract tests for the model and effort knobs, against interface version 5 and a shared simulated picker model (evidence: commit "Write acceptance tests for PROMPTI's model and effort knobs"; 30 failures against the base implementation while the existing tests pass).

## 2. Implementation

- [x] 2.1 Add `tapInClient`, `pickerState` and `claudeSettings` as OS adapter interface version 5 to the Windows adapter, the UI Automation helper, the unsupported adapter and the simulated desktop, with `Equal`, `Minus` and the navigation keys in the keyboard, and cover them read-only in the native check (evidence: `windows-keyboard.test.mjs`, `windows-adapter.test.mjs`, `windows-uia-helper.test.mjs`, `windows-client-files.test.mjs`, `os-adapter.test.mjs`, `adapter-contract.test.mjs`, `tests/native.mjs`).
- [x] 2.2 Add the optional `model`, `effort`, Codex effort chords, `timing.menuTimeoutMs` and `colors.applied` profile fields with reserved-control checks and older-profile defaults (evidence: `routing-profile.test.mjs`).
- [x] 2.3 Route knob 1 and knob 2: the Claude and Codex flows, readback outcomes, the chord fallback, refusals, the timeout, the close before other controls, release on loss and the knob lights (evidence: `routing-knobs.test.mjs`, `routing-lights.test.mjs`).

## 3. Verification harness

- [x] 3.1 Add the `claude-model-knob`, `claude-effort-knob`, `claude-effort-unsupported`, `codex-model-knob`, `codex-effort-knob` and `knob-refusals` catalog scenarios (evidence: `test:chompi-bridge:scenarios`, `scenarios.test.mjs`, their capture steps in `verify/tests/steps.test.mjs`).
- [x] 3.2 Show each window's model, effort and open picker, the picker log and the knob light names on the control page, with knobs 1 and 2 starting at one step (evidence: `panel.test.mjs`, `verify/tests/page.browser.mjs`).

## 4. Documentation and validation

- [x] 4.1 Update the bridge README, the verification README, the UIA notes, the qualification report (control map, client rows and installed checks for #906, run by #745), the development guide and the app verification overview (evidence: those files).
- [x] 4.2 Run build, typecheck, lint, the bridge suites, the contracts suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 4.3 Synchronize the specs and archive this change (evidence: the synced specs match the deltas).
- [x] 4.4 Hand installation, the physical checks and the live `pickerState` qualification to #745 (evidence: the qualification report's installed checks for #906; receipts go on #745, not in this change).

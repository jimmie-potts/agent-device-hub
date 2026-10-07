## 1. Acceptance examples first

- [x] 1.1 Write failing router, profile, lights, panel, Windows adapter, helper, adapter-contract, scenario-list, capture-step and browser tests for knob 3, against interface version 6 and a shared simulated band, extending `noStrayKeys` to allow only knob 3's one Right arrow into Claude's focused, empty composer (evidence: commit "Write acceptance tests for PROMPTI's knob 3 next steps"; 19 failures against the base implementation while the existing tests pass).

## 2. Implementation

- [x] 2.1 Add `suggestionState`, `focusSuggestion` and `invokeSuggestion` as OS adapter interface version 6 to the Windows adapter, the UI Automation helper, the unsupported adapter, the simulated desktop and the test fake, with the shared simulated band in `src/sim/suggestions.ts`, and record the band's shape read-only in the native check (evidence: `windows-adapter.test.mjs`, `windows-uia-helper.test.mjs`, `os-adapter.test.mjs`, `adapter-contract.test.mjs`, `tests/native.mjs`).
- [x] 2.2 Add the optional `nextSteps` profile section with reserved-control checks and older-profile defaults (evidence: `routing-profile.test.mjs`).
- [x] 2.3 Route knob 3 in `SettingKnobs` and the router: the highlight, the pick, the ghost click, refusals, the timeout, the close before other controls, release on loss and knob 3's light (evidence: `routing-knobs.test.mjs`, `routing-lights.test.mjs`, `panel.test.mjs`).

## 3. Verification harness

- [x] 3.1 Add the `claude-next-step-pick`, `claude-ghost-accept` and `next-step-refusals` catalog scenarios (evidence: `test:chompi-bridge:scenarios`, `scenarios.test.mjs`, their capture steps in `verify/tests/steps.test.mjs`).
- [x] 3.2 Show Claude's next-step band with show and hide controls, the next-step log and knob 3's light on the control page, with knob 3 starting at one step (evidence: `verify/tests/page.browser.mjs`).

## 4. Documentation and validation

- [x] 4.1 Update the bridge README, the verification README, the UIA notes, the qualification report (control map, the Claude row and installed checks for #907, run by #745), the development guide and the app verification overview (evidence: those files).
- [x] 4.2 Run build, typecheck, lint, the bridge suites, the contracts suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 4.3 Synchronize the specs and archive this change (evidence: the synced specs match the deltas).
- [x] 4.4 Hand installation, the physical checks and the live qualification of the helper's band read, `Invoke` and the empty-composer value to #745 (evidence: the qualification report's installed checks for #907; receipts go on #745, not in this change).

## 5. Review fix round 1 (#943)

- [x] 5.1 Find the band as the native check observed it on 2026-10-07, two `Group`s below the branch beside the composer's group, keeping the direct-sibling shape and every bound and refusal; share the rule with the simulation through `src/sim/band-tree.ts` (evidence: the locator test and static tests in `windows-uia-helper.test.mjs`, the nesting cases in `adapter-contract.test.mjs`; a negative control with a sibling-only bound fails them).
- [x] 5.2 S907-1: record that the issue's digit-key fallback is dropped (evidence: design.md Non-Goals, the bridge README).
- [x] 5.3 S907-2: document the observed band level in UIA-NOTES and remove it from "Not established" (evidence: UIA-NOTES "Next-step suggestions").

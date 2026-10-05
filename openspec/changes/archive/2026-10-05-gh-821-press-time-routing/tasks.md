## 1. Acceptance examples first

- [x] 1.1 Write failing router tests for press-time Send and Record, card answers, detents and the wheel's unknown states, and rewrite the target-model tests deliberately (evidence: `routing-router.test.mjs`; each weakened or removed assertion is explained in the commit message).
- [x] 1.2 Write failing adapter, helper, profile and lights tests for the card operations, the optional profile fields and lights without selection (evidence: `windows-adapter.test.mjs`, `windows-uia-helper.test.mjs`, `routing-profile.test.mjs`, `routing-lights.test.mjs`).

## 2. Implementation

- [x] 2.1 Add OS adapter interface version 3 with `cardButtons`, `focusCardButton` and `invokeCardButton`: the helper operations, Windows adapter parsing and the unsupported adapter (evidence: the adapter and helper suites pass).
- [x] 2.2 Replace the router's target with press-time Send, keyboard-like Record and wheel card navigation with software detents; remove the selected and Send-readiness lights; add the optional `cards` profile section and accept the retired colors (evidence: the router, profile, lights and CLI suites pass).
- [x] 2.3 Extend the native Windows check with a read-only card read in both client windows (evidence: `codexCardButtons` and `claudeCardButtons` in `native.mjs`; the coordinator runs it on the trial host).

## 3. Documentation and validation

- [x] 3.1 Update the bridge README (controls, safety rules, profile table, log events), `UIA-NOTES.md` (card operations, containers per client, the live keyboard qualification) and the qualification report (routing design and the no-misrouting matrix), stating the cut assurances and residuals (evidence: those files).
- [x] 3.2 Run build, typecheck, the bridge suite, OpenSpec validation and the workflow checks; record the results in the PR.
- [x] 3.3 Synchronize the specs and archive this change before final review (evidence: `openspec/specs/chompi-task-routing/spec.md` and `openspec/specs/chompi-bridge/spec.md` match the deltas, and `openspec validate --all --strict` passes).
- [x] 3.4 Hand the native Windows check (`npm run test:chompi-bridge:native:built`, now with the read-only card read), the bridge installation and the live card checks on the trial host to the coordinator and owner (evidence: their receipts go in the PR and on #821, not in this change; source work does not claim them).

## 4. Review round (PR #825)

- [x] 4.1 Narrow the Codex card container to the thread view (exactly one selected sidebar row) and a group directly holding a text element and at least two actionable buttons (evidence: the Codex card tests in `windows-adapter.test.mjs`, the container checks in `windows-uia-helper.test.mjs`, the matrix rows in the qualification report).
- [x] 4.2 Press only a button the wheel's own step moved to on the same card, identified by its runtime ID (evidence: "card: a click presses only a button the wheel itself moved to on this card" in `routing-router.test.mjs`).
- [x] 4.3 Flash both big-wheel LEDs in the error color for a refused or uncertain Send or card press (evidence: the refusal-light tests in `routing-router.test.mjs` and `routing-lights.test.mjs`).
- [x] 4.4 Never refuse Record: supersede a Send still checking and press the chord right after an Enter being typed (evidence: the two Record-during-Send tests in `routing-router.test.mjs`).
- [x] 4.5 Clear partial rotation outside a card, keep the measured step default in one constant, and pass the helper script path through the environment (evidence: "scroll counts never shorten the first card step", the shipped-profile test and the loader test).

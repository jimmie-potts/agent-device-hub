## 1. Selector

- [x] 1.1 Failing tests for the adapter's reading of approval counts for both clients and the helper operation's static scope; implement the `approvalVisible` helper operation and adapter parsing (evidence: `windows-adapter.test.mjs`, `windows-uia-helper.test.mjs`).
- [x] 1.2 Extend the native Windows check to run the operation against the Codex and Claude windows and record each time (evidence: `codexApprovalCount` and `claudeApprovalCount` in `native.mjs`).

## 2. Documentation and validation

- [x] 2.1 Record the card structure, versions and re-qualification rule in `UIA-NOTES.md`, and update the bridge README, the qualification report and the development guide (evidence: the "Approval cards" section in `UIA-NOTES.md`, step 1 of "Qualify a client update" in the README, and the approval-guard rows in `docs/chompi-controller-qualification.md`).
- [x] 2.2 Run build, typecheck, the bridge suite and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the specs and archive this change before final review (evidence: `openspec/specs/chompi-bridge/spec.md` and `openspec/specs/chompi-task-routing/spec.md` match the deltas here, and `openspec validate --all --strict` passes).
- [ ] 2.4 Native Windows check on the trial host (coordinator); record its receipt in the PR. The live guard checks belong to the #743 trial.

## 1. Fix

- [x] 1.1 Find the Codex card as the one on-screen group with text and two actionable buttons, independent of focus, bounded, and with no Name or Value reads (evidence: the Codex adapter test, the static structural test in `windows-uia-helper.test.mjs`, and the router test for a card without focus).

## 2. Documentation and validation

- [x] 2.1 Record the rule and the live finding in UIA-NOTES, the bridge README and the qualification report (evidence: those files).
- [x] 2.2 Run build, typecheck, the bridge suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the specs and archive this change (evidence: the synced `chompi-bridge` and `chompi-task-routing` specs match the deltas).
- [x] 2.4 Hand the native check, the reinstall and installed check 4 to the coordinator and owner: a Codex escalation card without focus answers with a still click after one step; receipts go in the PR and on #821, not in this change.

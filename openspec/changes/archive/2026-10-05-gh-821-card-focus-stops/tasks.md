## 1. Fix

- [x] 1.1 Poll focus after `SetFocus` in `FocusCardButton` (25 ms, at most 400 ms) and model delayed focus in the fake adapter (evidence: the delayed-focus router test and the static poll test).
- [x] 1.2 Stop only on a Claude question card's `text-left` answer rows, with every actionable button otherwise and Codex unchanged (evidence: the static stop-rule test).

## 2. Documentation and validation

- [x] 2.1 Record the live findings, the stop rule and the re-qualification note in UIA-NOTES, the bridge README and the qualification report (evidence: those files).
- [x] 2.2 Run build, typecheck, the bridge suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the specs and archive this change (evidence: the synced `chompi-bridge` and `chompi-task-routing` specs match the deltas).
- [x] 2.4 Hand the native check, the reinstall and the live card checks to the coordinator and owner: a Claude question card steps through its answers only and a still click presses the one reached; a permission card steps through all its answers (evidence: their receipts go in the PR and on #821, not in this change).

## 3. Review (PR #826)

- [x] 3.1 Word the requirements in stops, say that late focus is not answered as the requested stop, and mark the inferred permission-card fact and other card shapes in UIA-NOTES (evidence: the synced specs and UIA-NOTES).
- [x] 3.2 Make the fake adapter's focus reply wait for the lag or the helper's read-back bound, read from `uia-helper.ps1`, and show that a still click during a lagging read-back is refused as `card-busy` (evidence: `routing-router.test.mjs`, `windows-uia-helper.test.mjs`).

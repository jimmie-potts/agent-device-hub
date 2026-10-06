## 1. Fix

- [x] 1.1 Remove the clamp-and-choose branch: a clamped step logs `card-step`, calls no adapter and leaves the choice unchanged (evidence: "card: a clamped step chooses nothing; approving a card that opens on its last stop needs a turn away and back" in `routing-router.test.mjs`).

## 2. Documentation and validation

- [x] 2.1 Update the README card rules, UIA-NOTES, the qualification matrix and installed check 3 (evidence: those files).
- [x] 2.2 Run build, typecheck, the bridge suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the spec and archive this change (evidence: the synced `chompi-task-routing` spec matches the delta).
- [x] 2.4 Hand the reinstall and installed check 3 to the coordinator and owner (evidence: their receipts go in the PR and on #821, not in this change).

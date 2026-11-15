## 1. Contract and durable recovery

- [ ] 1.1 Add minor speech contracts with closed validation for recovery and preserve 2.0 refusal tests.
- [ ] 1.2 Demonstrate the restart recovery regression failing, then implement atomic acknowledgement and revision; verify no replay, unchanged uncertainty, stale/live refusal, rollback and later uncertainty tests.

## 2. Browser recovery

- [ ] 2.1 Add explicit confirmation and idle-checked recovery through the existing endpoint API; verify refusal, disconnect and no retry with session tests.
- [ ] 2.2 Exercise restart, recovery, fresh enablement and new speech in the disposable browser journey; retain zero old replay and two-tab exclusion assertions.

## 3. Validation and documentation

- [ ] 3.1 Update the owning guide and verify build, type, lint, contract, workflow and affected runtime/SDK/dashboard checks.
- [ ] 3.2 Synchronize and archive this change after successful disposable acceptance; verify the capability inventory. Revision-specific reviews, CI, deployment and installed evidence remain in the PR and issues.

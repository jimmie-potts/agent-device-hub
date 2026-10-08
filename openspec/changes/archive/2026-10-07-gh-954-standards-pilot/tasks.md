## 1. Module test kit

- [x] 1.1 Assert, red before the check exists, that a two-family module that answers only the requested family passes every check, that one answering every family fails only the per-family check, and that a one-family module has no such check (`packages/sdk/tests/kit.test.ts`).
- [x] 1.2 Add the per-family sync check to `conformanceChecks` and document it in the SDK README.
- [x] 1.3 Show the check fails the Nanoleaf suite when its provider answers every family.

## 2. Safe errors in the verification harness

- [x] 2.1 Assert that the harness's refusals are the registry's body, that a malformed or `null` body is `invalid-request` and an oversized one `too-large`, never quoting it (`supervisor.test.ts`), and that the run adapter and a failed step name a failure without an exception's message (`adapter.test.ts`, `runner.test.ts`).
- [x] 2.2 Convert the supervisor, the child's lamp failure and the run adapter; remove the `verification-harness` lint exception and record the runtime's usage exception as permanent.

## 3. A run's health

- [x] 3.1 Assert, failing with the old probe that read only the HTTP status, that a run whose chime fails makes the probe fail naming it, that `misconfigured-module` passes with its expected refusal, and that every boundary run passes readiness (`health.test.ts`, `boundaries.test.ts`).
- [x] 3.2 Add `judgeHealth`, the seeds' expected refusals and the probe; document health and the shipped run's limits in the verify README.

## 4. One-run guard, lint and tooling

- [x] 4.1 Assert that a release that cannot read its claim's invocation stops nothing (`single-run.test.mjs`), and fix `releaseClaim`.
- [x] 4.2 Add the lint checks for destructured streams, `globalThis.process`, `String.raw`, joined array literals and string `concat`, with valid and invalid cases (`tests/strict_profile.test.mjs`).
- [x] 4.3 Add the scratch-root helper with its test, and use it in both packaging scripts.
- [x] 4.4 Fix the one-run guard's documentation and the composition test's precondition, and add the boundary prompt to the bug and epic issue templates.

## 5. Documentation and qualification

- [x] 5.1 Add the rule-to-check table and the lint misses with their reasons to `docs/development.md`.
- [x] 5.2 Run the gate and show that named tests fail under each negative control.
- [x] 5.3 Synchronize the affected specifications and archive the change.

## 6. Review fix round (PR #997)

- [x] 6.1 Assert, red before the fix, that a failed step's detail, the attached result and the failed expectation never quote an exception, and that a step's own failure keeps its text (`runner.test.ts`, `adapter.test.ts`); name failures in `attempt` as the adapter does.
- [x] 6.2 Assert that health fails when the runtime reports degraded for a reason no module or lag check shows (`health.test.ts`).
- [x] 6.3 Assert that the scratch root never climbs past a checkout that is not a scratch or worktree tree, such as a home directory kept in Git (`tests/scratch_root.test.mjs`).
- [x] 6.4 Refuse a malformed or `null` body with `invalid-request` and an oversized one with `too-large` (`supervisor.test.ts`).
- [x] 6.5 Map "Cancellation is not undo" and "each observation or sync attempt has a deadline" in the rule table, and say that the lint checks were added at the coordinator's request.

## 7. Rebase onto main (after #782, #926, #931, #933 and #975)

- [x] 7.1 Keep main's not-JSON and `null`-body refusals and send an oversized body to 413 `too-large`; name #926's hook failures, #782's dispatch failures and the memory harness's answers and problems through `failureOf` or `StepFailure`; never quote a hook's output in a step's detail (`runner.test.ts`).
- [x] 7.2 Rebuild the `bunny-sdk` delta from the synced text that #782 changed, and confirm all three synced requirements equal their deltas.

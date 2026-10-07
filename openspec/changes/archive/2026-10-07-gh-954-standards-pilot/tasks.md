## 1. Module test kit

- [x] 1.1 Assert, red before the check exists, that a two-family module that answers only the requested family passes every check, that one answering every family fails only the per-family check, and that a one-family module has no such check (`packages/sdk/tests/kit.test.ts`).
- [x] 1.2 Add the per-family sync check to `conformanceChecks` and document it in the SDK README.
- [x] 1.3 Show the check fails the Nanoleaf suite when its provider answers every family.

## 2. Safe errors in the verification harness

- [x] 2.1 Assert that the harness's refusals are the registry's body and that a body that is not JSON is `internal` with fixed text that never quotes it (`supervisor.test.ts`), and that the run adapter names a failure without an exception's message (`adapter.test.ts`).
- [x] 2.2 Convert the supervisor, the child's lamp failure and the run adapter; remove the `verification-harness` lint exception and record the runtime's usage exception as permanent.

## 3. A run's health

- [x] 3.1 Assert, failing with the old probe that read only the HTTP status, that a run whose chime fails makes the probe fail naming it, that `misconfigured-module` passes with its expected refusal, and that every boundary run passes readiness (`health.test.ts`, `boundaries.test.ts`).
- [x] 3.2 Add `judgeHealth`, the seeds' expected refusals and the probe; document health and the shipped run's limits in the verify README.

## 4. One-run guard, lint and tooling

- [x] 4.1 Assert that a release that cannot read its claim's invocation stops nothing (`single-run.test.mjs`), and fix `releaseClaim`.
- [x] 4.2 Add the lint checks for destructured streams, `globalThis.process`, `String.raw`, joined array literals and string `concat`, with valid and invalid cases (`tests/strict_profile.test.mjs`).
- [x] 4.3 Add the scratch-root helper with its test, and use it in both packaging scripts.
- [x] 4.4 Fix the one-run guard's documentation and the composition test's precondition.

## 5. Documentation and qualification

- [x] 5.1 Add the rule-to-check table and the lint misses with their reasons to `docs/development.md`.
- [x] 5.2 Run the gate and show that named tests fail under each negative control.
- [x] 5.3 Synchronize the affected specifications and archive the change.

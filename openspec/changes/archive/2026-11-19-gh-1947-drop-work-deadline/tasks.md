Every task names its evidence. Reviews and CI receipts go in the pull request.

## 1. Contract

- [x] 1.1 Drop `deadline` from the `session/3.0` work reasons (schema, `WorkReason`, `SessionFacts.unconfirmed`, the case loader's types) and update the `approval-recover` description. Evidence: `session.test.mjs` refuses a record with reason `deadline`; `npm run test:events:built` passes.
- [x] 1.2 Rewrite the case set's deadline cases: `question-silent` and `working-silent` publish nothing, `child-only` reaches its unconfirmed child by a restart (`since` step 8), and `expiry` keeps its running session confirmed. Evidence: the contracts suite and every reader's case-set test pass.

## 2. Core

- [x] 2.1 Remove the work deadline, its input, scheduling and private progress time; keep expiry and the restart marking. Evidence: `core-session-progress`, `core-session-logic`, `core-store` and `core.test` pass with silence publishing nothing for an hour.
- [x] 2.2 Approval recovery follows the restart marking only. Evidence: `core.test.ts` and `core-store.test.ts` refuse recovery after five silent minutes and accept it after a restart.
- [x] 2.3 Publish the evidence time at `SESSION_LIMITS.evidenceResolutionMs` and measure revisions and history rows per busy session-hour. Evidence: the measurement test in `core-session-progress.test.ts` and its diagnostic line.

## 3. Readers

- [x] 3.1 Show the evidence age on the dashboard's session card. Evidence: `sessions.test.ts` (`heardAge`), the browser journeys' card text.
- [x] 3.2 Update the dashboard, Nanoleaf, Tidbyt, Codex Desktop and companions tests and fixtures that created deadline cases, keeping restart coverage. Evidence: their suites pass.

## 4. Docs and specs

- [x] 4.1 Update the runtime and dashboard READMEs, the contracts README and MAPPING, and `docs/provider-qualification.md`. Evidence: readback in the pull request.
- [x] 4.2 Sync the delta specs and archive this change on the branch. Evidence: `npm run check:workflow` and `npm run test:workflow` pass.

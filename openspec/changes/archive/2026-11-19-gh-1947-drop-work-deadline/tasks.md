Every task names its evidence. Reviews and CI receipts go in the pull request.

## 1. Contract

- [x] 1.1 Stop emitting `deadline` (`SessionFacts.unconfirmed`, `buildSession`, the case loader's types) while the schema and `WorkReason` keep accepting it, and update the `approval-recover` description. Evidence: `session.test.mjs` reads a stored `deadline` record and shows the builder never emits it; `npm run test:events:built` passes.
- [x] 1.2 Rewrite the case set's deadline cases: `question-silent` and `working-silent` publish nothing, `child-only` reaches its unconfirmed child by a restart (`since` step 8), and `expiry` keeps its running session confirmed. Evidence: the contracts suite and every reader's case-set test pass.

## 2. Core

- [x] 2.1 Remove the work deadline, its input, scheduling and private progress time; keep expiry and the restart marking. Evidence: `core-session-progress`, `core-session-logic`, `core-store` and `core.test` pass with silence publishing nothing for an hour.
- [x] 2.2 Approval recovery follows the restart marking only. Evidence: `core.test.ts` and `core-store.test.ts` refuse recovery after five silent minutes and accept it after a restart.
- [x] 2.3 Publish the evidence time at `SESSION_LIMITS.evidenceResolutionMs` and measure revisions and history rows per busy session-hour. Evidence: the measurement test in `core-session-progress.test.ts` and its diagnostic line.

- [x] 2.4 Keep evidence-only session publications out of history's rows: they confirm the open span (owner decision of 2026-11-21). Evidence: `core-session-progress.test.ts` (span confirmations, rebuild, change and removal closing), `history-spans.test.ts`, and a negative control where three progress tests fail without the rule.
- [x] 2.5 Upgrade the installed `037b327a` store: the start transaction drops the retired fields and turns deadline-unconfirmed work restart-unconfirmed, publishing once. Evidence: the upgrade test in `core-session-progress.test.ts`; `apps/runtime/UPGRADE.md` notes it.

## 3. Readers

- [x] 3.1 Show the evidence age on the dashboard's session card, and a busy session as one Timeline entry with its span's last reading. Evidence: `sessions.test.ts` (`heardAge`), `timeline.test.ts`, the browser journeys' card text.
- [x] 3.2 Update the dashboard, Nanoleaf, Tidbyt, Codex Desktop and companions tests and fixtures that created deadline cases, keeping restart coverage. Evidence: their suites pass.

## 4. Docs and specs

- [x] 4.1 Update the runtime and dashboard READMEs, the contracts README and MAPPING, and `docs/provider-qualification.md`. Evidence: readback in the pull request.
- [x] 4.2 Sync the delta specs and archive this change on the branch. Evidence: `npm run check:workflow` and `npm run test:workflow` pass.

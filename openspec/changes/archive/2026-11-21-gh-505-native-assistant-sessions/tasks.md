## 1. Design checkpoint

- [x] 1.1 Write the input/state mapping, versions, binding, expiry, capacity and previous-release helper design (design.md). Evidence: this change at the checkpoint commit.
- [x] 1.2 Record the owner's answers to questions 1 to 5, the coordinator's question 6 and the order with #1947 in design.md. Evidence: design.md "Decisions on the open questions".
- [x] 1.3 After #1947 merges, start from the main that contains it; rebase the `bunny-message-profile` and `bunny-runtime` deltas onto #1947's text. Evidence: `npm run check:workflow` passes.

## 2. Contracts

- [x] 2.1 Red: source, schema-equality, status and read-function tests for the native source, `session/3.1`, `lifecycle/2.2` and the 2.1 occurrences fail. Evidence: `npm run test:events:built` fails on the new cases.
- [x] 2.2 Add the source entry, the schemas, the family registrations and types, the rule 3 detail and `readSession`'s 3.1 reading. Evidence: `npm run test:events:built`, `npm run test:events:python`, `npm run test:contracts`, `npm run test:contracts:python` pass.
- [x] 2.3 Add native cases to the shared case set: every row of decisions 3 and 4, duplicates, delay, reordering, restart, expiry, reappearance and capacity, with every reader's expected output. Evidence: the case-set tests pass for every reader.

## 3. Core

- [x] 3.1 Red: core tests for binding, the new inputs, the terminal attention rule, the pre-acknowledged cancel notice, the ordered start recovery, per-record versions and capacity with native roots fail. Evidence: the runtime unit suite fails on them.
- [x] 3.2 Implement the reducer, transition, record and store changes, the core and gateway binding and the companion part's native exclusion as its own predicate (decision 14). Evidence: the runtime unit and scenario suites pass under `node scripts/native-test.mjs <script> --workers 4`.

## 4. Producer

- [x] 4.1 Red: engine tests with fake tasks and the injected clock for each task change in all three profiles, the delegation wait, a startup that recovers a task as paused or uncertain, a task running at the first start of this release, the baseline of saved tasks and a failed baseline, and a task change that rolls back and reports nothing. Outbox republication is the SDK outbox's own tested behavior; the restart tests show that no report is repeated. Evidence: `test:companions:built` fails on them (the delegation, pause, first-start, failed-baseline and rollback tests were added in review round 1 on PR 2012).
- [x] 4.2 Implement the projection, `assistant_reports` and the observations in `#publish`. Evidence: `test:companions:built` passes.

## 5. Readers

- [x] 5.1 Dashboard and Habitat names and the finished result in chip text, Tronbyt fallback, Nanoleaf source acceptance, `read_sessions` and suggestions exclusion. Evidence: the dashboard, Tidbyt, Nanoleaf and companions suites pass; LIFX and Pixoo suites pass unchanged.

## 6. Documentation, acceptance and archive

- [x] 6.1 Update the contracts README and MAPPING, the companions README, the runtime README and UPGRADE.md, the `core_sessions` tool description and the provider-qualification notes. Evidence: readback (the MAPPING, runtime README and tool description passages were completed in review round 1 on PR 2012).
- [x] 6.2 Previous-release reader: the read function built from `e72f33fd` reads every Codex and Claude record the case set expects the core to publish and skips every native `session/3.1` record. Evidence: recorded in the PR. The disposable runtime exercise (a synthetic task through each state on the dashboard, and a previous-release read helper process with a native task present) belongs to the independent acceptance review.
- [x] 6.3 Sync the deltas and archive the change on the branch. Evidence: `npm run check:workflow` and `npm run test:workflow` pass after the archive.

## 7. Conversation sessions (owner decision, 2026-11-21 and 2026-11-22)

- [x] 7.1 Rework the mapping: one session per profile's conversation with the conversation ID as session ID and ordering epoch, one turn per task, `activity-observed` for an answer or a resume, the earlier task's end before the next task's start, `assistant_reports` keyed by conversation, and a first-start report of a task waiting on the owner. Evidence: `test:companions:built` passes with the conversation, answer, resume, ordering, first-start and per-profile tests.
- [x] 7.2 Let ordered work evidence on the session's turn, newer than the observation that made the activity `lost`, settle it, and rewrite the native cases of the shared case set for conversations, including a resume after an uncertain call, a late older observation after a newer `lost` marker (`native-lost-order`), the next task's turn and expiry with reappearance on one ordering sequence. Evidence: the case-set tests pass for the core and every reader.
- [x] 7.3 Update this design, the synced specifications, the companions README, the contracts README and MAPPING, the runtime README and UPGRADE.md and the provider-qualification notes. Evidence: readback, `npm run check:workflow` and `npm run test:workflow` pass.

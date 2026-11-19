## 1. Design checkpoint

- [x] 1.1 Write the input/state mapping, versions, binding, expiry, capacity and previous-release helper design (design.md). Evidence: this change at the checkpoint commit.
- [x] 1.2 Record the owner's answers to questions 1 to 5, the coordinator's question 6 and the order with #1947 in design.md. Evidence: design.md "Decisions on the open questions".
- [ ] 1.3 After #1947 merges, start from the main that contains it; rebase the `bunny-message-profile` and `bunny-runtime` deltas onto #1947's text. Evidence: `npm run check:workflow` passes.

## 2. Contracts

- [ ] 2.1 Red: source, schema-equality, status and read-function tests for the native source, `session/3.1`, `lifecycle/2.2` and the 2.1 occurrences fail. Evidence: `npm run test:events:built` fails on the new cases.
- [ ] 2.2 Add the source entry, the schemas, the family registrations and types, the rule 3 detail and `readSession`'s 3.1 reading. Evidence: `npm run test:events:built`, `npm run test:events:python`, `npm run test:contracts`, `npm run test:contracts:python` pass.
- [ ] 2.3 Add native cases to the shared case set: every row of decisions 3 and 4, duplicates, delay, reordering, restart, expiry, reappearance and capacity, with every reader's expected output. Evidence: the case-set tests pass for every reader.

## 3. Core

- [ ] 3.1 Red: core tests for binding, the new inputs, the terminal attention rule, the pre-acknowledged cancel notice, the ordered start recovery, per-record versions and capacity with native roots fail. Evidence: the runtime unit suite fails on them.
- [ ] 3.2 Implement the reducer, transition, record and store changes, the core and gateway binding and the companion part's native exclusion as its own predicate (decision 14). Evidence: the runtime unit and scenario suites pass under `node scripts/native-test.mjs <script> --workers 4`.

## 4. Producer

- [ ] 4.1 Red: engine tests with fake tasks and the injected clock for each task change in all three profiles, the delegation wait, restart recovery, outbox republication, the baseline of saved tasks and the same-transaction commit fail. Evidence: `test:companions:built` fails on them.
- [ ] 4.2 Implement the projection, `assistant_reports` and the observations in `#publish`. Evidence: `test:companions:built` passes.

## 5. Readers

- [ ] 5.1 Dashboard and Habitat names and the finished result in chip text, Tronbyt fallback, Nanoleaf source acceptance, `read_sessions` and suggestions exclusion. Evidence: the dashboard, Tidbyt, Nanoleaf and companions suites pass; LIFX and Pixoo suites pass unchanged.

## 6. Documentation, acceptance and archive

- [ ] 6.1 Update the contracts README and MAPPING, the companions README, the runtime README and the provider-qualification notes. Evidence: readback.
- [ ] 6.2 Disposable runtime exercise: a synthetic task through each state on the dashboard, and the previous release's Claude read helper binding and reading with a native task present. Evidence: recorded in the PR.
- [ ] 6.3 Sync the deltas and archive the change on the branch. Evidence: `npm run check:workflow` and `npm run test:workflow` pass after the archive.

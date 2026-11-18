Each numbered group is one pull request on its own `gh-1865-<step>` branch, with independent review and the selected CI. Groups 3 to 6 run in parallel with each other and with groups 7 and 8. Groups 7 and 8 merge in order, and group 9 merges last. Group 7 is the owner plan's steps 7 and 8 merged, group 8 is the plan's step 9 and group 9 is the plan's step 10. Every merged group leaves main installable. Each task names its evidence. Behavior changes start with a failing case that the change turns green. Reviews and CI receipts go in each pull request, not in this file.

## 0. Design

- [x] 0.1 Merge this change as an active OpenSpec change after independent review. Evidence: `npm run check:workflow` and `npm run test:workflow` exit zero, and the review verdicts are in the design pull request.
- [x] 0.2 The coordinator confirms that decision 2 lands in group 4. Evidence: the confirmation recorded on #1865, and `design.md` updated if it differs. Confirmed in [#1865 comment 6984552157](https://github.com/jimmie-potts/agent-device-hub/issues/1865#issuecomment-6984552157) (2026-11-18); placement unchanged, so `design.md` needs no change.

## 1. Contract and shared read function

- [x] 1.1 Add the supported-source definition (`packages/event-contracts/src/v2/sources.ts`) and a contract test that the `Identity` type and the `session` and `lifecycle` schema enums match it. Evidence: the test fails when one enum differs.
- [x] 1.2 Add `session/3.0` (schema, types, registration beside 2.0 and 2.1, validator rules from design decision 3) and the status function. Evidence: valid and invalid 3.0 fixtures, including a status that disagrees with its claims and an unknown detail token.
- [x] 1.3 Add `readSession`, `forConsumer`, `opportunityMatches`, and `highestStatus` and `sessionState` reimplemented over the view, reading `session/2.0` and `2.1`. Evidence: the existing status tests pass unchanged, because group 1 leaves the live helper in `status.ts` on today's rule, an inertness test over the case set shows it gives main's results, and the 2.x mapping cases (waiting, working, restart, children) give the claims design decision 4 names.
- [x] 1.4 Add the shared synthetic case set (`packages/event-contracts/fixtures/v2/session-cases.json`) with the cases design decision 10 lists, each with expected records, the occurrence sequence and the reader outputs, plus a loader that reader tests share. Evidence: the contracts suite runs every case's reader expectations through the shared function.
- [x] 1.5 Run `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:events:built`, `npm run test:events:python` and the workflow checks. Evidence: exit codes in the pull request.

## 2. Hook adapter in the runtime

- [ ] 2.1 Add golden tests that run every hook fixture, producer lifecycle version and title source through today's path (`normalizeHook` or `enrichHook`, then `observationOf`) and record the observation bytes. Evidence: the golden files.
- [ ] 2.2 Move the normalizer and title reader into `apps/runtime/src/hook/`. Build the observation directly from the supported-source definition and drop the runtime's import of `@jimmie-potts/agent-state/providers` and `observationOf`. Evidence: the golden tests pass byte for byte, `@jimmie-potts/runtime/hook` still loads no other runtime code, and the hook latency check passes.
- [ ] 2.3 Keep `mac-codex-hook.mjs`, the producer file reader and the read-receipt helpers' producer handling unchanged. Evidence: the runtime hook and remote-hook suites pass unchanged.
- [ ] 2.4 Coordinate with #1847's owner: the pull request names the moved title code and confirms identical output.

## 3. Readers: Nanoleaf, Pixoo, Tidbyt and LIFX

- [ ] 3.1 Tronbyt tile: read through `readSession`. Mark `?` only for unknown status, unconfirmed work or an unsynced copy. Evidence: a case where a question has been silent for six minutes renders without `?` (red before the change), and the golden frames are updated only where the policy changes.
- [ ] 3.2 Pixoo Monitor: apply the marker rule of design decision 10. Evidence: the case set rows, and a root with an unknown parent and no other doubt shows no marker (red before).
- [ ] 3.3 Nanoleaf: feed each task the hub's status through `readSession` and `forConsumer` with Nanoleaf's acknowledgment policy, and remove Nanoleaf's own freshness rules (`shared-input.ts:374`, `:436`, and the stale retention with its exceptions at `:445-461`). Evidence: a waiting task and an unread finished task each keep their Lines indication past five minutes of silence (red before), a task whose work is unconfirmed holds steady, a task whose status is unknown, a new one included, shows idle at once, and a resync replays no wave or comet.
- [ ] 3.4 Amend the Nanoleaf preservation line in `AGENTS.md`: the Lines follow the hub's shared status, so waiting and unread tasks keep their indication until that status changes; other preserved Nanoleaf behavior stays. Evidence: instruction readback in the pull request.
- [ ] 3.5 LIFX: run the case set through `highestStatus` with no code change. Evidence: the LIFX module suite passes the shared cases.
- [ ] 3.6 Run the module suites (`test:tidbyt-module:built`, `test:pixoo:built`, `test:nanoleaf:built`, `test:lifx-module:built`) and a disposable acceptance exercise with synthetic sessions on simulated devices.
- [ ] 3.7 Before any live reader moves onto the view, and before this change is archived, apply the owner's answer on status rule 3 (design.md, "Rule 3 pending the owner") in `noticeCounts` and settle the `bunny-message-profile` scenarios "The copied status cases on session records" and "The same colors and ranking as 1.x": make them true over the view, or reword them to the answer, and remove their pending notes. Evidence: the owner's answer recorded on #1865, the case set and `status.test.mjs` passing over the view or the reworded scenarios, and `npm run openspec -- validate gh-1865-flat-session-state --strict` exiting zero.

## 4. Readers: companions, Reachy and MicroDuck (focused second review: device-command safety)

- [ ] 4.1 The core's companion part raises coding opportunities without its freshness and restart terms, with the existing `companion-opportunity/2.0` contract and host-clock checks unchanged. Evidence: a question raised by a session whose work is unconfirmed yields an opportunity (red before), and a host clock ahead of the hub's still drops the opportunity, as the design's known limit states.
- [ ] 4.2 Companions: replace the freshness and session-age terms with `opportunityMatches`, and apply the 30-second question window from admitted coding-attention opportunities in the module, the browser speech check and the suggestion model. Evidence: mock-clock cases show priority at 29 s and none at 30 s, no renewal from unrelated progress, no new window after a restart, and the question stays visible.
- [ ] 4.3 `read_sessions` reports the shared status class and detail. Evidence: the assistant tool test.
- [ ] 4.4 Reachy and MicroDuck: use `opportunityMatches` plus their own device conditions. Remove the freshness terms and MicroDuck's session-count rule. Evidence: MicroDuck gestures for one matching session among several (red before), and no gesture for a mismatched generation, a cleared attention item, an expired opportunity, Quiet or takeover.
- [ ] 4.5 Coordinate with #627's owner before editing the robot modules.
- [ ] 4.6 Run `test:companions:built`, `test:reachy:built`, `test:microduck:built` and their browser suites, `test:runtime:built`, and a disposable acceptance exercise showing that progress and reconnect produce no duplicate speech or gesture.

## 5. Readers: dashboard, gateway, MCP and core parts

- [ ] 5.1 Dashboard rows, status card and Habitat: read through `readSession`, with uncertainty only for unknown status, unconfirmed work or an unsynced copy. The card labels its time as the time since the last change. Evidence: dashboard tests, and Habitat bindings do not churn on progress or reconnect.
- [ ] 5.2 Notice override control: drop the freshness term and keep the synced copy, selected notice and expected-revision guard. Evidence: the control stays available for a finished session silent for ten minutes (red before).
- [ ] 5.3 Timeline: title `session/3.0` changes from `status`, keep the old-row rule and fall back otherwise. Evidence: timeline model tests with both row shapes.
- [ ] 5.4 Automations and the art alert read attention as `needs-owner`. The gateway routes, the snapshot route and `core_sessions` pass records unchanged, and `core_sessions` takes its `provider` filter from the supported-source definition. Evidence: automation and gateway tests, and the shared occurrence sequences trigger the same rules.
- [ ] 5.5 Run `test:runtime-dashboard:built` with its browser suite, `test:runtime:built` and `test:sdk:built`, and a disposable acceptance exercise of the session rows and Habitat.

## 6. Readers: Codex Desktop and the read-receipt helpers

- [ ] 6.1 Codex Desktop module: read through `readSession` with the same settle rule. Evidence: `test:codex-desktop:built` passes unchanged and runs the shared cases.
- [ ] 6.2 Read-receipt helpers: accept what `readSession` accepts and keep generation, turn, notice and receipt matching. Evidence: the helper and observer suites pass, and a record they do not accept yields no receipt and no error to the client.
- [ ] 6.3 `decideReadReceipt` (`packages/event-contracts/src/v2/read-receipts.ts`) reads the view's work state instead of the record's `activity`. Evidence: the read-receipt contract tests and the core store's receipt tests pass.

## 7. Core: session logic and storage (focused second review: storage migration, writer exclusion, device-command safety)

- [ ] 7.1 Port the reducer, retirement, child counting and owner operations into `apps/runtime/src/core/session/`, taking observations, with expiry and deadlines on the core's scheduler. Evidence: agent-state's tests, translated to observations, pass on the port.
- [ ] 7.2 Add a differential test: the same observation sequences through `toEnvelope` and `createAgentState` and through the port publish identical records and occurrence sequences with revisions and generations normalized. The test keeps its own copy of `toEnvelope` for the retained path. Evidence: the test over the shared cases and the reducer corpus.
- [ ] 7.3 Add the session and retirement-guard tables and `CoreStore.open()` at the core's start, which borrows ownership or takes the lock, creates tables, resets and loads caches. Remove `acquire`, the lease, `apply`, `#checkOwner`, the `state` row, `#matches`, `reducedKind`, the core's `toEnvelope` and the core's use of `createAgentState`; the differential test's own copy of `toEnvelope` stays. Evidence: a second runtime on the same state directory is refused, an offline tool holding the lease stops the runtime, and a full disk at open leaves the core running and refusing durable work.
- [ ] 7.4 Commit the transition result (sessions, removals, occurrences) in one transaction. Evidence: the shared occurrence sequences and the store transaction, crash and publication-refusal tests pass.
- [ ] 7.5 Take generations from the core revision. Evidence: a session recreated after the reset never reuses a generation from before it (red before).
- [ ] 7.6 Add the one-time reset. Evidence: a synthetic store shaped like an installed one (old `state` row, session `core_records`, rows in the new session and guard tables, session latest-history and span rows, pending session outbox rows, plus other parts' rows) opens with empty sessions at the stored revision plus one. Other rows are intact, nothing is published, no automation runs, and a second start changes nothing.
- [ ] 7.7 Retire the size condition of "Core save cost" and keep the time condition. Evidence: the save-cost tests.
- [ ] 7.8 Add a section to `apps/runtime/UPGRADE.md` for the reset: the one transaction, what it drops, its failure behavior, and that rollback below this step is unsupported for session data. Give the deployment owner, through the coordinator, the merged revision and the fact that its first start drops session data. Evidence: documentation readback.
- [ ] 7.9 Run `test:runtime:built`, `test:runtime:scenarios:built`, the store and full-disk suites, the hook suites, and a disposable run that starts on the synthetic installed-shaped store.

## 8. Core: restart, root starts and capacity (focused second review: storage migration, device-command safety)

- [ ] 8.1 Restart marks active work unconfirmed in one start transaction that starts no automation, and evidence from before the core's start does not confirm it again. Evidence: mock-clock cases for a restart with a question, an outcome and running work, a delayed pre-restart event and host clock skew; and the scenario catalog's `agent-hooks` restart case (`apps/runtime/tests/scenarios/catalog.ts`) keeps the finished session's status across the restart.
- [ ] 8.2 Root-start handler (#397). Evidence: launch, `/clear` and `/resume` without a prompt stay quiet (red before). Mid-turn compaction keeps the active turn, a stale start cannot replace a newer turn, child starts keep their meaning, and the Codex Mac difference is recorded.
- [ ] 8.3 Capacity for roots from any source. Evidence: synthetic roots of two sources at the limit, child refusal, finished-subtree displacement, roots never displaced, and refusal recorded as `capacity` with nothing returned to the hook.
- [ ] 8.4 Reconcile #397's source acceptance with the evidence.

## 9. Switch to `session/3.0`

- [ ] 9.1 The core publishes `session/3.0` from the stored claims, publishes only meaning changes, and runs the aging table on its timer. `readSession` switches to 3.0 in the same pull request. Evidence: the full case set on the core and every reader, and mock-clock bursts that advance private progress without revisions or history rows while confirmation changes publish.
- [ ] 9.2 Remove the 2.x mapping from the shared function, `STALE_AFTER_MS` use, `mapping.ts`, the runtime's `@jimmie-potts/agent-state` dependency and stale comments. Update `packages/event-contracts/MAPPING.md` and README, `apps/runtime/README.md`, `docs/architecture.md`, the MCP tool descriptions and the verification tooling. Evidence: build and lint, and a search shows no live reader of `freshness` or `restartUncertain`.
- [ ] 9.3 Give the deployment owner, through the coordinator, the merged revision and the fact that older host read helpers stop until updated (#1869).
- [ ] 9.4 Synchronize every affected specification and archive this change on the branch before final review. Evidence: `npm run check:workflow` and `npm run test:workflow` exit zero, with the inventory reported.
- [ ] 9.5 Run every suite named in the design's Validation section and a disposable acceptance exercise across the dashboard, Tronbyt, Pixoo, Nanoleaf and companions with synthetic sessions. Installed and physical acceptance stays with #1869.

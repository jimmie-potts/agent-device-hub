Each numbered group is one pull request on its own `gh-1865-<step>` branch, with independent review and the selected CI. Groups 3 to 6 run in parallel with each other and with groups 7 to 9. Groups 7, 8 and 9 merge in order, and group 10 merges last. Every merged group leaves main installable. Each task names its evidence. Behavior changes start with a failing case that the change turns green. Reviews and CI receipts go in each pull request, not in this file.

## 0. Design

- [ ] 0.1 Merge this change as an active OpenSpec change after independent review. Evidence: `npm run check:workflow` and `npm run test:workflow` exit zero, and the review verdicts are in the design pull request.
- [ ] 0.2 Owner answers open question 1 (Nanoleaf unread tasks), and the coordinator confirms question 2 (decision 2 lands in group 4). Evidence: the answers recorded on #1865, and `design.md` updated if they differ from the recommendations.

## 1. Contract and shared read function

- [ ] 1.1 Add the supported-source definition (`packages/event-contracts/src/v2/sources.ts`) and a contract test that the `Identity` type and the `session` and `lifecycle` schema enums match it. Evidence: the test fails when one enum differs.
- [ ] 1.2 Add `session/3.0` (schema, types, registration beside 2.0 and 2.1, validator rules from design decision 3) and the status function. Evidence: valid and invalid 3.0 fixtures, including a status that disagrees with its claims and an unknown detail token.
- [ ] 1.3 Add `readSession`, `forConsumer`, `opportunityMatches`, and `highestStatus` and `sessionState` reimplemented over the view, reading `session/2.0` and `2.1`. Evidence: the existing status tests pass unchanged over the view, and the 2.x mapping cases (waiting, working, restart, children) give the claims design decision 4 names.
- [ ] 1.4 Add the shared synthetic case set (`packages/event-contracts/fixtures/v2/session-cases.json`) with the cases design decision 10 lists, each with expected records, the occurrence sequence and the reader outputs, plus a loader that reader tests share. Evidence: the contracts suite runs every case's reader expectations through the shared function.
- [ ] 1.5 Run `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run test:events:built`, `npm run test:events:python` and the workflow checks. Evidence: exit codes in the pull request.

## 2. Hook adapter in the runtime

- [ ] 2.1 Add golden tests that run every hook fixture, producer lifecycle version and title source through today's path (`normalizeHook` or `enrichHook`, then `observationOf`) and record the observation bytes. Evidence: the golden files.
- [ ] 2.2 Move the normalizer and title reader into `apps/runtime/src/hook/`. Build the observation directly from the supported-source definition and drop the runtime's import of `@jimmie-potts/agent-state/providers` and `observationOf`. Evidence: the golden tests pass byte for byte, `@jimmie-potts/runtime/hook` still loads no other runtime code, and the hook latency check passes.
- [ ] 2.3 Keep `mac-codex-hook.mjs`, the producer file reader and the read-receipt helpers' producer handling unchanged. Evidence: the runtime hook and remote-hook suites pass unchanged.
- [ ] 2.4 Coordinate with #1847's owner: the pull request names the moved title code and confirms identical output.

## 3. Readers: Nanoleaf, Pixoo, Tidbyt and LIFX

- [ ] 3.1 Tronbyt tile: read through `readSession`. Mark `?` only for unknown status, unconfirmed work or an unsynced copy. Evidence: a case where a question has been silent for six minutes renders without `?` (red before the change), and the golden frames are updated only where the policy changes.
- [ ] 3.2 Pixoo Monitor: apply the marker rule of design decision 10. Evidence: the case set rows, and a root with an unknown parent and no other doubt shows no marker (red before).
- [ ] 3.3 Nanoleaf: adapt `sharedSession` at the feed boundary so attention never goes stale with silence, and apply the owner's answer to open question 1 for unread tasks. Evidence: a waiting task's Line keeps its alert animation past five minutes of silence, working tasks still go steady when unconfirmed, and a resync replays no wave or comet.
- [ ] 3.4 Amend the Nanoleaf preservation line in `AGENTS.md` for the accepted waiting (and, if accepted, unread) indication. Evidence: instruction readback in the pull request.
- [ ] 3.5 LIFX: run the case set through `highestStatus` with no code change. Evidence: the LIFX module suite passes the shared cases.
- [ ] 3.6 Run the module suites (`test:tidbyt-module:built`, `test:pixoo:built`, `test:nanoleaf:built`, `test:lifx-module:built`) and a disposable acceptance exercise with synthetic sessions on simulated devices.

## 4. Readers: companions, Reachy and MicroDuck (focused second review: device-command safety)

- [ ] 4.1 Add `companion-opportunity/2.1` with `receivedAtMs`. The core's companion part raises coding opportunities without freshness terms, anchored on the occurrence message's `time`. Evidence: a host clock two minutes behind still yields a 30-second opportunity (red before), and 2.0 messages still validate.
- [ ] 4.2 Companions: replace the freshness and session-age terms with `opportunityMatches`, and apply the 30-second question window from admitted coding-attention opportunities in the module, the browser speech check and the suggestion model. Evidence: mock-clock cases show priority at 29 s and none at 30 s, no renewal from unrelated progress, no new window after a restart, and the question stays visible.
- [ ] 4.3 `read_sessions` reports the shared status class and detail. Evidence: the assistant tool test.
- [ ] 4.4 Reachy and MicroDuck: use `opportunityMatches` plus their own device conditions. Remove the freshness terms and MicroDuck's session-count rule. Evidence: MicroDuck gestures for one matching session among several (red before), and no gesture for a mismatched generation, a cleared attention item, an expired opportunity, Quiet or takeover.
- [ ] 4.5 Coordinate with #627's owner before editing the robot modules.
- [ ] 4.6 Run `test:companions:built`, `test:reachy:built`, `test:microduck:built` and their browser suites, `test:runtime:built`, and a disposable acceptance exercise showing that progress and reconnect produce no duplicate speech or gesture.

## 5. Readers: dashboard, gateway, MCP and core parts

- [ ] 5.1 Dashboard rows, status card and Habitat: read through `readSession`, with uncertainty only for unknown status, unconfirmed work or an unsynced copy. Evidence: dashboard tests, and Habitat bindings do not churn on progress or reconnect.
- [ ] 5.2 Notice override control: drop the freshness term and keep the synced copy, selected notice and expected-revision guard. Evidence: the control stays available for a finished session silent for ten minutes (red before).
- [ ] 5.3 Timeline: title `session/3.0` changes from `status`, keep the old-row rule and fall back otherwise. Evidence: timeline model tests with both row shapes.
- [ ] 5.4 Automations and the art alert read attention as `needs-owner`. The gateway routes, the snapshot route and `core_sessions` pass records unchanged. Evidence: automation and gateway tests, and the shared occurrence sequences trigger the same rules.
- [ ] 5.5 Run `test:runtime-dashboard:built` with its browser suite, `test:runtime:built` and `test:sdk:built`, and a disposable acceptance exercise of the session rows and Habitat.

## 6. Readers: Codex Desktop and the read-receipt helpers

- [ ] 6.1 Codex Desktop module: read through `readSession` with the same settle rule. Evidence: `test:codex-desktop:built` passes unchanged and runs the shared cases.
- [ ] 6.2 Read-receipt helpers: accept what `readSession` accepts and keep generation, turn, notice and receipt matching. Evidence: the helper and observer suites pass, and a record they do not accept yields no receipt and no error to the client.

## 7. Core: observations straight into the session logic (focused second review: device-command safety)

- [ ] 7.1 Port the reducer, retirement, child counting and owner operations into `apps/runtime/src/core/session/`, taking observations. Expiry and deadlines run on the core's scheduler. Evidence: agent-state's tests, translated to observations, pass on the port.
- [ ] 7.2 Keep agent-state's storage contract: the ported owner leases `CoreStore` and commits the same 2.1 state row, with semantic keys hashed from the same canonical content. Evidence: a store written before step 7 opens and keeps recognizing a semantic duplicate.
- [ ] 7.3 Add a differential test: the same observation sequences through `toEnvelope` and `createAgentState` and through the port publish identical records and occurrence sequences. Evidence: the test over the shared cases and the reducer corpus.
- [ ] 7.4 Remove `toEnvelope`, `reducedKind` and the core's use of `createAgentState`. Evidence: `apps/runtime/src/core` imports nothing from `@jimmie-potts/agent-state` except storage types still needed until step 8.
- [ ] 7.5 Run `test:runtime:built`, `test:runtime:scenarios:built` and the hook suites.

## 8. Core: session data in core tables (focused second review: storage migration, writer exclusion, device-command safety)

- [ ] 8.1 Add the session and retirement tables and `CoreStore.open()` at the core's start, which borrows ownership or takes the lock, creates tables, resets and loads caches. Remove `acquire`, the lease, `apply`, `#checkOwner`, the `state` row and `#matches`. Evidence: a second runtime on the same state directory is refused, an offline tool holding the lease stops the runtime, and a full disk at open leaves the core running and refusing durable work.
- [ ] 8.2 Commit the transition result (sessions, removals, occurrences) in one transaction. Evidence: the shared occurrence sequences and the store transaction, crash and publication-refusal tests pass unchanged.
- [ ] 8.3 Take generations from the core revision. Evidence: a session recreated after the reset never reuses a generation from before it (red before).
- [ ] 8.4 Add the one-time reset. Evidence: a synthetic store shaped like an installed one (old `state` row, session `core_records`, session latest-history and span rows, pending session outbox rows, plus other parts' rows) opens with empty sessions. Other rows are intact, nothing is published, no automation runs, and a second start changes nothing.
- [ ] 8.5 Update "Core save cost" measurement for row saves. Evidence: the save-cost tests.
- [ ] 8.6 Give the deployment owner, through the coordinator, the merged revision and the fact that its first start drops session data.
- [ ] 8.7 Run `test:runtime:built`, `test:runtime:scenarios:built`, the store and full-disk suites, and a disposable run that starts on the synthetic installed-shaped store.

## 9. Core: restart, root starts and capacity

- [ ] 9.1 Restart marks active work unconfirmed in one start transaction, and evidence from before the core's start does not confirm it again. Evidence: mock-clock cases for a restart with a question, an outcome and running work, a delayed pre-restart event, and host clock skew.
- [ ] 9.2 Root-start handler (#397). Evidence: launch, `/clear` and `/resume` without a prompt stay quiet (red before). Mid-turn compaction keeps the active turn, a stale start cannot replace a newer turn, child starts keep their meaning, and the Codex Mac difference is recorded.
- [ ] 9.3 Capacity for roots from any source. Evidence: synthetic roots of two sources at the limit, child refusal, finished-subtree displacement, roots never displaced, and refusal recorded as `capacity` with nothing returned to the hook.
- [ ] 9.4 Reconcile #397's source acceptance with the evidence.

## 10. Switch to `session/3.0` (focused second review: device-command safety and storage)

- [ ] 10.1 The core publishes `session/3.0` from the stored claims, publishes only meaning changes, and runs the aging table on its timer. `readSession` switches to 3.0 in the same pull request. Evidence: the full case set on the core and every reader, and mock-clock bursts that advance private progress without revisions or history rows while confirmation changes publish.
- [ ] 10.2 Clear the session family's latest-history and span rows that still hold the 2.x shape. Evidence: the first 3.0 row of a session has `previous: null`, and old rows are untouched.
- [ ] 10.3 Remove the 2.x mapping from the shared function, `STALE_AFTER_MS` use, `mapping.ts`, the runtime's `@jimmie-potts/agent-state` dependency and stale comments. Update `packages/event-contracts/MAPPING.md` and README, `apps/runtime/README.md`, `docs/architecture.md`, the MCP tool descriptions and the verification tooling. Evidence: build and lint, and a search shows no live reader of `freshness` or `restartUncertain`.
- [ ] 10.4 Give the deployment owner, through the coordinator, the merged revision and the fact that older host read helpers stop until updated (#1869).
- [ ] 10.5 Synchronize every affected specification and archive this change on the branch before final review. Evidence: `npm run check:workflow` and `npm run test:workflow` exit zero, with the inventory reported.
- [ ] 10.6 Run every suite named in the design's Validation section and a disposable acceptance exercise across the dashboard, Tronbyt, Pixoo, Nanoleaf and companions with synthetic sessions. Installed and physical acceptance stays with #1869.

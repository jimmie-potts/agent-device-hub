## 1. Contracts

- [x] 1.1 Assert the `outcome-recorded` family's valid message and its refusals from another source, with another subject and without an ID, and a turn-ended inbox item refused as `invalid-message` (`packages/event-contracts/tests/families.test.mjs` over `fixtures/v2/families.json`).
- [x] 1.2 Add the `outcome-recorded` core family with its schema, check, `CORE_SOURCE` and `outcomeRecordedKey`; remove the turn-ended inbox variant from the schema, the `InboxItem` type, its check, the fixtures, the deleted-item scenario, README.md and MAPPING.md's `notices` row.

## 2. SDK

- [x] 2.1 Assert that `republish()` follows the core's acknowledgments, forgets an outcome only on the core's, records a forged one, recovers a lost one at the next start, and that a remote outbox with `edgeValidator()` never holds an outcome behind a refused message (`packages/sdk/tests/outbox.test.ts`).
- [x] 2.2 Follow the acknowledgments in `Outbox.republish()` with the sender check; add `acknowledgmentOf`, `acknowledgment` and `edgeValidator`.
- [x] 2.3 Assert the kit's acknowledgment check, and that it catches a deaf outbox and a module that trusts the payload (`kit.test.ts`); add the check and remove the stand-in acknowledgment.

## 3. Runtime core

- [x] 3.1 Assert every transition of the state machine: completed, rejected, expired, uncertain at both deadlines, late definitive and uncertain outcomes, conflicts in either order, an identical retransmission and a reply after an outcome (`apps/runtime/tests/operations.test.ts`).
- [x] 3.2 Add `operations.ts`, the per-kind deadlines and the state machine.
- [x] 3.3 Assert the dispatcher and tracker under the runtime: each step with its history rows and parts' changes, a refusal, a stopped module, an expiry, an outcome deadline, a restart while pending, a module crash between saving and reporting, a resent outcome, conflicts, a reused `(source, id)`, one request ID per action, what is no tracked action, a full disk and the intake record's trace (`tracker.test.ts`, with the scripted gadget module).
- [x] 3.4 Add `tracker.ts` (dispatcher, tracker, intake, acknowledgment, deadlines) and `history.ts` (compact change events), record every publication of the core store in history, and give parts `tracked`, `dispatch` and `operation`.
- [x] 3.5 Assert history's compact change events for another module's states and the core's own (`tracker.test.ts`, `core-store.test.ts`).

## 4. Gateway

- [x] 4.1 Assert the action route and MCP's `core_send_command`: an operator's action tracked as its own, one request ID per action, registry codes for invalid input, direct device commands and mode changes `forbidden` at the edge, and `unavailable` without the core (`actions.test.ts`); update the MCP listing and the edge tests that requested device keys (`gateway.test.ts`, `diagnostics.test.ts`, `tracing.test.ts`).
- [x] 4.2 Serve `POST /api/v2/commands/<family>` and `core_send_command` through the core's dispatcher, narrow `control` to `DIRECT_COMMANDS`, and point the route map's command routes at the action route.

## 5. Fixtures and tiers

- [x] 5.1 Name the fixture lamp's command family `lamp-switch`, let its outbox follow the core's acknowledgments, and derive the fixture core's stand-in history copy and inbox items from the tracker's changes; drop LIFX's `acknowledgments` option.
- [x] 5.2 Add `Harness.dispatch` to both harnesses, send every catalog device command through it, and update the end-to-end, playback, LIFX and grants scenarios (`npm run test:runtime:scenarios:built`).
- [x] 5.3 Send the follow proof's commands through the dispatcher, and assert that a trace query finds the core's `message.received` (`verify/tests/follow.test.ts`).

## 6. Documentation and checks

- [x] 6.1 Update the runtime, SDK, verify, LIFX and playback READMEs and the event contracts' README and MAPPING.md.
- [x] 6.2 Run the gate from the worktree root: build, typecheck, `lint:js`, the SDK, runtime, scenario, verify, events, maintenance and module suites, MCP's three suites, `test:workflow`, `check:workflow` and `openspec validate --specs --strict`.

## 7. Review round 1

- [x] 7.1 Assert that 600 messages in one turn reach history in a few grouped commits while a timer runs between them (`tracker.test.ts`), that a service process at the default lag limit stays up through the same burst (`process.test.ts`), that each message keeps its verdict within a group, that a part failing on one outcome refuses it alone, that an overflow logs `operation.failed` with `capacity`, and that a refused intake on a full disk is WARN.
- [x] 7.2 Commit the intake in bounded groups with a turn between them, retry a group that fails for anything but a full disk one message at a time, log refusals at their code's level and record an intake queue overflow; update the runtime spec, the design and the runtime README.

## 1. Engine

- [x] 1.1 Red: concurrency tests for three conversations at once, per-conversation capacity, cancellation fences, disable, restart, spend reservations, Anthropic refusals, session reports, reply lines and arrival-order approvals fail on the single gate. Evidence: `assistant-concurrency.test.js` fails 9 of 9 with the second start refused `capacity`.
- [x] 1.2 Key the running slot and recovery by conversation. Evidence: the same tests pass, and the companions module suite passes.

## 2. Qualification

- [x] 2.1 Red: the qualification test with three graphs, mixed reply order, an abrupt exit and a restart fails on the single gate. Evidence: the crash fixture's second start is refused `capacity` (negative control).
- [x] 2.2 Evidence: with the change, the test shows no cross-talk in checkpoints, per-turn counts, spend reservations, cancellation fences, titles or session reports.

## 3. Speech

- [x] 3.1 Red: speech coordinator tests for one waiting reply per conversation, arrival order, the card slot and highest rank first fail on the single pending candidate. Evidence: two tests fail against the earlier coordinator.
- [x] 3.2 Keep one waiting reply per conversation beside the card slot. Evidence: `speech-coordinator.test.js` passes.

## 4. Page and documentation

- [x] 4.1 Drop the cross-profile start gate and list each unfinished conversation by Disable. Evidence: the conversation history and conversation state browser journeys pass in `npm run test:companions:browser`.
- [x] 4.2 Update the companions README, `docs/architecture.md` and `docs/development.md`. Evidence: readback.
- [x] 4.3 Synchronize `bunny-assistant-tasks` and `bunny-companions` and archive this change. Evidence: `npm run check:workflow` passes.

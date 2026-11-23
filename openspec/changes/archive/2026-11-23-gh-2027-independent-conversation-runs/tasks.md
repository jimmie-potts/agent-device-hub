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

## 5. Review round 1

- [x] 5.1 Red: a step in another conversation refuses a start, answer, rename, Read aloud or cancel as a revision conflict. Evidence: the new concurrency test fails on the assistant-wide check.
- [x] 5.2 Check each conversation's command against its own last change. Evidence: the same test passes, with stale same-conversation, future and disable commands refused.
- [x] 5.3 Red: a mutation that recovers only the first unfinished task passes every test. Evidence: with two conversations' calls lost in the crash, the qualification test fails on that mutation and passes without it.
- [x] 5.4 Red: one conversation's unreadable checkpoint makes the whole assistant unavailable. Evidence: the new recovery test fails, then passes with the failure scoped to its conversation.
- [x] 5.5 Close the narrow Details overlay from Go to, and leave the open conversation out of the list. Evidence: the conversation history journey at phone width and the conversation state journey pass.
- [x] 5.6 Wait in the new speech tests by yielding turns instead of real timers; add the #2027 rollback note to `apps/runtime/UPGRADE.md` and the two-delegation case to the companions README. Evidence: readback and `speech-coordinator.test.js`.

## 6. Review round 2

- [x] 6.1 Red: a second rename bound to the same revision is accepted; a failed recovery writes no message; a command for a finished conversation bound to a revision from before a restart is accepted. Evidence: the three concurrency tests fail.
- [x] 6.2 Mark a renamed conversation, write one recovery message per failed start, and raise every conversation's row at each start. Evidence: the same tests pass.

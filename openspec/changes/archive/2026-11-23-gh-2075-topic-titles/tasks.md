## 1. Tests first

- [x] 1.1 Red: rewrite `conversation-titles.test.ts` for the prompt with the current title, its source and event labels, KEEP, the labels, and engine tests on the manual clock with a scripted fake title provider: keep, new title, rename then topic change, coalescing, a late answer after a rename or a newer check, spend refusals, major events and the hand-off result. Evidence: against the #2025 engine with only the new names stubbed, 17 of 23 tests fail, including the negative control ("the third task's start makes no title call", 2 !== 1) (PR).

## 2. Implementation

- [x] 2.1 `titles.ts`: the fixed instruction with KEEP and the owner's-title rule, the prompt header, fixed event labels, KEEP parsing, one run per conversation with a coalesced follow-up, a generation per admitted check, a rename that drops the waiting follow-up, and no task count. Evidence: `conversation-titles.test.js` passes.
- [x] 2.2 `engine.ts`: checks after the first message of an untitled conversation, each finished task, an answered approval, an accepted state-changing tool call, an accepted hand-off and a hand-off's result, and none during startup reconciliation. Evidence: `conversation-titles.test.js` passes 23 of 23, 20 repeated runs pass.
- [x] 2.3 Update `configure.test.ts` and the concurrency qualification for the extra finished-task check. Evidence: `npm run test:companions:built` passes.
- [x] 2.4 Conversation details help text. Evidence: readback.

## 3. Documentation and archive

- [x] 3.1 Companions README "Conversation titles" and checks, `THIRD-PARTY-NOTICES.md`, `docs/development.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [x] 3.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.

## 4. Review round 1 on PR 2078

- [x] 4.1 A trigger that lands after a call's last settle step is never lost: the run leaves its slot in the step that finds no trigger waiting. Evidence: the new microtask-delay test in `conversation-titles.test.js` passes for delays 0 to 40; before the fix it lost the trigger at delay 5 (PR).
- [x] 4.2 Startup reconciliation that finds a finished turn starts no title check. Evidence: the restart test passes; with the starting guard removed from the built engine it fails, 3 calls instead of 2 (PR).
- [x] 4.3 A hand-off left pending at the last stop is settled at start without a title check; the coordinator marks that delivery. Evidence: the restart test passes; without the mark it fails with the label "A coding hand-off's result arrived: uncertain." (PR).

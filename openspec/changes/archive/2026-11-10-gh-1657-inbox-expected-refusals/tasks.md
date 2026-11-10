## 1. Shared rule and open rule

- [x] 1.1 Write failing tests for #1657 AC1 to AC4: a scheduled art moment refused `invalid-state` (`art-handoff.test.ts`), core-dispatched Music lighting work refused `invalid-state` (`music-lighting.test.ts`), an unconfirmed speech line (`companion-speech.test.ts`), a stale mode change from the dashboard path and the assistant (`mode-runtime.test.ts`, `assistant-dispatch.test.ts`) and the predicate table (`inbox-rule.test.ts`), with kept cases for uncertain holds, conflicts, failures after acceptance, expired commands and refusals the dashboard can send again.
- [x] 1.2 Move the dispatcher's requester checks unchanged into `requesterRefusal` and add `resendRefusal` and `historyOnly` in `inbox.ts`. Send again and the open rule both read them. Verify with the tests above, `tracker.test.ts` and the existing inbox and hold tests.
- [x] 1.3 Keep the committed-handling-then-fresh-refusal check with a scripted device in `tracker.test.ts`, since the stale mode path no longer exercises it.

## 2. Assistant mode change

- [x] 2.1 Bind an approved assistant mode change to the Hub-mode revision current when it is sent, send nothing without a synced copy, and explain a remaining `revision-conflict` in the tool result. Verify with `modules/companions/tests/assistant.test.ts`.

## 3. Documentation and delivery

- [x] 3.1 Update the runtime README, the dashboard README's Inbox section and ADR 0012's Inbox paragraph where their facts change.
- [x] 3.2 Run build, typecheck, lint, workflow checks and the runtime and companions suites, and record the actual results.
- [x] 3.3 Sync and archive this change on the delivery branch. Independent review, merge and installation follow outside this change.

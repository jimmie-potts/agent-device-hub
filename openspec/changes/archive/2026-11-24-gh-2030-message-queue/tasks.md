## 1. Tests first

- [x] 1.1 `assistant-queue.test.ts`: queue while running and at once when idle; edit, withdraw and reorder against the queue revision, with a conversation command as the negative control; waits through a question and an approval; Stop and Resume queue; an empty queue at Stop and a withdrawn last message; restart hold, stale revision and Start; a repeated queue command; the turn end before the next turn's start; a spend refusal at start; no title check for a queued start, with a direct Send as the negative control; New conversation and the limit; a failed task. `assistant-queue-child.ts` exits after the commit that started a queued message. Evidence: red runs in the PR.
- [x] 1.2 `message-queue.test.mjs` for both contract versions, a gateway case, and `conversation-queue.test.ts` for the page's decoder. Evidence: they pass.

## 2. Implementation

- [x] 2.1 Contracts: `assistant-control/2.2`, `assistant-state/2.2`, types and registration; the gateway's version selection and the state-family classification. Evidence: the contract and gateway tests pass.
- [x] 2.2 Module: `queue.ts`, the engine's queue input, edit, withdraw, reorder, resume, Stop and restart holds, dispatch in the ending commit, the deferred launch, the queue read and state summary. Evidence: `assistant-queue.test.js` passes.
- [x] 2.3 Page: Queue beside Send, the queued list with Edit, Move up, Move down and Withdraw, the hold with Resume queue or Start, cleared drafts, and the transcript's follow when the composer grows. Evidence: `conversation-queue.browser.ts` passes at 1280 and 390 px.

## 3. Documentation and archive

- [x] 3.1 Companions README and notices, event contracts README, `docs/development.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [x] 3.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.

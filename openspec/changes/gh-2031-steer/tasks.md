## 1. Tests first

- [x] 1.1 `assistant-steer.test.ts`: a steer during tool use, a forced call with the superseded reply and speech, a steer after the last call and one after the turn ended, Skip question and send, Decline with message and an approval's queued text, few calls left, Stop returning steers past the limit with Queue refused until below it, the steer and queue bounds, a forced call the limits refuse, stale turns, a restart, the graph upgrade, and `assistant-steer-child.ts`, which exits during the call that read a steer. `coding-slots.test.ts` adds a delegation wait with a hand-off waiting for its slot. Evidence: red runs against main in the PR.
- [x] 1.2 `steered-queue.test.mjs` for `assistant-state/2.3`, and `conversation-queue.test.ts` for the page's decoder. Evidence: they pass.

## 2. Implementation

- [x] 2.1 Contracts: `assistant-state/2.3`, registration and the state-family classification. Evidence: the contract tests pass.
- [x] 2.2 Module: `assistant_steers`, the `steer` input, the drain in the model call's admission, the forced call, the close and Stop returns, the late steer, the graph edge and upgrade. Evidence: `assistant-steer.test.js` passes.
- [x] 2.3 Page: Send steers, Skip question and send, Decline with message, the steering list and transcript labels, the queue past its limit. Evidence: `conversation-steer.browser.ts` passes at 1280 and 390 px.

## 3. Documentation and archive

- [x] 3.1 Companions README and notices, event contracts README, `docs/development.md` and `apps/runtime/UPGRADE.md`. Evidence: readback.
- [ ] 3.2 Sync and archive this change. Evidence: `npm run check:workflow` passes.

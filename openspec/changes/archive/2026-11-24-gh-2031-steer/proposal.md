## Why

A new message to a companion whose task is working is only queued today, so the owner can't redirect work without stopping it. The owner chose steering for the Conversations epic ([#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035)): Send steers a running task, a turn is one message and everything it causes, steers included, a clarification is answered from the composer with **Skip question and send** beside it, an approval queues free text with **Decline with message** beside it, and Stop returns unread steers to the queue ([#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201), decisions 1, 3, 4 and 5). Returned steers may take the queue past its limit of 8 ([#2031 comment](https://github.com/jimmie-potts/agent-device-hub/issues/2031#issuecomment-7142267166)). This change delivers [#2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031) on the queue of [#2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030).

## What Changes

- **Send** and Enter steer a task that works or waits on the coding worker. The steer is saved at once and shown above the composer, and the task's next model call takes it into its own transcript in the call's admission, after the last call's tool results. It joins the current turn.
- A steer that reaches the task before a model call's answer is saved supersedes a final answer: that answer is saved, not spoken, and one more model call reads the steer. Only the final reply is spoken.
- Unread steers go back to the head of the queue in the commit that closes or stops the turn, so a steer that arrives after the last model call starts as the next queued message. A steer that reaches its turn after the turn ended, while it is still the latest, becomes the next queued message too. A steer aimed at a turn a newer one followed is refused with `invalid-state`, as Codex's `expected_turn_id` does.
- **Skip question and send** answers a clarification with a fixed skipped result and steers; **Decline with message** declines an approval and steers; each commits in one step. During an approval a steer is queued; a delegation wait keeps the steer until the worker's result.
- A steer is queued when fewer than two model calls remain in the turn's limits. A task holds at most 8 unread steers, and its steers and the queue together at most 16.
- Queue is refused while the queue holds 8 or more; returned steers may take it to 16. `assistant-state/2.3` allows that count and is published only past 8.
- The graph becomes `conversation-2`, with the model node's edge back to itself. A start upgrades an unfinished `conversation-1` task, whose nodes and checkpoints are the same.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Conversation message queue" (Send steers instead of waiting; the queue's limit with returned steers; `assistant-state/2.3`) and the added requirement "Steering a running task".
- `bunny-message-profile`: the added requirement "Returned steers past the queue limit in assistant state".

## Impact

`packages/event-contracts`: `assistant-state/2.3` schema, registration and a test. `apps/runtime`: the state-family classification. `modules/companions`: the `assistant_steers` table in the queue store, the engine's `steer` input, the drain in the model call's admission, the forced call, the close and Stop returning steers, the graph's new edge and version upgrade, the page's Send, Skip question and send, Decline with message and steering list, and tests, including a crash child process and a browser journey. One new table, created empty; no record is rewritten except the graph version of unfinished `conversation-1` tasks. The companions README and notices, the event contracts README, `docs/development.md` and `apps/runtime/UPGRADE.md`. No new data reaches a model or cloud service: steer text reaches only the task's own provider calls, as a sent message does. Delivery is reviewed integrated source; installation joins the epic's runtime batch.

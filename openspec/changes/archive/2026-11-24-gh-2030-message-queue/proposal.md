## Why

A new message to a companion whose task is unfinished is refused today, so the owner waits for each task before saying the next thing. The owner chose queue and steer for the Conversations epic ([#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035)), with Queue as its own control beside Send, Stop holding the queue and a held queue after a restart ([#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201), decisions 1, 5 and 6). This change delivers the queue ([#2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)); steering ([#2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031)) builds on it.

## What Changes

- **Queue** beside **Send** saves the owner's message in the conversation's queue while its task works or waits; the composer stays available. Queued messages show above the composer and can be edited, withdrawn and reordered, at most 8 per conversation.
- When a task ends, succeeded or failed, the next queued message starts as a new task and turn of the same conversation in the commit that ended the task, unless the queue is held; the session reports the earlier turn's end before the next turn's start. A queued start runs no title check of its own.
- Stop (**Cancel task**) holds the queue until **Resume queue**. A start of the module holds every waiting queue until **Start** and starts no work. A queued message that cannot start, such as one the spend limits refuse with `capacity`, stays queued and holds the queue.
- A queued message is the module's own state in two new tables beside the checkpointer, never a stored command (ADR 0012): the input command completes when the message is saved. Its ID is that command's request ID, and its start and removal commit together, so it starts at most once.
- Queue commands are checked against the conversation's queue revision, so the running task's steps never make them stale. New conversation is refused with `invalid-state` while the queue holds messages.
- Contracts change by additive minors: `assistant-control/2.2` adds `withdraw`, `reorder` and `resume-queue`, and `assistant-state/2.2` adds each waiting queue's count and hold. Queuing and editing stay module-private staged inputs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Bounded execution per conversation" (the queue beside the one unfinished task, and the queue's revision scope) and "New conversation" (refused while messages are queued), plus the added requirement "Conversation message queue".
- `bunny-message-profile`: the added requirement "Conversation message queue contracts".
- `bunny-runtime`: the added requirement "Message queue controls through the gateway".

## Impact

`packages/event-contracts`: `assistant-control/2.2` and `assistant-state/2.2` schemas, types and a test. `apps/runtime`: the gateway's version selection, its test, and the state-family classification. `modules/companions`: a new `src/assistant/queue.ts` store, the engine's queue admission, dispatch at a task's end, Stop and restart holds, the queue read, the Conversation page's Queue control and queued list, the transcript's follow of the latest message when the composer grows, and tests, including a crash child process and a browser journey. Two new tables, `assistant_queued_messages` and `assistant_queues`, created empty; no record is rewritten. The companions README and notices, the event contracts README, `docs/development.md` and `apps/runtime/UPGRADE.md`. No new data reaches a model or cloud service: a queued message's text reaches the configured provider only when it starts as a task, as a sent message does. Delivery is reviewed integrated source; installation joins the epic's runtime batch.

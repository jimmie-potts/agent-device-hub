## Why

Since [#2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025), a conversation's title is written at fixed points: the first message of a session appearance, its third task, the first message after a day without lifecycle evidence and an accepted coding hand-off. An owner rename is permanent. Each companion has one long-lived conversation, so the title often names an earlier topic.

The owner decided on [#2075](https://github.com/jimmie-potts/agent-device-hub/issues/2075) ([decision](https://github.com/jimmie-potts/agent-device-hub/issues/2075#issuecomment-7116281483)) that the title follows the conversation's topic, that no fixed task count decides when it changes, that renames are not permanent, and that the small title model decides at each in-conversation or major event whether the title should change. This supersedes #2025's fixed triggers and permanent rename. Part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035).

## What Changes

- An untitled conversation is checked after its first message, as today. After that, the title model checks the title after each finished task and after each major event the module knows about: an answered approval, a tool call that changed state (a command the core accepted), an accepted coding hand-off and a hand-off's result. **BREAKING** (behavior): the third-task and day-gap triggers are removed; no trigger depends on a task count or a time gap.
- A check sends the current title and its source, fixed-form labels of the events that asked for it and the bounded recent messages #2025 already sends. No tool result, receipt or worker report is sent.
- The model answers `KEEP` or a new title. A new title passes the #2025 rules; `KEEP` publishes nothing.
- **BREAKING** (behavior): an owner rename is no longer permanent. The model is told the title is the owner's and keeps it unless the topic clearly changed; then a generated title replaces it with source `provider`. A rename still abandons a call in flight, and its waiting follow-up; an answer that arrives after a rename or a newer check is dropped.
- At most one title call runs per conversation; triggers that arrive during a call coalesce into one follow-up check.
- Spend, the persona fallback, explicit-label precedence, `lifecycle/2.3` publication, the ADR 0011 limits and the private `assistant_title_calls` record are kept. The call record gains the events it answered and the outcome `kept`. No wire contract changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Model-written conversation titles" (when a check runs, what it sends, KEEP, one call at a time) and "Owner rename of a conversation" (a rename is the current title until the model judges the topic changed).

## Impact

`modules/companions` (the title engine in `src/assistant/titles.ts`, its triggers in `src/assistant/engine.ts`, the Conversation details help text) and its tests; the companions README, `THIRD-PARTY-NOTICES.md`, `docs/development.md` and `apps/runtime/UPGRADE.md`. No table, column, section key, event contract, SDK, core or gateway change. Delivery is reviewed integrated source; installation joins the next runtime batch.

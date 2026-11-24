## Why

Each B.U.N.N.Y., Reachy and MicroDuck task sees only its own message today, so a follow-up such as "and also dim the lights" or "show that animation" lacks the subject it refers to. Each profile also has one permanent conversation. The owner chose bounded recent history plus New conversation, built so that each companion can later get its own long-term memory and personality ([#2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029), part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035)). On 2026-11-24 the owner decided that New conversation is refused while the current conversation's task is unfinished, and that the recent context holds the owner's messages, the companion's replies and earlier tool results of the current conversation, bounded and trimmed oldest first with the trim stated ([decision](https://github.com/jimmie-potts/agent-device-hub/issues/2029#issuecomment-7133283157)).

## What Changes

- One context builder assembles named sections in a fixed order for the task's companion, each with its own byte budget: the curated personality (4 KiB), the owner's knowledge notes (32 KiB, off until the owner turns them on for that companion), the active preferences (32 KiB), an empty long-term memory slot (16 KiB) and the recent conversation (48 KiB and 48 messages). The stable sections come first and the recent conversation last, before the mode line, so the hosted provider's cached prefix holds across calls and tasks.
- The recent conversation holds the current conversation's saved owner messages, replies and tool results up to the moment the task started, each with its saved message identity, its tool name when known and an artwork attachment's request identity. It never holds another conversation, another companion's messages, a companion exchange or a removed message.
- A section over its budget keeps what fits and states how many items it left out. **BREAKING** (behavior): active preferences over their budget are trimmed and the trim is stated, replacing the refusal of the whole turn with `capacity` and the `CONTEXT_TOO_LARGE` closing reply.
- A per-companion knowledge switch, off by default, set from the Companion knowledge page through a `set-context-knowledge` knowledge command checked by its own `context` revision scope.
- New conversation: a module-private `new-conversation` staged input gives the profile a fresh conversation with its own ID, and so its own session, title, running slot and change rows; recent history starts empty. It is refused with `invalid-state` while the current conversation's task is unfinished. Earlier conversations stay readable by their ID and are listed on the Conversation page's Details.
- The Companion knowledge page's model context preview reads the builder's own output for the next call. `read_saved_art` names each artwork's source request, so a follow-up can find an attached artwork's ID.
- An archive import accepts a profile's earlier conversations and never moves its current one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Configured model provider" (the sectioned prompt context and its trim), plus two added requirements, "Sectioned companion context" and "New conversation".
- `bunny-companion-knowledge`: "Curated personas and current context" (the knowledge switch and the model context preview) and "Additive private recovery" (a profile's earlier conversations).
- `bunny-preferences`: "Active-only use" (the preferences section's budget and stated trim).

## Impact

`modules/companions`: a new `src/assistant/context.ts`, the engine's context and New conversation, the store's recent read, conversation list and context switches, the Anthropic system prompt, the knowledge command and archive import, the Conversation page and Details, the Companion knowledge page, and their tests; a new runtime dashboard browser journey. One new table, `assistant_context_settings`, and an optional `contextThrough` field on new task records; `assistant_conversations` now moves to the new conversation at New conversation. No event contract, SDK, core or gateway change. The companions README, `docs/development.md` and `apps/runtime/UPGRADE.md`. Recent conversation text now reaches the configured model provider, Anthropic, which ADR 0011's 2026-10-05 amendment allows; no other provider exists. Delivery is reviewed integrated source; installation joins the epic's runtime batch.

## Why

[#2024](https://github.com/jimmie-potts/agent-device-hub/issues/2024), part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035), lets long assistant tasks finish while money stays bounded. Today a turn stops at 6 model calls and 65,536 tokens, no prompt is cached, and the module does not count spend. The owner chose to relax the per-turn caps to the doubled values, cache prompts and cap spending at $20 a day and $150 a month across all profiles. The decisions are recorded on #505: [round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201), [round 3](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7080670545) and [round 5](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7080895854).

## What changes

- The per-turn limits become 50 model calls, 40 tool calls, 10 questions, 40 minutes active, 6 minutes per model call, 30 seconds per tool call, 1,000,000 tokens, 32 KiB per owner message, a 1 MiB working transcript and 128 KiB of persona and preferences. The staging, checkpoint and page bounds grow to fit. A turn that reaches a limit ends with `capacity` and a conversation message that names the limit.
- A model call reserves its request's bytes plus framing and output units, instead of a fixed 16,384, because a token encodes at least one byte of text.
- The Anthropic adapter asks for automatic prompt caching and reports usage by class: uncached input, output, cache writes and cache reads.
- A private SQLite spend ledger reserves each paid call's most expensive cost before dispatch, in the receipt's transaction. Reported usage priced from a new required `assistant.prices` table replaces the reservation, and unreported usage keeps counting it. Calls that would pass a limit, and new paid turns at a limit, are refused with `capacity`.
- Details shows today's and this month's shared spend from a private `spend` content route, and the composer says when a paid profile's limit is reached.
- A conversation-level model call, such as #2025's titles, records its spend through the same ledger.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `bunny-assistant-tasks`: the bounded single execution, configured model provider, private reads and conversation panel requirements change, and shared spend limits are added.

## Impact

`modules/companions` (limits, engine, provider adapter, store bounds, module section and the Conversation page) and the dashboard browser journeys that check the page's bounds. No event contract, SDK, runtime or diagnostic profile changes. The installed section must add `assistant.prices` for its model before the upgrade, or the module refuses the section. Installation joins the epic's batch under #1869; source tests do not establish installed caching or spend.

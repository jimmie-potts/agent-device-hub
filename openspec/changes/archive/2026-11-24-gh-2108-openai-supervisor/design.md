## Context

The companions engine owns the bounded task transcript and effects. Messages and Responses each render and parse their own wire format. The installed runtime supplies each credential through the existing module secret boundary.

## Decisions

- Preserve the configured default. A staged Send or Queue may name the selected supervisor. The saved task and queue records pin provider, model, effort variant and prices. An unfinished hosted task of ambiguous origin stays paused.
- Send stateless Responses requests through the existing bounded transport seam. Keep encrypted reasoning and function items in the originating task. The engine tracks commands and checks exact control intent before dispatch.
- Build a Responses projection using the current owner message, explicitly relevant same-conversation excerpts and permitted facts about the requested devices. Recheck the field grants for opaque replay. Present coding worker results locally through the conversation.
- Title requests use the originating supervisor. An OpenAI title check runs for an untitled conversation with the current owner message and fixed title instructions.
- Use Standard pricing and a 30-minute prompt cache. Reserve against the full rendered request and output cap using the more expensive input class. Preserve the pinned rate with the reservation so later configuration cannot reprice an in-flight call.

## Risks / Trade-offs

Responses access is deliberately conservative when the request does not identify the relevant device or message. The companion can ask for clarification. Changing the model or effort for an existing task can leave it paused until the pinned configuration is available again. Tests replace both hosted transports with fixtures.

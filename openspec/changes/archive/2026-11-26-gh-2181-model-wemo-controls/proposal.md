## Why

[Hub #2181](https://github.com/jimmie-potts/agent-device-hub/issues/2181) lets an owner operate one or two configured Wemo plugs in ordinary Conversation. The English command matcher cannot reliably bind a named pair or a follow-up that refers to just one plug.

## What changes

- The selected supervisor interprets the current owner request using the common Conversation sharing policy.
- Companions validates a typed Wemo power proposal and sends one guarded command per selected plug through the tracked dispatcher.
- The original exchange retains an outcome for each plug across restart, including an unknown outcome when a reply is lost.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks` adds model-interpreted Wemo power control to private Conversation.

## Impact

The change covers the Companions engine and both hosted model adapters through their existing tool interfaces. The core and Wemo writer continue to own command routing, maximum-on enforcement and reported device evidence. Installed and physical verification belongs to [Hub #2184](https://github.com/jimmie-potts/agent-device-hub/issues/2184).

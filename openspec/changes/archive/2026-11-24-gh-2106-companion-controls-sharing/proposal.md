## Why

The owner should be able to control the configured Hub in any private Conversation. Companion choice changes the persona and conversation. Each disclosure still depends on the owner's sharing choices.

## What Changes

- Apply the same configured control catalog to all three companions and check capability again at execution.
- Dispatch explicit owner control requests through the tracked command path with the resolved target, settings and revision. Ask when a required detail is ambiguous.
- Keep separate authorization for coding, paid generation and onward sharing. Check the destination before disclosing fields, including fields from earlier turns.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks`: Direct owner controls, available tool details, and field grants for private Conversation.

## Impact

The companions module, the Conversation details panel and the existing typed runtime dispatcher are in scope. [Hub #2106](https://github.com/jimmie-potts/agent-device-hub/issues/2106) owns delivery and [ADR 0011](../../../docs/decisions/0011-private-personal-data-retention.md) owns sharing.

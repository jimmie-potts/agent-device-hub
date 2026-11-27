## Why

[Hub #2193](https://github.com/jimmie-potts/agent-device-hub/issues/2193) gives Conversation and authenticated MCP clients the same device evidence and admission rules when their access permits it.

## What changes

- Add an MCP device lookup backed by the same SDK lookup used by Conversation.
- Check registered device identity, guards and capabilities in the core action tracker before the designated writer receives a tracked request.

## Capabilities

### Modified capabilities

- `bunny-runtime` adds the MCP lookup and common device command admission.
- `bunny-assistant-tasks` uses the shared device facts and action admission for Conversation.

## Impact

The runtime gateway and Companions keep their existing access checks, SDK transport and command identities. Installed verification belongs to [Hub #2184](https://github.com/jimmie-potts/agent-device-hub/issues/2184).

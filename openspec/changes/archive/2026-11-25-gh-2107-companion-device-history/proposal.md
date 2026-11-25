# Conversation device power evidence

## Why

[Hub #2107](https://github.com/jimmie-potts/agent-device-hub/issues/2107) asks Conversation to locate observed device facts, maximum-on deadlines and retained evidence without handing the model raw history.

## What changes

- Give all companions the same guide to the device catalog, current readings, deadlines and bounded retained power history.
- Read Wemo and LIFX through a versioned core projection. Derive observed durations and bounded causal links locally.
- Allow authorized existing read clients to use that projection and preserve their existing history read contracts.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks` gains device source guidance and bounded retained power reads.

## Impact

The runtime core owns history. Companions and the existing runtime MCP read surface consume a bounded projection. The read adds no storage migration or new device collection.

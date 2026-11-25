## Why

The owner can see a running coding job in Jobs. Asking about that same job in Conversation sent the question to a supervisor that could not read it. [Hub #2143](https://github.com/jimmie-potts/agent-device-hub/issues/2143)

## What Changes

Conversation recognizes a status question naming one full job ID, answers from Jobs and rechecks access whenever it displays the answer.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` adds an owner-only status question in the job’s originating Conversation.

## Impact

The Companions module owns the reply and uses the existing Jobs projection. The implementation uses existing Conversation commands and message formats. The installed exercise belongs to [Hub #2115](https://github.com/jimmie-potts/agent-device-hub/issues/2115).

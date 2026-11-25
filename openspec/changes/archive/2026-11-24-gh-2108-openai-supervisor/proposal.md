## Why

The owner needs to choose the supervisor for a companion task independently of the coding worker it may delegate to. [Hub #2108](https://github.com/jimmie-potts/agent-device-hub/issues/2108) authorizes Anthropic Messages and OpenAI Responses alongside each other for this use.

## What Changes

- Add a supervisor choice for new and queued messages. Save its identity and pricing before a task can make a paid call.
- Apply the Responses-specific sharing grant before rendering a task or title request. Recheck the grant before sending and before replay.
- Reserve task and title spend in the existing shared ledger. Keep reservations for calls with unreported usage.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` gains provider selection, Responses sharing, and pinned recovery.
- `bunny-message-profile` gains assistant state 2.4 for available supervisor choices.

## Impact

The companions module owns selection, provider exchange, scope and spend. The Conversation page submits the choice through the existing staged input. The existing command, approval and coding-worker dispatch paths retain their ownership. Hosted billing and the installed trial require separate evidence.

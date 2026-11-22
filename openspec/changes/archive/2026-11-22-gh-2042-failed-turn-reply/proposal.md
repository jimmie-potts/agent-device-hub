## Why

A failed or uncertain assistant turn can leave the owner's last answer or a raw tool result at the end of Conversation. The operator needs a durable account of which steps could be verified, including when the provider is unavailable. [Hub #2042](https://github.com/jimmie-potts/agent-device-hub/issues/2042)

## What Changes

- Save a readable closing reply during failure settlement or recovery from an uncertain external call.
- Report the approved actions and available evidence from this turn. Keep approvals, progress and successful answers distinct.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks` gains terminal failure replies in the private conversation history.

## Impact

The companions engine and its private task and receipt records own settlement. Existing history readers display the saved message.

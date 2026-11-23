## Why

Conversation can report that it submitted a Pixoo brightness request, but the owner has to ask again to learn what the display reported. [Issue #1990](https://github.com/jimmie-potts/agent-device-hub/issues/1990) pilots confirmation tied to the approved request.

## What Changes

- Read the reported brightness after the acknowledged write in the Pixoo writer.
- Follow the tracked operation and the Pixoo owner's evidence in Conversation. If confirmation is pending at turn end, update the original exchange when the result arrives.
- Verify both timings in a disposable Conversation with a Pixoo fixture.

## Capabilities

### Modified Capabilities

- `bunny-pixoo-module` for the bounded post-write reading.
- `bunny-assistant-tasks` for in-turn confirmation and durable follow-up.
- `bunny-message-profile` for request-linked device state.

## Impact

Pixoo, Companions, the existing device state contract, and disposable runtime verification.

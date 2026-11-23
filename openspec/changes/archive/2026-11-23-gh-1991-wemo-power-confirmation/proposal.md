## Why

An approved Wemo power request should report what the plug reads back. [Issue #1991](https://github.com/jimmie-potts/agent-device-hub/issues/1991) extends the timed Conversation confirmation from the Pixoo pilot.

## What Changes

- Use the plug's bounded power getter after an acknowledged write in its existing queue.
- Reuse the saved Conversation watch for current or later Wemo evidence. Preserve the uncertain-write hold and maximum-on enforcement.

## Capabilities

### Modified Capabilities

- `bunny-wemo` for request-linked power readback.
- `bunny-assistant-tasks` for power confirmation and linked follow-up.
- `bunny-message-profile` for the additive power evidence in device state.

## Impact

Wemo, Companions, the device state contract and disposable runtime verification.

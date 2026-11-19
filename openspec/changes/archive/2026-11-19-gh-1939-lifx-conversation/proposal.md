## Why

Conversation can change the Hub mode today. [#1939](https://github.com/jimmie-potts/agent-device-hub/issues/1939) adds the first device status and approved device actions for LIFX.

## What Changes

- Give Conversation a bounded view of LIFX status and capabilities.
- Bind power and brightness proposals to the selected bulb and its existing command guards.
- Submit approved actions through the SDK and the tracked core dispatcher.

## Capabilities

### Modified Capabilities

- `bunny-assistant-tasks`: Read LIFX status, propose and dispatch LIFX power and brightness, and report tracked evidence.

## Impact

Companions, the Conversation frontend, the internal assistant dispatch contract, and disposable runtime scenarios. Installed verification is tracked in [#1940](https://github.com/jimmie-potts/agent-device-hub/issues/1940).

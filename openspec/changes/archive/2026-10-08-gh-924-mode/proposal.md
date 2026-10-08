## Why

[Hub #924](https://github.com/jimmie-potts/agent-device-hub/issues/924) supplies the shared Work/Free/Quiet selection required by the runtime cutover. The existing device-mode responders and dispatcher can apply a selection, but the runtime has no durable Hub-mode owner or selector.

## What Changes

- Keep one Hub selection in the core store, starting at Free without a command.
- Save an explicit selection, then dispatch one independently tracked native-mode command per configured Nanoleaf/Pixoo device using the existing fixed mapping.
- Preserve no replay on restart, duplicate submission, refresh and reconnect; permit an explicit same-mode reapply with a new request ID.
- Add the dashboard selector and MCP action with saved selection and device results shown separately. Failed and uncertain device operations use the shared inbox.
- Keep native changes as observations. Overrides, LIFX participation, companions, migration and physical cycling remain outside this change.

## Capabilities

### New Capabilities

- `runtime-hub-mode`: durable selection, independent fan-out and recovery without replay.

### Modified Capabilities

- `runtime-dashboard`: fill the existing Hub-mode panel with explicit controls and separate per-device results.
- `bunny-message-profile`: require a routing identifier for the mode owner, matching its state and command addresses.

## Impact

The runtime core gains a part using its existing store/dispatcher; the gateway/MCP and runtime dashboard reuse current scopes and action transports. Existing `mode/2.0`, `mode-set/2.0`, `device-mode-set/2.0` and the [fixed table](../../../packages/event-contracts/MAPPING.md#mode) remain the contracts. Nanoleaf and Pixoo remain the device state owners and writers. Source delivery uses synthetic/disposable evidence; installation remains at #840.

## Why

Two Presence Pros can report nearby apartment positions at the same time. Rooms needs a single approximate dot for that overlap and a way to inspect the original readings. [Issue #1997](https://github.com/jimmie-potts/agent-device-hub/issues/1997) owns the change.

## What Changes

- Show an approximate midpoint in the default Rooms view when both Pros have compatible positions.
- Keep individual points, filters, zone editing and source details in the Sensors layer.
- Hide the combined dot when a usable pairing is unavailable.

## Capabilities

### Modified Capabilities

- `room-models` gains an optional combined position in the default apartment view.

## Impact

Rooms uses the existing authenticated SDK records and existing apartment transforms. The change is confined to the dashboard and its synthetic verification.

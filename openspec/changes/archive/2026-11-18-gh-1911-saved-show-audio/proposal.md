## Why

[Hub #1911](https://github.com/jimmie-potts/agent-device-hub/issues/1911) gives the operator a dashboard control for the prepared-show playback check in #725.

## What Changes

- Select an exact saved decorative show version and start it on one light from Audio.
- Reuse the existing tracked command and per-light Stop.

## Capabilities

### Modified Capabilities

- `music-lighting-session`: Explicit saved-show playback from Audio.

## Impact

The dashboard reads the authenticated Nanoleaf catalog and sends the existing core `start-show` command.

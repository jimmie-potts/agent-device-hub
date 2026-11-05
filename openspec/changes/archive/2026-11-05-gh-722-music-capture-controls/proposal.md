## Why

[#722](https://github.com/jimmie-potts/agent-device-hub/issues/722) needs an honest way to inspect and control its input before lighting policy is selected. The merged #721 capture owner now supplies Music-only measurements and tracked start/stop, so the existing Audio page can expose that bounded capability.

## What Changes

- Add an Audio-only Music input measurement card with source/session status, a real expiring input meter and explicit start/stop.
- Consume the existing core state and producer feature contracts through the dashboard's shared authenticated participant; keep command outcomes separate from input evidence.
- Add synthetic browser, accessibility and lifecycle evidence using the real disposable runtime and a numeric-only fake producer.
- Preserve the full issue's lighting, effects, microphone, calibration and preset work. This increment selects none of those capabilities and does not install or activate a real source.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `runtime-dashboard`: Add explicit Music capture controls and qualified input measurements on Audio.

## Impact

Changes cover the runtime dashboard, its owning verification guide and this OpenSpec change. A browser-safe `v2/music-capture-data` export holds the existing constants and types; the server contract re-exports them and keeps family registration. Existing `music-capture-state/2.0`, `music-capture-features/2.0` and tracked `music-capture-control/2.0` remain unchanged. The core owns capture; playback owns its existing cards and controls; no Nanoleaf or native producer code changes. There is no new protocol, credential grant, storage format or state polling path.

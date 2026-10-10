## Why

The current playback owner publishes text but discards optional Sony artwork. [Hub #229](https://github.com/jimmie-potts/agent-device-hub/issues/229), required by [epic #1054](https://github.com/jimmie-potts/agent-device-hub/issues/1054), supplies one bounded thumbnail that consumers can reuse without contacting the receiver.

## What Changes

- Add `playback/2.1` alongside unchanged `playback/2.0`, carrying optional artwork with an opaque observation generation and explicit missing, unsupported or ready state.
- Acquire and normalize Sony artwork independently of metadata polling, with byte, pixel, deadline and concurrency bounds.
- Reject obsolete results after track/source changes, stop or restart. Keep artwork updates separate from freshness and track-change behavior.
- Preserve text-only consumers and source preference. Display rendering and browser artwork remain in their owning stories.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-playback`: optional bounded artwork owned by the playback module.
- `bunny-message-profile`: compatible playback schema version and validation of bounded image state.

## Impact

`modules/playback`, `packages/event-contracts`, SDK sync/live consumers and existing playback compatibility checks. Image normalization uses the existing worker facility and sharp dependency already used by display modules. Receiver URLs remain private under ADR 0011; ownership and communication follow ADR 0012. Installation requires the current runtime procedure, independently of synthetic source verification.

## Why

The playback owner currently observes Sony and Sonos receivers, while the Mac's
Music app is only accessible through a local read-only probe. [#571](https://github.com/jimmie-potts/agent-device-hub/issues/571)
needs a connected source that reports the Mac player and controls it through the
existing tracked playback path, with useful position and declared-output evidence.

## What Changes

- Add one explicitly configured Music source and a separately authenticated Mac
  producer, preserving the ordered selection decision in [#233](https://github.com/jimmie-potts/agent-device-hub/issues/233).
- Observe bounded state, local item identity, display metadata, position and
  Music-declared selected outputs through a distinct native helper. Keep the
  released position reader and capture entry points unchanged.
- Send only play, pause, next and previous to the pinned Music process, using
  the playback owner's existing journal, outbox, outcomes and restart behavior.
- Add a companion position/source state without changing `playback/2.1` clients.
  Missing identity, uncertain clocks and app-declared output remain explicit.
- Validate native behavior through substituted APIs and connected disposable
  SDK/runtime fixtures. Installation and physical qualification remain separate.

## Capabilities

### New Capabilities

- `music-playback-producer`: Bounded native observation/control, explicit producer
  lifecycle, narrow endpoint authority and qualified source evidence.

### Modified Capabilities

- `runtime-playback`: Add Music to the same owner, preserve receiver behavior,
  publish companion evidence and fence commands to the admitted source.

## Impact

Changes are confined to `apps/music-producer`, `modules/playback`, additive event
families, runtime credential/gateway admission and their tests/documentation.
Existing SDK transport and profile 2.0 envelopes remain unchanged. The module
reuses its revision row, command journal and transactional outbox; no new device
configuration, credential provisioning or installed writer is selected here.

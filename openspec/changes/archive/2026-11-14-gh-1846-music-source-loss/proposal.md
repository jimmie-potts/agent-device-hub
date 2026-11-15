## Why

A Music lighting session can reach its fail-safe source-loss ending while Music.app remains audible. The capture, publish and worker boundaries currently expose the same result for several different disruptions. Refs [#1846](https://github.com/jimmie-potts/agent-device-hub/issues/1846).

## What Changes

- Record bounded checkpoints at the producer, core capture and Nanoleaf input boundaries.
- Register the events in diagnostic profile 1.12 and describe where each process writes them.
- Exercise distinct faults with synthetic input and controlled clocks while preserving existing expiry and restoration.

## Capabilities

### Modified Capabilities

- `bunny-music-capture`: producer publication and core freshness checkpoints.
- `music-lighting-session`: first local input loss reason on an existing session ending.
- `shared-observability-contract`: versioned event admission and compatibility.

## Impact

The producer uses its existing foreground stderr. The runtime uses its configured diagnostic sinks. The capture protocol, lighting behavior and controlled-clock browser fixture stay unchanged.

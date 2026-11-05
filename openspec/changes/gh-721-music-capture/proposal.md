## Why

Music-reactive lighting needs measurements of the sound that Music.app is playing. The Music-only Core Audio probe in [#41](https://github.com/jimmie-potts/agent-device-hub/issues/41) established access on the selected Mac output. [#721](https://github.com/jimmie-potts/agent-device-hub/issues/721) now needs a bounded native producer and an authenticated, explicitly started capture session that the current runtime can consume.

## What Changes

- Add a host-local Music-only capture producer under `apps/music-producer`, with portable synthetic signal tests and a macOS Core Audio adapter.
- Analyze levels, frequency bands and amplitude onsets locally. Distinguish those measurements from estimated musical beats. Keep PCM in bounded process memory.
- Carry derived frames through the existing SDK connection-bound endpoint, with narrowly scoped credentials, source timing, a session generation, sequence and freshness checks.
- Add core-owned capture state and explicit start/stop commands. Capture does not start on producer connection, permission grant, runtime startup or reconnection.
- Publish truthful unavailable, stopped and active state. Stop and lost connections fence old frames. Existing private history retains the derived observations that enter the bus.

This is the first Music-only source slice of #721. Microphone selection/calibration and optional prepared analysis remain in that issue. The slice does not command lights, change speaker routing or establish installed or physical acceptance.

## Capabilities

### New Capabilities

- `bunny-music-capture`: Explicit Music-only capture, local derived measurements, bounded transport and core capture ownership.

### Modified Capabilities

- `shared-event-contract`: Closed profile 2.0 capture families for commands, availability, derived frames and current capture state.
- `bunny-runtime`: A narrowly scoped host music-producer credential and core capture lifecycle.

## Impact

The native helper and SDK wrapper live in `apps/music-producer`. Shared payloads live in `packages/event-contracts`; gateway grants and the core part live in `apps/runtime`. Native portable tests run without capture on Linux and macOS. The macOS adapter also requires an actual macOS compilation check. Root build/test commands and CI include the new checks before source implementation.

The existing SDK transport, event envelope, diagnostic contract and core history remain authoritative under ADR 0012. No new service, device writer or transport is introduced. Music.app playback metadata and controls remain owned by the playback module. The installed pilot remains the qualification boundary.

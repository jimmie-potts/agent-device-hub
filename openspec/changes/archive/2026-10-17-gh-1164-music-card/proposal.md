## Why

The owner approved a quiet glass Music card and selected reuse across Home, Audio and Rooms. The current Home/Music card has a different presentation, and Rooms has no explicit music placement.

Owning issue: https://github.com/jimmie-potts/agent-device-hub/issues/1164.

## What Changes

- Reuse one glass Music presentation with visible artwork, title, artist and album, fixed transport controls and audio output below them.
- Replace Now playing with an exclamation mark and Stale/Unavailable when appropriate; retain existing capability, read-only and command-outcome guards.
- Add one Audio landing view while preserving Music deep links.
- Store explicit placement of logical playback records in existing rooms through a small core-owned playback-layout family and revision-guarded command. Placement changes no speaker routing or device state.
- Keep the current authenticated artwork reader and shared connection. Missing/deleted rooms and stale copies cannot imply current room-specific playback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: approved shared card, Audio route and explicit persistent room placements.
- `shared-event-contract`: bounded playback-layout state and operator layout-save command.

## Impact

Current runtime dashboard, core metadata ownership, event-contract types/schemas, shared family sync and the existing runtime/dashboard/browser checks. No module acquisition, speaker writer, playback/2.1 payload, dependency, host or physical test changes. Existing #437 output identity, #438 volume, #178 library selection, #366 general layouts and independent #1162 Sonos artwork retain their own scope. Qualified routine installation and passive browser readback remain separate from source and physical evidence.

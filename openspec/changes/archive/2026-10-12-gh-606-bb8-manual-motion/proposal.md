## Why

[#606](https://github.com/jimmie-potts/agent-device-hub/issues/606) completes the owner's reduced BB-8 release with useful supervised movement. #605 now supplies accepted installed connection, LEDs and power; the dashboard still has no directional controls.

## What Changes

- Add manual Set/Clear forward, four directional steps and priority Stop through the existing BB-8 module/helper.
- Cap speed at 32/255 and duration at 500 ms; the initial UI uses 20/255 for 300 ms. These are software limits, not physical speed or distance guarantees.
- Permit only one pending/active step. The Windows writer sends its selected Stop locally at step end, even if the GO reply has not arrived.
- Invalidate the forward reference on reconnect, restart, explicit repositioning or uncertain movement; Stop remains available on a usable link while movement is fenced.
- Keep installed supervised use in this story. No backups, pilots, loss exercises, continuous joystick, persistent firmware options or new infrastructure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bb8-module`: guarded movement commands, reference projection and truthful React controls.
- `bb8-windows-link`: discrete PacketV1 movement, local deadline and Stop priority without replay.

## Impact

Owning module/helper contracts, queues, React page, existing simulation and their tests/scenarios. No new dependency, schema version, database format, runtime service or shared upgrade profile is selected. Existing SDK tracking/authentication and private evidence boundaries apply. Source review/CI and installed/physical acceptance remain separate; physical movement requires fresh explicit authority and dock removal.

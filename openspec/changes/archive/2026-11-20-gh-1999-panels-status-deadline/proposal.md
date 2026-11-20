## Why

One status read hit its link deadline in the NL22 pilot and ended Music lighting. The device answered a later read. [Source repair #1999](https://github.com/jimmie-potts/agent-device-hub/issues/1999)

## What Changes

- Hold NL22 Music datagrams through a single status-check deadline. Confirm the light still shows the stream on the next scheduled check before sending current frames.
- End safely after a second consecutive miss and keep manual takeover and pending endings effective throughout the hold.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `music-lighting-session` covers the NL22 playback check for both live Music and saved shows.

## Impact

The Nanoleaf module owns the policy in its current worker and link. Event contracts, device protocols, deadlines and installed configuration stay the same. The installed trial remains with #725.

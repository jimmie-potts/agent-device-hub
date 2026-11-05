## Why

[Hub #681](https://github.com/jimmie-potts/agent-device-hub/issues/681) delivers the Tidbyt composition of B.U.N.N.Y.'s art through the existing module writer. The exact-art handoff and producer now supply PNG/GIF compositions, while Tidbyt currently renders only its own static cards.

## What Changes

- Validate and retain bounded 64×32 compositions privately, with immutable identities, renewal, expiry and exact authenticated previews.
- Encode every accepted animation frame and its timing as lossless animated WebP in the render worker; preserve the separate playback-artwork limit.
- Admit exact art moments only on the capable Tronbyt backend, through its existing queue, pin, hold and release path.
- Add a non-interrupting ambient art tile which yields to attention and manual pins, with durable selection separate from transmission evidence.
- Extend the registered synthetic Tidbyt transport to exercise both existing backend selections, including gateway-driven staging, ambient and moment acceptance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-tidbyt`: staged art, qualified animated media, ambient rotation and exact art moments using the module's existing writer.

## Impact

The current Tidbyt module, its private SQLite state, render worker, registered simulation, and runtime acceptance scenarios change. The existing `art-stage/2.0`, `art-ambient-set/2.0`, `moment-play/2.1`, `device/2.2` and module content contracts are consumed without a new shared contract. The retained legacy controller stays unchanged. Installation, the owner's Tronbyt server and physical appearance remain with [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).

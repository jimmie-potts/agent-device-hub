## Context

See proposal.md and #602 for the owner-selected scope. Existing module/helper/SDK queues already provide identity guards, durable outcomes, local finite Stop, ownership and passive restart. Design is required because a device-effect contract crosses the module/Windows boundary.

## Goals / Non-Goals

**Goals:** Dock controls, three fixed zero-speed gestures, refusal of public driving, truthful results and unchanged durable formats.

**Non-Goals:** Full driving, joystick, arbitrary macros, raw motors, firmware flags, automatic gestures, sensor streams, backups or new qualification infrastructure.

## Decisions

- Refuse public aim/step after basic message validity but before responsibility/helper effects; hide their UI. Retain schemas/readers and the guarded Stop path. UI hiding alone would leave old clients able to drive; removing formats would harm retained outcomes.
- Add one guarded named-gesture family and one additive private operation. Keep selections fixed, with `docked: true`, rather than accepting script/animation IDs. Look-left uses heading 330° for 300 ms; look-right uses 30° for 300 ms; shake-head uses 30°, 330°, 30°, 330°, then 0°, each for 150 ms, all at speed zero.
- Ground zero-speed heading semantics in [original-BB8 source example](https://github.com/scross01/bb8-esphome/blob/ddce77d22eeba645c7623aabcb771accd8b8a3d8/README.md) and retained five-byte Roll framing in [pinned PacketV1 reference](https://github.com/artificial-intelligence-class/spherov2.py/blob/4252ddb1a12a25db725257d66e3e8ec3057dd48b/spherov2/commands/sphero.py). This proves source provenance, not physical equivalence to app animations. Do not copy the example's arbitrary scripting, raw motors, self-leveling or persistent options.
- Before each segment, request fresh charging evidence without using old UI telemetry. Reuse the finite step-end Stop executor with zero speed; Stop interrupts the whole gesture, not merely one segment. Reserve packet/results capacity before starting. The existing 5 s operation plus bounded completion Stop applies; no retry.
- Keep public gesture outcome transmitted even though charging evidence was read. It does not claim an observed head pose. Preserve lost-link/uncertain fencing and passive restart.

## Risks / Trade-offs

- Zero-speed requests still move internal mechanics and may disturb head/body → powered dock confirmation, fresh charging guard, finite selection and separately approved visible check.
- Native callbacks/link loss may prevent Stop delivery → truthful uncertainty and nearby owner; no loss-safe claim.
- Source examples may differ from this firmware → physical acceptance remains open; no guessed opcode fallback.

## Migration Plan

No table, config, token or native dependency migration. Deliver through existing source gates; publish matched helper files stopped and update the established runtime with owner-reduced procedure. Do not send radio/gesture commands before separately approved docked use. Retain existing artifacts/evidence.

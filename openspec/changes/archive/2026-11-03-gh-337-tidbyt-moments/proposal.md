## Why

Hub moments reach the Lines and the Pixoo but not the Tidbyt, whose module refuses `moment-play` ([Hub #337](https://github.com/jimmie-potts/agent-device-hub/issues/337)). The art epic ([Hub #677](https://github.com/jimmie-potts/agent-device-hub/issues/677)) needs appearances to take over the Tidbyt briefly. The Tidbyt now runs on a Tronbyt server, which offers an immediate push and a pin. The owner decided on 2026-11-03 that an appearance shows for about 30 to 60 seconds, returns to the rotation and yields to attention and to a pin the owner set.

## What Changes

- On the Tronbyt backend the record declares `moments`, with the moods `celebrate`, `setback` and `reminder`, at most 60 s, able to cover status. The cloud backend keeps refusing `moment-play` and declaring it unsupported.
- `moment-play` runs a bounded takeover through the queue: it reads the server's pin, pushes to interrupt the display, pins the frame, holds it, then releases it. A release clears the pin only if the moment holds it.
- A moment yields to attention, to sessions it cannot follow, to a pin mode and to a pin set on the server. A flourish does not cover status. Any other command ends a moment.
- A request under 30 s holds for 30 s, because the firmware shows a frame for its own dwell.
- Nothing replays after a restart. A takeover a stop or a failed release may have left is released by a fresh write later.
- What a moment shows sits behind `TidbytModuleOptions.momentPicture`, a mood card by default, so exact art (#679, #681) can supply the frame without changing the takeover.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-tidbyt`: the Tronbyt backend's record declares moments, a new requirement states the takeover, and the simulated server gains what the takeover reads.

## Impact

- **Code:** `modules/tidbyt/src/` (`moment-card.ts`, `control.ts`, `tronbyt.ts`, `module.ts`, `tiles.ts`, `configuration.ts`, `simulated-tronbyt.ts`) and its tests.
- **Storage:** one new table in the module's own SQLite file, created when missing. Older code ignores it.
- **Contracts:** no schema changes. `moment-play` and the `moments` capability already exist.
- **Limits:** the evidence stays a transmission. Installation and physical acceptance belong to #687. The core's automation does not route the Tidbyt yet; #684 owns that integration.
- **Docs:** `modules/tidbyt/README.md`.

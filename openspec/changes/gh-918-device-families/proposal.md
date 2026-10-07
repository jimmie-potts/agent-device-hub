## Why

[Hub #918](https://github.com/jimmie-potts/agent-device-hub/issues/918), wave 3 of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827): today the dashboard and MCP know every device through controller contract v1's snapshot, closed command union and capabilities (ADR 0005), and LIFX and Tidbyt share one status interpreter, `@jimmie-potts/agent-status`, which reads 1.x snapshots. #842 defined the core families and left device payloads to modules. The device modules (#832's children, #843, #844), the Hub mode owner (#924) and the runtime dashboard (#922) need one shared device shape, one notice acknowledgment command and one status helper before the first device module lands.

## What Changes

- **`device/2.0`**, a state family for one device's full record: its kind and label, availability, configuration revision and generation, capabilities (power, brightness, native modes, moments, media, scenes, zones and preview, each supported or not, with constraints), desired and observed values with tagged unknowns and an evidence time, the pending count, the last outcome and external control.
- **General command families** mapped from v1's closed union: `power-set`, `brightness-set`, `scene-activate`, `zone-power-set`, `media-start`, `media-control` and `device-mode-set`, each with the optional configuration revision and generation guards. `commandSupported` carries v1 admission's capability rule.
- **Core commands:** `notice-acknowledge`, which a consumer sends to the core to acknowledge one turn-ended notice for its own consumer ID, and `playback-control` for the owner of the `playback` record. The acknowledgment replaces the `lifecycle` family's `notice-acknowledged` event, which the core no longer accepts as a hook observation.
- **The Hub-mode table:** Nanoleaf Work, Quiet and Free one to one; Pixoo Work and Quiet to Monitor and Free to Media; LIFX, Tidbyt and playback do not take part. It lives in the package README and in `HUB_MODE_TABLE`/`nativeMode`.
- **`v2/status`:** `sessionState`, `highestStatus` and `STATUS_COLORS`, copied from `@jimmie-potts/agent-status` with provenance notes and rewritten for `session/2.0` records. A copy that has not synced reads as `unknown`.
- **Registration:** `registerDeviceFamilies(validator)`, beside `registerCoreFamilies`.
- **Mapping:** MAPPING.md gains the controller snapshot, the general commands and the status helper, and its test walks v1's snapshot, capabilities and command union.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-message-profile`: adds the device state family, the general command families, the notice acknowledgment and playback control commands, the Hub-mode table and the 2.0 status helper. The core family list gains the two commands, the lifecycle family drops the acknowledgment event, and the 1.x field mapping covers the controller snapshot, the general commands and the status helper.

## Impact

- **Source:** `packages/event-contracts`:
  - `schemas/v2/families/` (the device and command schemas, plus a shared `action` definition in `playback.schema.json` and the lifecycle event change);
  - `src/v2/devices.ts`, `src/v2/status.ts` and `src/v2/families.ts`;
  - `fixtures/v2/devices.json` and `fixtures/v2/families.json`;
  - `tests/devices.test.mjs`, `tests/status.test.mjs` and `tests/mapping.test.mjs`;
  - the `./v2/devices` and `./v2/status` exports, and `@jimmie-potts/agent-status` as a test devDependency (one lockfile line).
- **Docs:** the package README and MAPPING.md, the event contract checks in `docs/development.md` and one sentence in `docs/architecture.md`.
- **Nothing else:** no runtime, SDK, module, Hub, controller or device change. `packages/agent-status` and controller contract v1 stay unchanged for the old controllers until #839. Delivery target: source-only.

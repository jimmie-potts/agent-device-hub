## Why

The owner wants direct control of the Gen 1 Tidbyt ([Hub #753](https://github.com/jimmie-potts/agent-device-hub/issues/753)). Through the official cloud the module can only place background tiles in a rotation the cloud owns, declares every capability unsupported and writes at most once per 15 s. A Tronbyt server exposes an immediate push, a pin, brightness and a LAN delivery path. [#23](https://github.com/jimmie-potts/agent-device-hub/issues/23) adds that connection in source, behind the existing renderer and writer, with an explicit selection and no failover. Hosting belongs to #1406 and the device transition to #24.

## What Changes

- The module's section takes `backend`, `cloud` by default or `tronbyt`, and only the selected backend's settings: `cloudDeviceId`, or `tronbyt: {url, deviceId, minIntervalMs?, refreshMs?}`. A section with no `backend` behaves exactly as before.
- A new `TronbytConnection` behind the same push, removal and presence calls, with a stated wire form for each difference from the cloud.
- The Tronbyt backend declares brightness and native modes in `device/2.0` and answers `brightness-set` and `device-mode-set` as tracked commands. The modes express interrupt, pin and hide without changing the shared contract. Evidence stays `transmitted`; `observed` stays unknown.
- A backend change is a handoff: the old writer has stopped, tile memory and display state are dropped, a write left uncertain is reported once, and commands left without an outcome are settled. Nothing is replayed.
- Each backend has its gate and refresh. The cloud's stay fixed at 15 s and 10 minutes; the Tronbyt backend defaults to the same and takes configured values.
- `SimulatedTronbyt` beside `SimulatedCloud`, an optional check against a real disposable server, and card copy that names the server when a server is selected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-tidbyt`: the section selects a backend; the device record's capabilities depend on it; new requirements for the Tronbyt connection, the display's controls, the handoff and the simulated server.
- `tidbyt-reusable-card`: the card names the selected backend's evidence.

## Impact

- **Code:** `modules/tidbyt/src/` (`tronbyt.ts`, `control.ts`, `simulated-tronbyt.ts`, `configuration.ts`, `module.ts`, `writer.ts`, `cloud.ts`, `frontend/card.tsx`) and its tests.
- **Storage:** three new tables in the module's own SQLite file, created when missing. Older code ignores them. See the design's recovery note.
- **Contracts:** no shared schema changes. `device/2.0` already carries brightness and native modes.
- **Docs:** `modules/tidbyt/README.md`, `docs/development.md`.
- **Unchanged:** the installed runtime keeps the cloud. No server, firmware, personal setting or device changes here; `controllers/tidbyt` gains nothing.

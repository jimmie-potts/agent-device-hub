## Why

Weather is a required input to B.U.N.N.Y. art ([Hub #1418](https://github.com/jimmie-potts/agent-device-hub/issues/1418), epic [#677](https://github.com/jimmie-potts/agent-device-hub/issues/677)): morning art reflects the day's forecast, and a real change prompts one new piece. The runtime has no weather reader.

## What Changes

- A shipped `weather` module polls the National Weather Service for one privately configured location and publishes one synced `weather-state/2.0` record, with one `weather-changed/2.0` occurrence for a real change.
- The module declares no device simulation, so the host-local and private-proxy container profiles admit its section. The runtime upgrade preflight and inputs learn its absent and configured states and its files, which are not a durable owner.

## Capabilities

### New Capabilities

- `bunny-weather`: the private location, the published record and signal, and how vendor faults appear.

### Modified Capabilities

None.

## Impact

- **Code:** `modules/weather/`, `apps/runtime/bin/runtime-upgrade-preflight.mjs`, `apps/runtime/src/upgrade-inputs.ts`.
- **Storage:** the module's own SQLite file, holding its revision, last observation time and change baseline. It is disposable; losing it costs one baseline.
- **Contracts:** two module-owned families. No shared schema changes.
- **Network:** one new outbound path, HTTPS to `api.weather.gov`.
- **Docs:** `modules/weather/README.md`, `docs/development.md`, `docs/bunny-container.md`, `apps/runtime/README.md`, `apps/runtime/UPGRADE.md`.

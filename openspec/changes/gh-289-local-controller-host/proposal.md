## Why

[Hub #289](https://github.com/jimmie-potts/agent-device-hub/issues/289) asks for the Tidbyt and the LIFX bulbs to appear in B.U.N.N.Y. the way the wall and the Pixoo do: a component page, generic controls and `hub_devices` over MCP. The hub routes only controllers of kind `pixoo` and `nanoleaf`, each a loopback HTTP service. `controllers/tidbyt` and `controllers/lifx` are in-process libraries with no listener, so no dashboard, MCP or history path can reach them.

The owner decided on 2026-09-25 that LIFX color and color temperature also go through the hub now. They use the LIFX package's existing `lifx-light` 1.0.0 profile, because controller v1 has no color command and this story adds kinds and a service, not contract fields.

## What Changes

- Add `apps/local-controllers`, a Linux Node 24 process that loads the Tidbyt and LIFX libraries in-process and serves the unchanged [controller v1 contract](../../../docs/controller-contract.md) for each configured device on one loopback port. Bearer credentials are stored as digests, with read and control scopes and device lists.
- The host reads the existing private Tidbyt runner configuration as-is and starts the runner inside it. The runner brings its status and optional now-playing publishers and its cloud-device lease. Every Tidbyt controller v1 command is declared unsupported, so the hub can read Tidbyt status but cannot push frames.
- The host owns one `LifxController` for the configured bulbs, holds a writer lease per bulb address, and serves the `lifx-light` 1.0.0 profile for color and temperature on a separate profile route. It never polls or paints bulbs by itself.
- The hub accepts controller kinds `tidbyt` and `lifx`. A `lifx` component also gets a lighting snapshot and command route that forwards only strict `lifx-light` 1.0.0 profile requests. MCP binds only each kind's tools: Tidbyt status; LIFX status, power, brightness, lighting status, color and temperature.
- The dashboard shows Tidbyt and LIFX components with the generic controls their snapshots declare. LIFX adds color and color-temperature controls and its observed color. Tidbyt says that its tiles are published by the host and no control is supported.
- Add root build, typecheck and test scripts and a CI step for the host, and document setup and the hub `host.json` entries.

## Capabilities

### New Capabilities

- `local-controller-host`: the loopback host that serves controller v1 and the LIFX lighting profile for in-process Tidbyt and LIFX controllers, with private configuration, authentication, bounds, single-writer leases and shutdown.

### Modified Capabilities

- `standalone-hub-host`: controller routing accepts the `tidbyt` and `lifx` kinds and forwards the LIFX lighting profile for `lifx` components only.
- `standalone-hub-mcp`: tool bindings for `tidbyt` and `lifx` aliases, including LIFX color and temperature tools.
- `unified-dashboard`: Tidbyt and LIFX component views, including the LIFX color and temperature controls.

## Impact

New `apps/local-controllers` workspace, with its tests and README. Changes in `apps/hub/src` (controllers, MCP, server routes and a new lighting validator), `apps/dashboard/src`, and their tests. `controllers/tidbyt` gains a `./runner` package export and the runner returns its controller. Root `package.json`, `package-lock.json` and `.depot/workflows/ci.yml` gain the new workspace and one CI step. The docs change in `docs/development.md`, `docs/architecture.md` and the Tidbyt, LIFX, hub and dashboard READMEs. The controller v1 contract, its fixtures and `packages/contracts` are unchanged. [#292](https://github.com/jimmie-potts/agent-device-hub/issues/292) will bump the new workspace's contract pin when it releases API 1.1.

No device, account, service or installation is touched. Installing the host, registering it in `host.json` and the physical brightness check need the owner's separate go-ahead and explicit bulb addresses. Automatic LIFX status stays with [#20](https://github.com/jimmie-potts/agent-device-hub/issues/20) and [#22](https://github.com/jimmie-potts/agent-device-hub/issues/22).

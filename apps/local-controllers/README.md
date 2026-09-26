# Local controller host

Status: source only, from [#289](https://github.com/jimmie-potts/agent-device-hub/issues/289). Nothing installs or starts it. The tests use fake Tidbyt and LIFX transports and never contact a device, the Tidbyt cloud or the LAN.

`@jimmie-potts/local-controllers` is one Linux Node 24 process that owns the in-process [Tidbyt](../../controllers/tidbyt/README.md) and [LIFX](../../controllers/lifx/README.md) controllers. It serves each configured device over the unchanged [controller v1 contract](../../docs/controller-contract.md) on one loopback port, so the [hub](../hub/README.md) can route to them like the Pixoo and Nanoleaf services. B.U.N.N.Y. then shows both components, and `hub_devices` lists them over MCP.

## Ownership

While it runs, the host is the only writer for its devices.

- **Tidbyt.** The host loads your existing private Tidbyt runner JSON unchanged and starts the runner in-process. The runner brings its status and optional now-playing publishers, their feed reads and the cloud-device lease. The controller v1 identity stays `tidbyt-status` / `tidbyt`. The Tidbyt controller declares every controller v1 capability unsupported. The hub can read its status, but every Tidbyt command is refused as `unsupported-capability`, and the hub never pushes a frame. The standalone runner stays available for rollback; the shared lease stops it and the host from running at the same time.
- **LIFX.** The host owns one `LifxController` for the configured bulbs and holds one writer lease per bulb address under `~/.local/state/agent-device-hub/lifx/`. It also gives the controller a `modeStateRoot` of `<that same lease root>/modes`, so a qualified bulb's Work/Quiet/Free mode persists there; the `LifxController` package itself has no home-directory default, precisely so its source tests never touch a real one. A bulb changes only for an explicit admitted command, so a manual change in the LIFX app stays until the next one. When a qualified bulb's snapshot is read and its observation is missing or at least 30 s old, the host queues one read-only LightGet through the bulb's queue ([#330](https://github.com/jimmie-potts/agent-device-hub/issues/330)). It starts at most one such read per bulb every 30 s, never reads an unqualified bulb, and sends nothing while no snapshot is read. The snapshot answers from memory, so the next read shows the result. Since [#20](https://github.com/jimmie-potts/agent-device-hub/issues/20), when the private configuration names a `lifx.status` feed and a bulb's own `status` block, the host also starts one `LifxStatusPublisher` alongside the Tidbyt runner: it paints that bulb's automatic agent status while its mode is Work or Quiet, through the controller's own internal, non-public paint operation, and never on its own for a bulb without a `status` block or while nothing configures the feed. Physical acceptance stays with [#22](https://github.com/jimmie-potts/agent-device-hub/issues/22).

Every lease is taken before the listener opens. If any lease is already held, startup fails before any feed read or device request and releases the leases it had taken.

## Configuration

Create a mode-600 JSON file owned by the installation user, outside Git and outside any release tree:

```json
{
  "port": 8791,
  "credentials": [
    {"id": "bunny-hub-tidbyt", "digest": "<sha256 of token>", "scopes": ["read", "control"], "devices": ["tidbyt"]},
    {"id": "bunny-hub-lifx", "digest": "<sha256 of token>", "scopes": ["read", "control"], "devices": ["desk"]}
  ],
  "tidbyt": {"runnerConfig": "/absolute/private/tidbyt-status.json"},
  "lifx": {
    "controllerId": "lifx",
    "sourceId": "lifx-lan",
    "bulbs": [{
      "deviceId": "desk", "address": "192.168.1.40", "vendor": 1, "product": 27, "firmwareMajor": 2, "firmwareMinor": 90,
      "status": {"brightnessCapPercent": 50, "quietCapPercent": 20}
    }],
    "status": {"hubUrl": "http://127.0.0.1:8788", "ownerId": "your-configured-hub-owner", "tokenFile": "/absolute/private/hub-read-token"}
  }
}
```

- `port`: the loopback port. The host binds `127.0.0.1` only.
- `credentials`: one to sixteen machine credentials. Each has an `id`, the lowercase SHA-256 hex `digest` of a 43-character base64url token, `scopes` (`read`, `control`) and the `devices` it may use. Create tokens the same way as [hub credentials](../hub/README.md#create-a-credential). Give each hub controller entry its own credential, following the pattern the installed hub already uses for the wall and the Pixoo.
- `tidbyt.runnerConfig`: the absolute path of the existing Tidbyt runner JSON, validated by the runner's own rules, including the optional `nowPlaying` block. See [Run against an installed hub](../../controllers/tidbyt/README.md#run-against-an-installed-hub).
- `lifx`: the `LifxController` options: `controllerId`, `sourceId` and one to thirty-two `bulbs` with neutral `deviceId`s and explicit unicast IPv4 addresses, plus optional `timeoutMs`, `retries` and `maxPending`. Only qualified model evidence enables power, brightness, color, color temperature and modes. See the [LIFX guide](../../controllers/lifx/README.md#ownership-and-configuration).
- `lifx.status` (optional): the hub feed for automatic agent status, in the same shape as the Tidbyt runner's own hub connection: `hubUrl`, `ownerId` and `tokenFile` (a dedicated read-only hub bearer, 43 base64url characters, whose `devices` include every bulb that opts in). Without it, no bulb paints, even if qualified and configured with a `status` block.
- A bulb's own `status` block (optional): `brightnessCapPercent` and `quietCapPercent`, both integers 1-100 (defaults 50 and 20). A qualified bulb paints its automatic status only with both this block and `lifx.status` present; without either, it still advertises `mode.set` but is never painted. See [Automatic agent status](../../controllers/lifx/README.md#automatic-agent-status).

At least one of `tidbyt` and `lifx` is required. Device IDs must be unique; with a Tidbyt configured, no bulb can use `tidbyt`. Unknown fields, symlinks, group- or world-readable files, files over 16 KiB and files inside a Git checkout fail with `local-controllers-start-failed`, which repeats nothing from the files. Bulb addresses, the Tidbyt key and tokens never appear in any response.

## HTTP API

| Route | Scope | Result |
| --- | --- | --- |
| `GET /controller/v1/snapshot?deviceId=<id>` | `read` | The device's controller v1 snapshot |
| `POST /controller/v1/commands` | `control` | One strict controller v1 request for the body's `deviceId`, and its receipt |
| `GET /controller/lifx-light/v1/snapshot?deviceId=<id>` | `read` | A LIFX bulb's `{profile, controller, lighting}` |
| `POST /controller/lifx-light/v1/commands` | `control` | One `lifx-light` 1.0.0 `lifx.color.set` or `lifx.temperature.set`, and its controller v1 receipt |

Every request needs `Authorization: Bearer <token>`. The host authenticates before it reads a body and authorizes the device and scope before admission. It refuses any request with an `Origin` header, a `Sec-Fetch-Site` other than `none`, or a `Host` other than its own loopback origin. Bodies are limited to 64 KiB and JSON depth 32, and at most 32 requests are in flight.

Statuses follow the contract: 400 invalid, 401 unauthenticated, 403 forbidden, 404 unknown device (including a Tidbyt on the lighting route), 409 conflicts and stale generation, 410 expired request ID, 422 unsupported operation, 429 capacity. A rejection that reserves no request ID answers `{"failure":{"code":"..."}}`. A retained rejection or a replay answers its receipt with the same status. An admitted command answers its terminal receipt if it settles within 1 s, and otherwise its `queued` receipt with 202; the next snapshot shows the result. `sent` means transport only, never a visible result.

Color and color temperature share each bulb's queue and request ID namespace with its controller v1 commands. `lifx.temperature.set` changes kelvin only, so the light looks white only at zero saturation.

## Run

Build a pinned reviewed revision in a release directory outside your working checkout with that revision's `package-lock.json`: `npm ci`, then `npm run build` on Node 24. Then, as the installation owner:

```bash
node apps/local-controllers/dist/cli.js /absolute/private/local-controllers.json
```

It prints `local-controllers-started` once every lease is held and the listener is open. SIGINT or SIGTERM, including one that arrives during startup, stops the listener and the Tidbyt publishers, cancels queued work, settles work in flight, releases every lease and prints `local-controllers-stopped`. Shutdown leaves the Tidbyt tiles in rotation and the bulbs as they are. A restart gets fresh request IDs and replays nothing.

## Register it with the hub

Add one `controllers` entry per device to the hub's `host.json`, each with the plaintext token whose digest the host lists for that device, then restart the hub:

```json
{"id": "tidbyt", "kind": "tidbyt", "controllerId": "tidbyt-status", "deviceId": "tidbyt", "endpoint": "http://127.0.0.1:8791/controller/v1", "token": "<bunny-hub-tidbyt token>"},
{"id": "desk", "kind": "lifx", "controllerId": "lifx", "deviceId": "desk", "endpoint": "http://127.0.0.1:8791/controller/v1", "token": "<bunny-hub-lifx token>"}
```

Launcher browser sessions see every registered controller. Add the aliases to the `devices` of any other hub credential that should see them, such as the one your MCP client uses.

## Install and roll back

Installation, registration and the physical check need the owner's explicit go-ahead and bulb addresses. When authorized:

1. Build the release as above and write the host configuration.
2. Stop the standalone Tidbyt runner. Start the host and confirm `local-controllers-started`.
3. Register the devices in `host.json` and restart the hub. In B.U.N.N.Y., change a bulb's brightness and check the bulb; confirm the Tidbyt shows the same status tile as before.

To roll back, stop the host, start the standalone runner with the same runner JSON, and remove the entries from `host.json`.

## Development

From the worktree root on Node 24, run `npm run build`, `npm run typecheck`, `npm run test:local-controllers` and `npm run test:agent-status`, plus the checks in [development](../../docs/development.md#local-controller-host-checks).

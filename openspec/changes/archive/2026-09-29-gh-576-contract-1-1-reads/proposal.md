## Why

[Hub #576](https://github.com/jimmie-potts/agent-device-hub/issues/576) gives the hub a reader for controller contract API 1.1, released as `controller-contracts-v1.1.0` under [Hub #292](https://github.com/jimmie-potts/agent-device-hub/issues/292). Today the controller client validates only 1.0 snapshots. The moment sender in [Hub #335](https://github.com/jimmie-potts/agent-device-hub/issues/335) may send a moment only after it has read a 1.1 snapshot that declares `moments` supported, and the adoption checks in codex-nanoleaf#158 and divoom-app-upgrade#92 need a hub-side reader to run against. No registered controller serves 1.1 yet: the Nanoleaf controller and the local controller host answer a versioned read with `invalid-request`.

## What Changes

- The per-device controller client negotiates the snapshot version. It reads with `apiVersion=1.1` and validates the answer against `snapshotV1_1`. An `invalid-request` answer means the controller serves only 1.0, so the client reads again without the parameter and remembers a `1.0-only` verdict for that controller epoch.
- A remembered verdict is re-probed only when the controller epoch changes and at hub start. Timeouts, 5xx answers and other failures never produce a verdict.
- `GET /api/controllers/v1/<alias>/snapshot` keeps returning the 1.0 shape and accepts `?apiVersion=1.1`, which returns the 1.1 snapshot for a controller that serves it and the 1.0 snapshot otherwise. An unsupported value or another parameter answers 400 `invalid-request`.
- The per-device MCP `status` tool reads at 1.1.
- A shared fake controller fixture under `apps/hub/tests` serves 1.1, a 1.0-only variant and epoch restarts.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `standalone-hub-host`: controller snapshot version negotiation and the versioned snapshot route.
- `standalone-hub-mcp`: the per-device `status` tool reads at 1.1.

## Impact

`apps/hub/src/controllers.ts`, the controller snapshot route in `apps/hub/src/server.ts`, the `status` tool in `apps/hub/src/mcp.ts`, hub tests and one shared test fixture, and the standalone hub and hub MCP sections of `docs/development.md`. Nothing changes under `packages/contracts`. The story adds no command path, sender, route, tool or page and keeps no durable state. Installing the hub is a separately authorized step, and no registered controller serves 1.1 until codex-nanoleaf#158 and divoom-app-upgrade#92 land.

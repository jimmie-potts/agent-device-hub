## Why

[codex-nanoleaf#169](https://github.com/jimmie-potts/codex-nanoleaf/issues/169) owns this scope; the hub has no separate issue for it. Nanoleaf now serves each configured device's saved element geometry read-only on `GET /controller/integration/v1/geometry` ([codex-nanoleaf PR #172](https://github.com/jimmie-potts/codex-nanoleaf/pull/172), merged as `0043456`), a route separate from the `nanoleaf.integration/1.0` settings snapshot. The issue's acceptance requires a hub consumer fixture that reads that geometry with fakes. Hub [#286](https://github.com/jimmie-potts/agent-device-hub/issues/286) phase 2 and [#355](https://github.com/jimmie-potts/agent-device-hub/issues/355) will draw from it. The owner chose a sibling hub route on 2026-09-25, recorded in the issue's work assessment, rather than adding geometry to the hub's polled integration snapshot.

## What Changes

- Add `GET /api/controllers/v1/<alias>/integration/geometry` for `nanoleaf` aliases, with the same authorization and read scope as the other integration reads. It forwards to the owner's geometry route with the native credential for the alias's configured device.
- Validate the response exactly against the owner's contract (`validateIntegrationGeometry`) and check its controller and device identity; anything else is `incompatible-controller`.
- An owner that predates the route (404 `invalid-request`) answers 422 `unsupported-capability` and leaves the controller's health unchanged. Other kinds answer 422 without contacting the owner.
- Copy the owner's geometry fixtures from codex-nanoleaf `0043456`.

Unchanged: the settings snapshot, its validator and poll, controller v1 routing, MCP tools and the dashboard.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: adds the read-only Nanoleaf geometry route.

## Impact

`apps/hub/src/{controllers,integration,server}.ts`, `apps/hub/tests/integration.test.mjs`, `apps/hub/fixtures/nanoleaf-geometry.json` and `apps/hub/README.md`. Source only; no installation, dashboard or device change. The design artifact is omitted: one read route through the existing per-device client, with no state, concurrency, migration or installation change.

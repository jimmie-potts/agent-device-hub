## 1. Workspace and Tidbyt runner seam

- [x] 1.1 Add the `apps/local-controllers` workspace with root build, typecheck and test scripts and a CI step, and verify `npm run build` and `npm run typecheck` pass with an empty host module.
- [x] 1.2 Write a failing runner test that `startStatusRunner` returns its controller and that `@jimmie-potts/tidbyt-controller/runner` resolves, then add the return value and package export; verify `npm run test:tidbyt` passes.

## 2. Local controller host

- [x] 2.1 Write failing configuration tests for private-file checks, unknown fields, credentials, duplicate device IDs, missing devices, and an invalid runner or bulb configuration, then implement the loader; verify with `npm run test:local-controllers`.
- [x] 2.2 Write failing HTTP tests for missing, unknown, wrong-scope and wrong-device credentials, `Origin`, fetch metadata, wrong `Host`, body and in-flight limits, and unknown routes, with no identity reserved, then implement the listener and authentication; verify with the same suite.
- [x] 2.3 Write failing tests with a fake Tidbyt connection and fake LIFX transports for v1 snapshots and schema-valid receipts, Tidbyt `unsupported-capability`, Tidbyt display requests refused on the v1 route, LIFX power and brightness, replay, conflict, stale revision, expired and future sequences, and the 202 `queued` answer for a slow bulb, then implement the v1 routes.
- [x] 2.4 Write failing tests for the lighting snapshot, color and temperature commands, invalid profile requests and a Tidbyt device on the lighting route, then implement the lighting routes.
- [x] 2.5 Write failing tests for the Tidbyt and per-bulb leases blocking a second writer before any request, no bulb traffic without a command, and shutdown releasing leases with fresh epochs on restart, then implement startup, leases, the CLI and shutdown.

## 3. Hub kinds and lighting route

- [x] 3.1 Write failing hub tests that register `tidbyt` and `lifx` aliases against a real local host with fakes: context lists both, snapshots and commands route with `deviceId`, the Tidbyt owner's 422 receipt passes through, and integration routes answer 422 without contacting the owner. Then extend `ControllerConfig`; verify `npm run test:hub`.
- [x] 3.2 Write failing tests for the lighting routes: forwarding a valid color request, 422 for other kinds, 400 for malformed requests without upstream calls, and mismatched snapshots or receipts, plus a cross-check of the hub validator against the LIFX package schema. Then implement the validator and routes.

## 4. MCP

- [x] 4.1 Write failing MCP tests that `hub_devices` lists both kinds, the Tidbyt alias binds only status, and the LIFX alias binds status, power, brightness, lighting status, color and temperature, with a color call reaching the owner once. Then bind the tools per kind; verify `npm run test:hub:mcp` and `npm run test:mcp`.

## 5. Dashboard

- [x] 5.1 Write failing browser checks with fake Tidbyt and LIFX controllers: Tidbyt controls disabled with reasons and the host note, LIFX power, brightness, color and temperature enabled, a color change sending one guarded lighting request, and read-only or unqualified bulbs disabling the lighting controls. Then implement the views; verify `npm run test:dashboard` and `npm run test:dashboard:browser`, including the accessibility scan.
- [x] 5.2 Capture screenshots of both views for the owner's UI approval and keep them outside Git.

## 6. Documentation and delivery

- [x] 6.1 Document the host's configuration, run command, hub `host.json` entries, install and rollback steps in `apps/local-controllers/README.md`, and update `docs/development.md`, `docs/architecture.md`, and the Tidbyt, LIFX, hub and dashboard READMEs. Verify by inspection.
- [x] 6.2 Run build, typecheck, contracts (TypeScript and Python), package, Tidbyt (TypeScript and Python), LIFX, local host, hub, hub package, setup, MCP, dashboard and workflow checks. Then synchronize the spec deltas and archive this change.

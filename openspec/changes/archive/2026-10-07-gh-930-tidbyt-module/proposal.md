## Why

[Hub #930](https://github.com/jimmie-potts/agent-device-hub/issues/930), the second child of #832 under
[epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), moves the Tidbyt into the B.U.N.N.Y. runtime.
Today the runner inside the installed local controller host writes two background installations to Tidbyt's cloud: agent
status (#19) and now playing (#38), from Hub feeds it polls. [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)
replaces those feeds with synced copies on the runtime's bus at one offline cutover (#840), and module failure policy A
(owner decision, 2026-10-06) makes the cloud's errors and timeouts device state, never a module failure. The inputs have
landed: the module test kit (#882), the scenario catalog (#846), the device families and status helper (#918), module
configuration with secrets, files and worker calls (#919), and the playback module (#929).

## What Changes

- **A Tidbyt module, copied with its tests.** `modules/tidbyt` holds the controller's renderer, font, drawing, status and
  now-playing views, cloud connection, queue and publishers, copied from `controllers/tidbyt` at main `627e3fe3` and
  converted to the strict profile and the module boundary. `controllers/tidbyt` stays unchanged until #839.
- **Tiles from synced records.** The status tile follows the core's `session/2.0` records through the shared status
  helper; the now-playing tile follows the playback module's `playback/2.0` record, judging freshness by `availability`.
- **The runner's protections.** One writer behind a lease and one queue; each tile pushed only on change, at most once
  every 15 seconds from the moment a request goes out, refreshed after 10 minutes; removal after a listing check; no
  replay, with capped backoff; authentication and rate-limit holds. Start and restart write nothing until the shown
  state is known, and what a tile sent survives a restart.
- **Rendering in a worker thread** through the runtime's `workers.call`, ended when the module stops.
- **A device record** (`device/2.0`, kind `tidbyt`) with every control unsupported; general commands are refused with
  `unsupported-capability`.
- **Configuration and conversion.** A `configure` for the module's section, with the API key as the secret `token`, and
  the conversion of the runner's `tidbyt-status.json` and credentials file, keeping both installation IDs, which the
  installer (#935) runs.
- **The golden check in Node.** `sharp`'s independent libwebp build decodes each golden frame pixel by pixel, replacing
  the controller's Pillow check for the module.
- **A simulated cloud** for tests and disposable runs, a factory in the shipped list after the playback module, and the
  catalog scenario `tidbyt-tiles` in the in-memory harness and in disposable runs.

## Capabilities

### New Capabilities

- `runtime-tidbyt`: the Tidbyt runtime module: configuration and conversion, both tiles, the writer and its gate,
  start, restart, stop and rendering, the device record, diagnostics, the independent golden check and the simulated
  cloud.

### Modified Capabilities

- `bunny-runtime`: the shipped list holds the Tidbyt module after the playback and LIFX modules, refused without its
  section, and the scenario catalog covers its tiles, a restart with a slow speaker included.
- `runtime-playback` (PR #973 review): after each start the playback record stays `unavailable`, and a command waits at
  most 1.5 s, until every configured speaker's first read has settled, so a speaker that answers first never stands in
  for one still being read; the simulated speakers can answer each call late.

## Impact

- **Code:** `modules/tidbyt` (new); `modules/playback` (`src/module.ts`, `src/simulated.ts`, its tests and README);
  `apps/runtime/src/modules.ts`; `apps/runtime/tests/scenarios` (`catalog.ts`, `catalog.test.ts`, `memory.ts`,
  `parts.ts`); `apps/runtime/verify` (`child.ts`, `supervisor.ts`, `protocol.ts`, `adapter.ts`,
  `plugin.ts`, `tests/build.test.ts`).
- **Docs:** the module README, with the expected webcam result for #840; the runtime and verify READMEs; the old
  controller's README; `docs/development.md` ("Tidbyt module checks" and the test layers).
- **Coordinator-owned files:** the root `package.json` (workspace, build, typecheck and `test:tidbyt-module` scripts),
  the lockfile (the new workspace and its `sharp` development dependency, already locked), CI
  (`test:tidbyt-module:built`, with `tests/workflow_checks.cjs`) and `docs/development.md`.
- **Unchanged:** `controllers/tidbyt`'s code and tests, the local controller host, `packages/sdk/src/module.ts`, the
  observability catalog and released 1.x contracts.
- **Depends on #967 (PR #970, merged as `ff4677f3`):** `device` is served by the LIFX module too, so the Tidbyt module serves
  it beside LIFX through owner-addressed sync, and a reader names `bunny/modules/tidbyt` as the owner.
- **Delivery:** source-only, verified with a simulated cloud; installation and the physical check happen at #840.

## Why

[Hub #846](https://github.com/jimmie-potts/agent-device-hub/issues/846) is the last wave 2 story of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). The owner's first priority for the rebuild is that evaluation never breaks, so the infrastructure to test each change lands before the features. The new runtime has no shared scenario catalog and no end-to-end harness, so no runtime story can show its behavior in CI (tier 1, docs/sdlc.md "Acceptance review"). Modules also need one way to swap in a simulated device without touching hardware, for tests and for #920's disposable runs.

## What Changes

- **Scenario catalog.** `apps/runtime/tests/scenarios/catalog.ts` holds one catalog of seeds and named steps (act, expect within a bound, hold for a while), with the transport-neutral harness contract that every execution adapter implements. #920's disposable-run adapter reuses the same definitions. First scenarios: an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, zero modules, and the early end-to-end path.
- **In-memory harness (tier 1).** `memory.ts` hosts the seed's modules in the runtime's own `ModuleHost` on a manual clock and scheduler. Each scenario runs twice: with its parts on the host's bus, and through a `RemoteEdge` on loopback with run-generated tokens. It can crash the runtime between the lamp's commit and its publish and start a new one on the same state directory.
- **Early end-to-end path.** A hook observation, the committed session, the simulated device's update, a command, its outcome, history and inbox rows, then sync and read, over both transports. It includes a duplicate command (one outcome in history), the deadline answers per transport, a disconnect (resync, nothing replayed) and a crash-restart (the outbox republishes once, and no command is sent again).
- **Module factories with transports.** A module that reaches a device is created by `create<Name>Module({transport})`. The fixture lamp shows it with `SimulatedLamps`, and a new consume-only fixture, the chime, with `SimulatedChime`. There is no manifest slot or registry, because ADR 0012 rules out a plug-in framework.
- **Fixture changes.** The lamp accepts a duplicate `requestId` without switching again, reports a lamp that cannot be reached as a `failed` outcome with evidence `none`, and shows on its indicator whether a session waits for a person. The stand-in core also plays the session owner, history and the inbox until #831 and #782 replace it.
- **Host seam.** `ModuleHost` exposes its bus (`get bus()`), so a remote edge can mount on it. No behavior changes; #920's launch option uses it too.
- **Commands and CI.** `npm run test:runtime:scenarios` and its `:built` variant run the catalog. The core CI job runs it after `test:runtime:built`, and docs/development.md documents one command per test layer.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-runtime`: the fixture module requirement covers the factory with its transport, duplicate commands, failed outcomes and the stand-in core's roles; a new requirement covers the scenario catalog and its in-memory harness.

## Impact

- **Source:** `apps/runtime/src/host.ts` gains the `bus` getter, with no behavior change.
- **Tests:** `apps/runtime/tests/scenarios/` (catalog, harness, runner and catalog tests), the fixtures under `apps/runtime/tests/fixtures/` and their callers.
- **Commands and CI:** `package.json` (two scripts), `.github/workflows/checks.yml` (one core-job step) and `tests/workflow_checks.cjs`.
- **Docs:** the runtime and SDK READMEs, docs/development.md ("Runtime checks" and "Runtime test layers") and the issue reference in docs/sdlc.md step 2.
- **Nothing else:** no running application serves this; it is test infrastructure and CI. There is no contract, device or installation change. Delivery target: source-only.

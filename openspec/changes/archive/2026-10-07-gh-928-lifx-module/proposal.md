## Why

[Hub #928](https://github.com/jimmie-potts/agent-device-hub/issues/928), the first child of #832 under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), moves the LIFX bulbs into the B.U.N.N.Y. runtime. Today the installed local controller host owns `pendant-1` (a qualified A19) and `beam` (unqualified) through controller v1 and the `lifx-light` 1.0.0 profile. [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) replaces those formats with profile 2.0 at one offline cutover (#840), and module failure policy A (owner decision, 2026-10-06) makes a bulb's errors and timeouts outcomes and an `unavailable` record, never a module failure. The module's inputs have landed: the module test kit and outbox (#882), the scenario catalog (#846), the device families and status helper (#918), module configuration (#919) and the agent-session core (#831).

## What Changes

- **A LIFX module, copied with its tests.** `modules/lifx` holds the controller's protocol, its per-bulb queue and the writer lease, copied from `controllers/lifx` at main `483d3a93` and converted to the strict profile and the module boundary: no `device-contracts`, `agent-state` or `agent-status` imports. `controllers/lifx` stays unchanged for the installed service until #839.
- **Records.** Each bulb publishes `device/2.0` and a module family, `lifx-light/2.0`, with its color capabilities and last reading, and serves both through sync.
- **Commands with outcomes.** `power-set`, `brightness-set`, `device-mode-set` and the module's `lifx-color-set` and `lifx-temperature-set` are refused before any effect, or stored, accepted and completed with an outcome through the outbox. A restart reports, never resends.
- **Automatic agent status** from the module's synced copy of the core's sessions, through `highestStatus`, only on a shown-status transition, never in Free, with the shown key kept across restarts.
- **Policy A.** Start opens only local resources, then reads each qualified bulb once; an unreachable bulb is `unavailable` and read again with a doubling wait; the on-demand read is kept.
- **Configuration and conversion.** A `configure` for the module's section (#919), and the conversion of the old `lifx` block and `modes/` folder that the installer (#935) runs at the cutover.
- **Runtime.** The shipped list holds the module after the core; without its section the runtime refuses it with `not-found`. The SDK edge checks the device families. The catalog gains `lifx-bulbs`, played in the in-memory harness and in disposable runs with simulated bulbs that the supervisor holds.

## Capabilities

### New Capabilities

- `lifx-module`: the LIFX runtime module: configured bulbs and qualified controls, the conversion, device records, commands with outcomes, one queue and lease per bulb, automatic agent status, policy A, diagnostics, simulated bulbs and its acceptance tiers.

### Modified Capabilities

- `bunny-runtime`: the shipped list holds the LIFX module after the core, refused without its section; the SDK edge checks the device families.

## Impact

- **Code:** `modules/lifx` (new); `apps/runtime/src` (`modules.ts`, `runtime.ts`); `apps/runtime/tests/scenarios` (`catalog.ts`, `memory.ts`, `parts.ts`); `apps/runtime/verify` (`child.ts`, `supervisor.ts`, `protocol.ts`, `adapter.ts`, `plugin.ts`, `seed.ts`).
- **Tests:** the module's protocol, queue, status, module, lease, configuration and kit tests; the runtime's process, log, catalog and build tests; the maintenance intake test's clean run, which configures each shipped module from its factory's `simulatedSection`.
- **Docs:** the module README, with the expected webcam result for #840; the runtime and verify READMEs; the old controller's README; `docs/development.md` ("LIFX module checks" and the test layers).
- **Coordinator-owned files:** the root `package.json` (workspace, build, typecheck and `test:lifx-module` scripts), the lockfile (the new workspace), CI (`test:lifx-module:built`) and `docs/development.md`.
- **Unchanged:** `controllers/lifx`'s code and tests, the local controller host, `packages/sdk/src/module.ts` (#835 owns it), the observability catalog and released 1.x contracts.
- **Delivery:** source-only, verified in disposable runs with simulated bulbs; installation and the physical check happen at the cutover (#840).

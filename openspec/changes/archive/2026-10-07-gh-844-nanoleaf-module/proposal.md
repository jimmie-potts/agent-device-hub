## Why

[Hub #844](https://github.com/jimmie-potts/agent-device-hub/issues/844), slice A of the Nanoleaf move in [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), runs the TypeScript port of codex-nanoleaf ([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26)) as a module of the B.U.N.N.Y. runtime, so the wall follows the core's synced sessions instead of polling the Hub once a second, answers its commands as request messages with tracked outcomes, and publishes its state, power read from the device included. It supersedes codex-nanoleaf#211. It follows [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) as amended on 2026-10-07, the owner's decisions of 2026-10-06 (shared input only, observed power, module failure policy A) and ADR 0007 (the wall map is the editor). The installed Python services stop at the cutover (#840); the wall pages (#934) and the data migration with offline enrollment (#933) follow.

## What Changes

- **The module.** `modules/nanoleaf/src/module/` wraps the port as the module `nanoleaf` (API `1.1`): `createNanoleafModule({transport})`, its `configure` (devices, qualified sources, optional Codex metadata, token files through #919's secrets), and `SimulatedNanoleaf`, the simulated Lines and NL22 controllers for tests and runs.
- **Input.** The SDK's sync of `session/2.0` replaces the 1.x monitor envelope. The port keeps its previous envelope in an in-memory `SharedCopy` instead of `shared_input.envelope`, so the module saves only the state it owns, and a shared-input configuration no longer needs the 1.x feed's endpoint or token file.
- **Commands and outcomes.** The general device commands and the module's own families (wall and machine edits, animation play, favorites, notice acknowledgment) are admitted in the module's outbox transaction and end with one outcome each, with the registry's error detail. Moments are refused with `unsupported-capability` (codex-nanoleaf#158). Machine edits keep wall-editor ownership through a per-device configuration revision.
- **State.** Each device publishes `device/2.0`, with the power `GET /state` reported, its wall view and, for the Lines, the animation options with the module's own presets and the saved favorites. Only the animation options list favorites; the device record and the wall view hold no favorite or preset name, a poll that changed nothing publishes nothing, and serving a sync writes nothing.
- **Workers.** One supervised worker per device on the runtime's clock, scheduler and stop signal, started again with capped backoff after a store failure ends it; device timeouts become outcomes and an `unavailable` device, logged once per outage; a device's HTTP error ends the command with `transmitted` evidence and its code; only a write that may have reached the device holds it, shown as `degraded` and `held`; stored commands end at a restart and never run.
- **Runtime.** The shipped list adds the Nanoleaf factory after the playback and LIFX modules, with its simulated section through the runtime's shared helper; the scenario catalog adds `nanoleaf-wall`, played in memory (tier 1) and in disposable runs (tier 2), whose supervisor holds the simulated controller.
- **Safe errors.** The journal's outcome errors come from `errorBody`, so the `bunny/safe-errors/nanoleaf-outcomes` exception and its docs row go (#953 hand-off).

## Capabilities

### New Capabilities

- `nanoleaf-module`: the Nanoleaf runtime module: its configuration, its session input, its commands and outcomes, wall-editor ownership, its device state, its workers and failure isolation, and notice acknowledgment.

### Modified Capabilities

- `bunny-runtime`: the shipped list holds the Nanoleaf module after the playback and LIFX modules, and the scenario catalog covers the Nanoleaf wall.

## Impact

- **Code:** `modules/nanoleaf` (`src/module/*`, `shared-input.ts`, `shared-source.ts`, `edits.ts`, `journal.ts`, `controls.ts`, `worker.ts`, `devices.ts`, `enrollment.ts`, `sqlite.ts`, `index.ts`, `package.json`); `apps/runtime` (`src/modules.ts`, `tests/scenarios/*`, `verify/child.ts`, `verify/supervisor.ts`, `verify/protocol.ts`, `verify/adapter.ts`, `verify/plugin.ts`, `package.json`).
- **Tests:** the module's own suites (`module.test.ts`, `module-faults.test.ts`, `module-kit.test.ts`, `journal.test.ts` and the port's suites updated for the in-memory copy, registry errors and the hold rule); the runtime's `nanoleaf.test.ts`, the catalog and the verify build test.
- **Coordinator-owned files:** root `package.json` (the Nanoleaf package builds and typechecks before the runtime), `package-lock.json` (the workspace dependencies), `eslint.config.mjs` and `docs/development.md` (the exception removed; the Nanoleaf section).
- **Docs:** `modules/nanoleaf/README.md` (new), `PORTING.md`, the runtime and verify READMEs.
- **Unchanged:** `packages/sdk` (the module API stays 1.1; #835 owns `module.ts`), the event contracts, CI workflows and released 1.x contracts.
- **Delivery:** source-only, verified in disposable runs; installation and the physical recheck happen at the cutover (#840).

## Why

[Hub #882](https://github.com/jimmie-potts/agent-device-hub/issues/882) is story D of the [#830](https://github.com/jimmie-potts/agent-device-hub/issues/830) split under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). ADR 0012 has each module report outcomes through its own outbox, so a crash never loses one and no command is ever re-sent. Every later module story also needs one way to show that its module behaves like the others, and a stand-in module to build on.

## What Changes

- **Outbox.** `Outbox` in `packages/sdk` keeps a module's messages in its own SQLite file. `transaction(work)` stores each message with the work's changes in one transaction and publishes it only after the commit, unchanged, with its stored `id` and `time`. A state, removal or occurrence is deleted once it has gone out. An outcome is kept until `acknowledge(id)`, and `republish()` sends it again at every start until then; the consumer drops duplicates by `(source, id)`. A message a crash kept from going out goes out at the next start. Only state, removal, occurrence and outcome messages go in, never a command.
- **Stand-in acknowledgment.** The core's acknowledgment belongs to Hub #782. Until then, the kit's stand-in core acknowledges outcomes with an occurrence that `followStandInAcks` passes to `acknowledge`, so tests exercise deletion.
- **Prepared messages.** The outbox sends through `Sdk.publishMessage`, which #883 adds and this change cherry-picks unchanged. The runtime's module context now passes it through.
- **Module test kit.** `@jimmie-potts/sdk/testing` gives every module one conformance suite: the manifest, start and stop leaving nothing behind, serving and copying sync, accepting and refusing a command, and the outcome going out through the outbox. A check runs only when the module's description names what it needs, so a module that only consumes runs the kit too. `moduleConformance(spec)` runs it under node:test in a few lines, and `conformanceChecks(spec)` under any runner, such as Vitest. `ModuleHarness` hosts a module as the runtime does, because a module's tests cannot import the runtime.
- **Shared manifest checks.** `checkManifest`, `checkModuleName` and `checkApiVersion` move from the runtime to the SDK, so the kit refuses exactly what the runtime refuses.
- **Fixture module.** A simulated lamp under the runtime's tests passes the kit and is the stand-in later stories use. It serves its lamps, copies the core's mode, answers a switch command and reports the change, an occurrence and the outcome through its outbox. A stand-in core takes outcomes once by `(source, id)` in its own SQLite file. A process test kills the runtime between the lamp's commit and its publish.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-sdk`: adds the per-module outbox, the module test kit and the shared manifest checks.
- `bunny-runtime`: the module context passes `publishMessage` through, and the runtime's tests hold the fixture lamp and the crash test.

## Impact

- **Source:**
  - `packages/sdk`: `src/outbox.ts`, `src/envelope.ts` (#883's, unchanged), `src/testing/`, the `./testing` export and the manifest checks in `src/module.ts`;
  - `apps/runtime`: the context's `publishMessage`, and the manifest checks taken from the SDK.
- **Tests:** the outbox, kit and prepared-message tests in `packages/sdk/tests`; the fixture lamp, stand-in core, kit run, context test and kill test in `apps/runtime/tests`.
- **Docs:** the SDK and runtime READMEs and `docs/development.md`.
- **Follow-up:** Hub #782 defines the core's outcome acknowledgment before the cutover (#840); until then outcome rows grow.
- **Nothing else:** nothing runs a module yet, and the shipped module list stays empty. There is no contract, device or installation change. Delivery target: source-only.

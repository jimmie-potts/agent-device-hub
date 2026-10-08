## Why

[Hub #999](https://github.com/jimmie-potts/agent-device-hub/issues/999) is the owner-approved friction cut (2026-10-07) under [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827). Every runtime module story edits the same shared files: the shipped list, the scenario catalog, the in-memory harness, and the disposable run's supervisor, child, protocol, adapter, seeds and plug-in. Module PRs therefore merge one at a time and rebase repeatedly, and the rebases have introduced bugs. Two notes from PR #1004's review belong here too: the disposable run's child kept its own copy of the scenario schema list, whose drift made `stand-in-history` answer 404, and the core is first in the shipped list only by convention.

## What Changes

- **A module registers itself.** The SDK exports `ModuleRegistration`: a module's factory, whether it ships, its `order` and `after` constraints, any checks its families need beyond their schemas, and how the scenario harnesses simulate its devices. Each device module exports one from its own folder.
- **The runtime collects the registrations at build time.** The build writes a registry with one static import of each `modules/*` package's registration. The shipped list holds the core first by construction, then each shipped registration ordered by `after`, `order` and name, and refuses a list that breaks a rule. Nothing loads at run time, and the shipped order is unchanged.
- **Both harnesses drive registered modules through their registrations.** The in-memory harness builds each one on its simulated device; a disposable run's supervisor holds the device and the runtime's child reaches it over a generic link. Only the core and the fixture modules keep harness code of their own. Both harnesses take one schema list.
- **Each module's scenarios live in a per-module file the catalog collects**, with any disposable run of its own. The scenario framework moves to its own file. The catalog lists the same scenarios by name, the core's first.
- **A workflow check** fails when a shared file names a device module.
- **Outside the specs:** the runtime README says how to add a module; the verify README's device row and the Codex Desktop marker's key in the harness state document (`devices["codex-desktop"]`, which was `devices.codexDesktop`).

Slice 2 (`codex/gh-999-module-build`) moves the build, typecheck, test and CI wiring, `docs/development.md` and the shared specs' per-module text onto the same mechanism.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: a module's registration.
- `bunny-runtime`: the shipped list from registrations with the core first; the harnesses driving registered modules through their registrations, with one schema list and per-module scenario files.

## Impact

- **Code:** `packages/sdk/src/registration.ts`; `modules/*/src/registration.ts` (Nanoleaf and Pixoo under `src/module/`); `apps/runtime/src/modules.ts`, `src/registry.d.ts`, `build/registry.ts`; `apps/runtime/tests/scenarios/` (`framework.ts`, `catalog.ts`, `memory.ts`, `parts.ts`, `modules/*.ts`); `apps/runtime/verify/` (new `link.ts` and `paths.ts`; `child.ts`, `supervisor.ts`, `protocol.ts`, `adapter.ts`, `seed.ts`, `plugin.ts`); `scripts/check-module-names.cjs`; tests beside each; the root `build` script runs the registry writer.
- **Unchanged:** every module's behavior, every message format, the shipped order, every scenario's steps, ADR 0012's rules, the installed system.
- **Delivery:** source-only.

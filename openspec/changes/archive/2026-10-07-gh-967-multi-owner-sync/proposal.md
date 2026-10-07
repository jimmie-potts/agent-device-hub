## Why

[Hub #918](https://github.com/jimmie-potts/agent-device-hub/issues/918) made `device/2.0` a family that every device module serves for its own devices, but the SDK's sync registry keyed ownership by family alone. The runtime therefore refuses the second device module that serves `device` at its start (`invalid-state`), so LIFX ([#928](https://github.com/jimmie-potts/agent-device-hub/issues/928)) and Nanoleaf ([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844)) cannot run together, nor Pixoo and Tidbyt later. [ADR 0012](../../../../docs/decisions/0012-bunny-event-platform.md) already describes "a sync request to an owner"; the family-only key was a shortcut. [Hub #967](https://github.com/jimmie-potts/agent-device-hub/issues/967) keys ownership by owner and family.

## What Changes

- **Ownership by source and family.** Several participants may serve a shared family, today `device`, each for its own entities. Every other family keeps one owner, and a participant still serves each family once: both are refused with `invalid-state`.
- **Owner-addressed sync.** `sync` takes an optional `owner`, the owning participant's source, such as `bunny/modules/lifx`. Every request of the copy goes to that owner, and the copy follows only the live messages that owner publishes. A named owner that does not serve the family is refused with `unavailable`.
- **Existing calls keep working.** A sync that names no owner goes to the family's only owner, as before, and its copy follows the owner that served it. While several owners serve a family, it is refused with `invalid-request`, saying to name the owner, and it is never spread across owners. "One sync covers one owner's families" stays.
- **Over the remote edge.** The owner travels beside the request, in the transport's sync call, as a routing key travels beside a command; the `sync-request` message is unchanged. The edge refuses an owner that is not a participant source with `invalid-request` and passes a valid one to its bus.
- **Owners in health.** Each module's health entry lists the families it serves in `serves`, so a consumer syncs a shared family only from its owners.
- **Kit, harness and catalog.** The module test kit syncs a module's served families from the module by name, its stand-in owner can serve as the owner a module names (`copies.owner`), and its copies check then requires that name. `ModuleHarness` keeps the owner a module's sync names. The runtime's fixture lamp and sign also serve their own devices' `device/2.0` records; the scenario catalog's seed can name a copy's owner; and a new `device-owners` scenario runs both in both tiers.
- **Docs.** The SDK README states the rule and how a consumer of a shared family syncs each owner; the runtime README says where a module's owner source comes from.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-sdk`: sync a consumer's copy from a named owner, and the module test kit's named-owner syncs. "Serve sync from the owner's current state" is replaced by "Serve sync from each owner's current state", with ownership keyed by source and family, because its scenario "One owner per family" becomes "One owner per family per source" and OpenSpec keeps every scenario name of a modified requirement.
- `bunny-runtime`: modules that serve one family side by side, and a scenario catalog that follows each owner by name.

## Impact

- **Code:** `packages/sdk` (`sync.ts`, `in-process-sync.ts`, `in-process.ts`, `remote-client.ts`, `remote-edge.ts`, `sdk.ts`, `testing/kit.ts`, `testing/harness.ts`). `packages/sdk/src/module.ts` is unchanged. The edge change is additive: one helper and the owner passed to `syncMessage` in the `sync` call.
- **Tests:** a new SDK owners suite on both transports, the SDK sync and kit tests, a new runtime owners test, the fixture lamp and sign, the scenario parts, the catalog and its test.
- **Docs:** the SDK, runtime and runtime-verification READMEs.
- **Unchanged:** the `sync-request` and `sync-completed` payloads and the event contracts, `sdk-remote/1.0`'s other calls, every single-owner sync, the diagnostic catalog (the `sync.served` and `sync.refused` records keep `sync <families>` as their pattern), and released 1.x contracts.
- **Delivery:** source-only, with observable behavior. A runtime run (`verify:runtime`) can now start two modules that serve the same family, and the `device-owners` scenario shows it, so the change gets an Acceptance review in a `verify:runtime` run.

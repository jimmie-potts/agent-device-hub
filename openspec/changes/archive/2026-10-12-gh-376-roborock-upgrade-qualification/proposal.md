## Why

[#376](https://github.com/jimmie-potts/agent-device-hub/issues/376) needs installed read-only Roborock observations, but the current runtime upgrade profile refuses configured or retained Roborock state. Qualify its private archive and SDK outbox before activation so subsequent routine upgrades can preserve the latest observations and maps.

## What Changes

- Add complete fixed Roborock coverage to each existing optional-owner profile, retaining exact release/evidence binding and refusal of unknown or incomplete coverage.
- Inventory configured/retained Roborock through private filesystem metadata; require its primary store and a delivered reader in selected artifacts without opening live databases.
- Apply configured healthy-state checks consistently before and after startup; preserve the unconfigured absent-module exception.
- Exercise baseline, candidate, compatible recovery and reupgrade in separate processes using production RoborockStore and SDK Outbox, with a negative control for loss of newer candidate observations.
- Document source-proof limits and the exact private qualification required for installed admission. Original source acceptance, account selection, authorized device reads and real-run comparison remain separate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime-upgrades`: configured and retained Roborock ownership, complete fixed qualification and latest-state preservation.

## Impact

`apps/runtime` admission, state inventory, preflight and focused tests; runtime upgrade/development guides and the existing OpenSpec capability. Production Roborock store and SDK outbox APIs are reused unchanged. No cross-repository contract, dependency, wire schema, collection scope, vacuum control or installed operation changes.

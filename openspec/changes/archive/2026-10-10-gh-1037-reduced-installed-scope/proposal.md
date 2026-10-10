## Why

The owner selected a smaller initial installed qualification for [#1037](https://github.com/jimmie-potts/agent-device-hub/issues/1037). Requiring a deliberate live upgrade, recovery and re-upgrade adds service restarts to a personal installation when those recovery paths already have disposable production-store test evidence.

## What Changes

- Qualify the established installation with one separately authorized, successful forward upgrade, including its exact plan, stopped-writer backup, final receipt, running revision, health and retained latest state.
- Retain the previous verified release and compatible recovery path. Keep synthetic upgrade, recovery, re-upgrade and incompatible-candidate refusal evidence required.
- Report deliberate live recovery and re-upgrade as untested unless separately exercised. A failed, refused or interrupted forward upgrade does not pass initial qualification.
- Allow at most one approved recovery after an actual failure, then end the window without replay or re-upgrade.
- Preserve source, installed, client and physical acceptance as separate evidence. All ONN product features retain their existing scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime-upgrades`: reduce the initial established-installation rehearsal while retaining synthetic recovery proof and truthful installed outcomes.

## Impact

Update the current runtime's `apps/runtime/UPGRADE.md` and the affected acceptance requirement. Runtime helpers, release formats, admission contracts, state ownership, credentials and hooks remain unchanged. No cross-repository wire contract changes are required. The earlier owner coordination request remains historical evidence; GitHub records its superseding scope decision and any remaining acceptance gap.

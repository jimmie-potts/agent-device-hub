## Why

[Hub #427](https://github.com/jimmie-potts/agent-device-hub/issues/427) replaces repeated handwritten installation scripts with a guarded command for the existing Linux/WSL Hub. It implements the published [install contract](https://github.com/jimmie-potts/agent-device-hub/blob/96710bba52054c381035a6afabe8348d2b9bbd93/docs/install-contract.md), while preserving the shared Nanoleaf runtime parent, Node executable and latest durable state.

## What Changes

- Add read-only `plan` and `status`, and explicitly approved `upgrade` and `rollback` commands run from a clean checkout.
- Bind operations to a full merged source SHA, complete change bundle, installed baseline, configuration and shared-path inventory. Build and verify immutable releases before any outage.
- Adopt the existing Hub directory through the contract's forwarding/current-link layout, retaining verified legacy bytes when full provenance is unavailable.
- Refuse unknown or incompatible recovery before stopping the service. Serialize operations, retain durable intent, back up after verified writer exit, check running identity and health, and recover against the latest state.
- Validate private receipts with contracts 1.2.0; retain current and previous successful releases without pruning references, legacy copies or another runtime.
- Replace the stale update procedure, add the root agent declaration, and verify discovery in fresh read-only agent sessions within the issue's acceptance scope.

## Capabilities

### New Capabilities

- `hub-runtime-upgrades`: Hub-specific release planning, first adoption, guarded switching, state-preserving recovery and operation evidence.

### Modified Capabilities

None. The command consumes the existing runtime-install contract and startup build identity without changing either contract.

## Impact

Hub command modules, isolated tests, packaging and its pinned contracts archive, `apps/hub/SETUP.md`, root `AGENTS.md`, and the installation pointer in `docs/sdlc.md`. Existing Hub test/package CI jobs cover the command; shared consumer checks remain required. Nanoleaf #140 and Pixoo #114/#115 retain their own commands and acceptance. No hook, credential, `host.json`, unit, shared Node, boot, device or host migration change is included.

Source delivery and merged-main CI precede the owner's separate approval of the exact real migration, upgrade, rollback and re-upgrade. The issue remains open until that installed sequence passes with schema-valid receipts and state evidence.

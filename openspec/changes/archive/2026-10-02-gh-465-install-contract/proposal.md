## Why

[Hub #465](https://github.com/jimmie-potts/agent-device-hub/issues/465) needs one verifiable installation contract because version labels and ad hoc receipts cannot distinguish installed files, running processes and safe recovery.

## What Changes

- Define project-owned release anchors behind stable paths, exact-source release identity, compatible rollback preserving current state, bounded health and durable operation receipts.
- Add a strict install receipt schema and shared TypeScript/Python conformance cases to contracts 1.2.0 without changing controller wire formats.
- Document both shared-runtime adoption orders, historical receipt mapping and the root AGENTS.md declaration template.
- Publish the private archive only after the owner's explicit checkpoint approval and source/CI gates.

## Capabilities

### New Capabilities

- `runtime-install-contract`: release identity, ownership, operation outcomes and consumer obligations.

### Modified Capabilities

None. Controller and lifecycle contracts retain their existing behavior.

## Impact

Changes packages/contracts, its packager and contract/development documentation. Consumers are [Hub #428](https://github.com/jimmie-potts/agent-device-hub/issues/428), [Hub #427](https://github.com/jimmie-potts/agent-device-hub/issues/427), [Nanoleaf #140](https://github.com/jimmie-potts/codex-nanoleaf/issues/140), [Pixoo #114](https://github.com/jimmie-potts/divoom-app-upgrade/issues/114) and [Pixoo #115](https://github.com/jimmie-potts/divoom-app-upgrade/issues/115). Their implementation, installation, device operation and host migration are outside this change.

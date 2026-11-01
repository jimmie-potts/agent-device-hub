## Why

Feature tasks need to share one verified deployment result for the established Mac installation. Issue https://github.com/jimmie-potts/agent-device-hub/issues/1365 adds a bounded operator around the existing stopped backup and image replacement procedure.

## What Changes

- Consume a successful pinned hosted qualification and its matching immutable ARM64 production image.
- Serialize deployment and manual maintenance with one private per-project operation lock and durable unfinished marker.
- Persist each phase, verify stopped backup and exact replacement identity, health and the selected read-only client path.
- Reconcile interruptions explicitly and allow an explicit previous-image return only with current latest-state compatibility evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-container-operator`: qualified batches, operation exclusion, interruption reconciliation and latest-state image return.

## Impact

Host operator scripts, synthetic tests, current container specification and operator instructions. No runtime wire contract, device command, personal client setting or storage migration is added. Actual installation remains the coordinating deployment task's operation.

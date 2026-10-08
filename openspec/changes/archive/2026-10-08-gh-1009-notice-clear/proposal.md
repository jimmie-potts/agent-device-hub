## Why

[#1009](https://github.com/jimmie-potts/agent-device-hub/issues/1009) restores the owner-selected manual notice override as one confirmed Connections tool. Consumer self-acknowledgment currently cannot clear the current notice for every configured consumer atomically.

## What Changes

- Add the operator-only `notice-clear` command family using profile 2.0.
- Add one queued owner operation that acknowledges the selected current notice for every configured consumer in one save.
- Add a confirmed Connections control; show transport reply, completion and synced acknowledgments separately.
- Preserve passive session rows, consumer self-acknowledgment and no automatic retry or replay.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: the guarded operator notice-clear family.
- `bunny-runtime`: atomic tracked all-consumer acknowledgment through the existing operator capability.
- `runtime-dashboard`: the confirmed Connections override and synced record result.
- `agent-state-core`: queued atomic acknowledgment of all configured consumers.

## Impact

Event contracts, agent-state owner, runtime core/tracker, dashboard and focused tests/catalog. No durable schema or provider/device permission changes. Source-only delivery; installation belongs to #840.

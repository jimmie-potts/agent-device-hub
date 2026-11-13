## Why

A standby needs to open and read its core settings without executing work left
by an active runtime or starting device control. [Refs #1804](https://github.com/jimmie-potts/agent-device-hub/issues/1804)

## What Changes

- Add explicit standby selection to production and private-proxy container
  startup. The existing health endpoint remains available locally.
- Open the real core's settings readers under the runtime lease. Keep the
  gateway and work intake off, and preserve pending operational state on restart.

## Capabilities

### Modified Capabilities

- `bunny-container-operator` defines standby profile admission.
- `bunny-runtime` defines settings-only startup, readiness and effect refusal.

## Impact

Container startup, operator admission and the core's composition change.
External admission, peer settings replication and host qualification belong to
later deliveries.

## Why

[Hub #611](https://github.com/jimmie-potts/agent-device-hub/issues/611), following the accepted [#610 decision](https://github.com/jimmie-potts/agent-device-hub/issues/610), needs an explicit route for trusted preview operations when a Codex sandbox cannot observe the host process namespace or write the canonical proof/runtime roots. A bus-only workaround cannot qualify listener ownership.

## What Changes

- Add a Hub-owned, opt-in host dispatcher for existing Hub, Nanoleaf, Pixoo and composed verification commands from explicit checkouts.
- Bound and identify each transient command unit, preserve separate preview leases, and report interruption/cleanup uncertainty without retrying starts.
- Document Linux-user execution authority, minimal environment, setup/rollback and the coordinator-only qualification matrix.
- Keep personal activation, new agent sessions and Windows qualification in #613.

## Capabilities

### New Capabilities
- `verification-host-routing`: explicit named-operation dispatch, result/cleanup evidence and host authority boundary.

### Modified Capabilities
None. Existing adapter lifecycle and receipt contracts remain unchanged.

## Impact

Hub scripts, package commands, focused tests, CI, app-verification documentation and ADR 0009. Calls existing consumer wrappers; no consumer code, service installation or persistent permission change. Source tests use a deterministic subprocess supervisor fixture; actual host qualification remains separate.

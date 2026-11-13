## Why

The standby core keeps device control off. Its external boundary must refuse
work before any owner sees it and admit only a bounded authenticated status
read. [Issue #1805](https://github.com/jimmie-potts/agent-device-hub/issues/1805)
owns this source change.

## What Changes

- Validate configured inbound standby credentials at startup and reload.
- Fence HTTP writes and SDK calls before effects. Keep browser, launcher, MCP
  and general reads closed.
- Exercise a synthetic bounded read on the same boundary. Shipped standby
  continues to serve local health with the gateway off.

## Capabilities

### Modified Capabilities

- `bunny-runtime` adds standby gateway admission and credential validation.
- `bunny-sdk` adds the standby refusal boundary before SDK call permissions.
- `bunny-container-operator` validates standby credentials before bootstrap.

## Impact

The runtime gateway, SDK edge and container credential precheck change. Active
profiles retain their existing access rules and wire contracts. The real
freshness endpoint is outside this change.

## Why

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) now needs a bounded source check for everyday standalone Linux/WSL operation. The delivered hook, host, dashboard and device consumers already exist, but their separate tests do not measure this route together.

## What Changes

- Add one confined qualification command, with pinned real consumer sources, synthetic events and disposable state.
- Measure hook launch/return and consumer receipt, plus a small outage/reconnect/restart/browser scenario set.
- Define practical targets before runs and retain failures and exact source/runtime evidence in a concise report.
- Preserve historical limits/receipts, product contracts and Pixoo #61's independent embedded-host scope.

## Capabilities

### New Capabilities
- `standalone-monitor-qualification`: Bounded source qualification and honest timing, confinement, failure and recovery evidence for the selected standalone setup.

### Modified Capabilities
None. The early shared-monitor-performance-baseline remains historical evidence.

## Impact

Measurement tooling, tests, CI command wiring, development instructions and the maintained guide. No installation, devices, live state, production migration/rollback, language rewrite or new runtime API. Consumers retain monitor v1 and released lifecycle/state contracts; rendering and physical acceptance remain device-owned.

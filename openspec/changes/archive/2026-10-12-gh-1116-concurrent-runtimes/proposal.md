## Why

Independent tasks on the existing WSL host already have isolated verification
runtimes, but the normal launchers serialize them. The owner selected concurrent
task runtimes in [#1116](https://github.com/jimmie-potts/agent-device-hub/issues/1116).

## What Changes

- Remove the default single-run opt-in from the four npm wrappers and host route.
- Preserve the explicitly opt-in guard, all leased lifecycle behavior and exports.
- Align instructions and demonstrate separate candidate runtimes, including the
  host route, with scenario, reset, health and owned-cleanup evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-proof-handoff`: normal launches permit concurrent runs; the
  existing guard remains optional.
- `verification-host-routing`: the minimal host environment does not enable the
  single-run guard, while keeping command and preview ownership separate.

## Impact

Root npm scripts, the host launcher and its tests, SDLC and verification guides.
No new dependency, scheduler, count limit, capacity gate, host, installed runtime
change or physical transport. The [operation contract](https://github.com/jimmie-potts/agent-device-hub/blob/main/packages/app-verify/OPERATIONS.md),
ADR 0012 and diagnostic contract retain their outcomes, codes and retry rules.

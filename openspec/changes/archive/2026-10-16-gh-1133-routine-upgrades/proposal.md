## Why

[Issue #1133](https://github.com/jimmie-potts/agent-device-hub/issues/1133) removes the blanket recovery-certificate gate that blocks routine forward upgrades on inactive integration readers. The owner selected this central simplification for the established personal installation.

## What Changes

- **BREAKING**: replace operator request/plan 1.0 with closed 2.0 records; reject old requests rather than reinterpret their approvals.
- Verify previous/target release bytes and the installed baseline; bind a focused storage-change assessment instead of per-owner four-phase certification.
- Make recovery optional and independently qualified. Unknown recovery allows a forward plan and refuses recovery checks.
- Preserve locking, stopped-writer backups, protected inputs, bounded running checks, truthful receipts and no replay. Inactive integration files remain untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime-upgrades`: routine forward admission and independent recovery eligibility.
- `runtime-install-contract`: current-runtime applicability, preserving released legacy contracts.
- `bunny-power-schedules`: focused schedule compatibility assessment for forward updates and recovery.

## Impact

Operator helpers/tests, root instructions, SDLC/install contract and current runtime guides. No product APIs, dependency changes, service restart, device command, activation or dormant integration qualification. Historical certificate helpers/receipts remain evidence; their old acceptance is not routine authority.

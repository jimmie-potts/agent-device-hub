## 1. Pending listing

- [x] 1.1 Add failing tests: a lighting snapshot taken while status paints are queued or in flight passes the hub's `validateLightingSnapshot` and lists no paint; a completed paint's receipt is the last outcome and its request the last successful send.
- [x] 1.2 Exclude status paints from `lighting.pending`; update the README.

## 2. Checks

- [x] 2.1 Run build, typecheck, `test:lifx`, `test:local-controllers`, `test:agent-status`, `test:hub`, the contract checks and the workflow checks on Node 24; sync and archive this change.

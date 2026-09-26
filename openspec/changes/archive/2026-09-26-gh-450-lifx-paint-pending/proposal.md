## Why

The #22 installed trial (2026-09-26) found B.U.N.N.Y. intermittently showing `incompatible-controller` for `pendant-1` right after a mode change. #20 listed an in-flight status paint in `lighting.pending` with the private kind `lifx.internal.status-paint`, which the `lifx-light` 1.0.0 snapshot does not allow, so the hub's lighting validator rejected any read taken during a paint and briefly marked the controller unavailable. Issue: https://github.com/jimmie-potts/agent-device-hub/issues/450.

## What Changes

- A status paint is no longer listed in `lighting.pending` (it was already absent from the controller v1 `state.pending`). The owner chose this on 2026-09-26 over a `lifx-light` 1.1.0 profile.
- The paint still uses the bulb's queue, request identity namespace, generation cancellation and receipts, and still updates `lastOutcome` and `lastSuccessfulSend`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `lifx-controller`: the internal status paint is not listed as pending, so the lighting snapshot stays valid `lifx-light` 1.0.0.

## Impact

`controllers/lifx/src/controller.ts`, its README and tests, and a hub-validator cross-check in `apps/local-controllers/tests/hub.test.mjs`. No hub, dashboard, wire or profile change. Reinstalling the host belongs to #22.

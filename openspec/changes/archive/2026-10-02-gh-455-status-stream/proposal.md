## Why

[Hub #455](https://github.com/jimmie-potts/agent-device-hub/issues/455) removes the avoidable wait for the next recovery poll when shared status changes. The existing Hub SSE route supplies latest-state notices, while device writes retain their own cadence and authorization.

## What Changes

- Add bounded authenticated subscriptions to the shared Hub status feed using the existing wire.
- Connect both publishers to change notices and independent recovery polling; cancel reads/subscriptions and prevent submissions after stop.
- Verify latency, storms, malformed streams, recovery and device policies with deterministic fakes.

## Capabilities

### New Capabilities

- `shared-status-subscriptions`: prompt latest-state reevaluation with bounded stream lifecycle and independent recovery polling.

### Modified Capabilities

None. Existing LIFX/Tidbyt rendering, modes, queue and write policies remain authoritative.

## Impact

`packages/agent-status`, LIFX/Tidbyt status publishers, owning guides and existing test suites. No server wire change, CloudEvents runtime adoption, Effect, installation or physical operation. [Hub #701](https://github.com/jimmie-potts/agent-device-hub/issues/701) supplies staged delivery rules; lifecycle/controller versions stay unchanged.

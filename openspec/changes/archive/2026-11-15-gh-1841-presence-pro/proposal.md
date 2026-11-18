## Why

[#1841](https://github.com/jimmie-potts/agent-device-hub/issues/1841) needs useful
stock Presence Pro reports through the existing runtime. The accepted
[interface](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/presence-pro-interface.md) permits downtime, cached
scalar reports and missing history; physical enrollment is separate.

## What Changes

- Add one fixed module for two independent configured Native API sensors.
- Publish the small versioned occupancy/zone/held/approximate-coordinate record.
- Reset live reports on disconnect/restart and fence retired callbacks.
- Reuse existing authenticated SDK/state/history and saved apartment calibration.

## Capabilities

### New Capabilities
- `presence-pro-observations`: direct stock reports and honest approximate points.

### Modified Capabilities

None. Existing SDK, runtime readers, history and apartment geometry retain their contracts.

## Impact

New workspace `modules/presence-pro`, one pinned Native API client, root build/type
and existing runtime test aggregation, module registration, focused runtime tests
and documentation. ADR 0011/0012/0016 apply. No installation, device-setting
writes, firmware change, raw archive, model sharing or overlay is included.

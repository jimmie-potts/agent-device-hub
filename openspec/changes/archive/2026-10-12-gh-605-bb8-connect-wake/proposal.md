## Why

[Hub #605](https://github.com/jimmie-potts/agent-device-hub/issues/605) cannot use its installed LED/status controls because a sleeping original BB-8 accepts GATT writes but does not answer the initial ping. A bounded private check established that one wake before ping restores valid ping/version replies and ordinary LED/power controls.

## What Changes

- Explicit Connect wakes the robot once after unlock/transmit-power initialization and before ping/version, within the existing deadline.
- Name the dashboard action **Connect and wake**, and explain its initialization effects. Startup, page entry and reconnect remain passive.
- Add a sleeping-robot regression and preserve cancellation, no replay and unsupported-characteristic refusal.
- Keep the existing wire schemas, receipt format, native adapter and installed configuration. No motion, new backups or trial program.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bb8-windows-link`: explicit connect performs one wake before validated protocol replies.
- `bb8-module`: the explicit connection control names its wake effect.

## Impact

Windows PacketTransport, the BB-8 module frontend, focused transport/browser tests and owning guides/specs. No new dependency, state migration, public family or runtime upgrade-profile change. Source delivery and the accepted-helper update remain separate from movement under #606.

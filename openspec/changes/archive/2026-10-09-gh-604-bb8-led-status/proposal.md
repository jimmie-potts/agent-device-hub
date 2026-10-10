## Why

[Hub #604](https://github.com/jimmie-potts/agent-device-hub/issues/604) brings explicit BB-8 connection, LED and power controls into the current B.U.N.N.Y. runtime. Accepted #603 selects the existing Windows Bluetooth adapter and WSL domain owner, with no additional hardware.

## What Changes

- Add the statically registered BB-8 module, passive state reads, simulated transport and browser-only React controls through authenticated tracked commands.
- Add a Windows transport component with typed internal families, bounded PacketV1 transactions, private durable receipts and recovery without device replay.
- Grant a configured helper principal only its internal keys; exclude BB-8 from MCP command execution.
- Register module, transport, package, scenario, browser/accessibility and disposable verification checks.

## Capabilities

### New Capabilities

- `bb8-module`: Enrolled-device LED/status controls, canonical state, durable public outcomes and passive frontend.
- `bb8-windows-link`: Typed source-bound BLE operations, bounded parsing and private receipts.

### Modified Capabilities

- `bunny-runtime`: Narrow configured remote BB-8 helper permissions and MCP command exclusion.

## Impact

New `modules/bb8` and `apps/bb8-windows`; runtime gateway authorization/MCP, workspace scripts/lockfile, CI and owning guides. Uses SDK module API, message profile 2.0, `device/2.1` and `outcome/2.0`; no shared payload wire changes or cross-repository product imports. Source-only delivery; installation and physical qualification belong to #605. Motion, automatic reactions, streams, persistent options and firmware changes remain outside this slice.

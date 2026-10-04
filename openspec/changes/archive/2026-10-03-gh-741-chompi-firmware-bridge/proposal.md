## Why

The owner wants CHOMPI to select and drive Codex and Claude Desktop tasks over USB without MIDI ([#738](https://github.com/jimmie-potts/agent-device-hub/issues/738)). The [#740 qualification](../../../docs/chompi-controller-qualification.md) selected vendor-defined HID, a launcher slot-04 firmware and one bridge process as the only CHOMPI writer. [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741) delivers that firmware and the bridge's transport layer, so the task-routing work in #742 can build on a tested event and light interface.

## What Changes

- Define the language-neutral CHOMPI HID protocol version 1 with shared fixture vectors (`packages/chompi-protocol`).
- Add the controller firmware (`firmware/chompi-controller`): physical scanning, two-part light frames, host-heartbeat timeout with a distinct disconnected pattern, and the launcher-compatible boot layout. No MIDI, no SD card access.
- Add the bridge's portable TypeScript core (`apps/chompi-bridge`): protocol codec, connection manager, single-instance lock, fake transport, a device simulator, a lazily loaded node-hid transport, an OS adapter seam with no input injection yet, and a small CLI.
- Add host-compiled firmware tests, bridge tests and CI coverage; document checks in `docs/development.md`.

## Capabilities

### New Capabilities

- `chompi-controller-firmware`: the CHOMPI controller firmware's protocol behavior, input semantics, light handling and boot/recovery constraints.
- `chompi-bridge`: the bridge transport core's device matching, connection lifecycle, single-writer lock and event/light interface.

### Modified Capabilities

None.

## Impact

New packages only; no Hub, agent-state or controller-contract change. node-hid 3.4.0 is an optional dependency of the bridge only, and CI never loads it. The ARM GCC 10.3-2021.10 toolchain is downloaded in CI for the firmware build. Source-only: firmware installation, bridge installation and physical acceptance belong to #743. Task semantics, Hub feed use, slots, dictation and Send belong to #742. Mac support is a later OS adapter.

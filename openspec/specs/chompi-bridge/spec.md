# chompi-bridge Specification

## Purpose

Define the CHOMPI bridge transport core: which device it opens, how a device session gates input, how it avoids replay and held controls, how one writer is enforced, and the event and light interface it offers task routing.

## Requirements

### Requirement: Controller matching and session gating
The bridge SHALL open only a HID interface matching VID `1209`, PID `000C`, product string `Agent Controller`, usage page `0xFF00` and usage `0x01`, optionally constrained by serial, and SHALL accept input only after a compatible version 1 `hello` with a nonzero epoch and the expected control, encoder and LED counts. It MUST NOT open MIDI or mass storage interfaces. When several devices match and no serial is configured, it SHALL refuse all of them.

#### Scenario: Stock CHOMPI attached
- **WHEN** the CHOMPI presents as MIDI `0483:5740`
- **THEN** the bridge matches nothing and opens no device

#### Scenario: Incompatible hello
- **WHEN** a matching device sends a `hello` with another version, epoch 0 or wrong counts
- **THEN** the bridge accepts no input from it and reports `incompatible-device`

### Requirement: Replay-free input with releases on loss
The bridge SHALL drop input from older epochs, duplicate or older sequences within an epoch, repeated presses and unmatched releases. On stale heartbeat, disconnect or epoch change it SHALL emit synthetic releases for every held control before reporting the state change, and SHALL ignore input until the device session is healthy again.

#### Scenario: Unplug during a held key
- **WHEN** the device disconnects while a key is held
- **THEN** subscribers receive a synthetic release and a `disconnected` event, and nothing from the old epoch is delivered after reconnect

#### Scenario: Bridge restart with device enumerated
- **WHEN** the bridge opens a device that is already enumerated
- **THEN** it stays silent longer than the firmware host timeout, then heartbeats and waits for a fresh `hello` before accepting input

### Requirement: One writer
The bridge SHALL acquire a per-user single-instance lock before enumerating or opening any device, and a second instance SHALL exit with a distinct status without opening a device. The lock SHALL be released when the holding process exits, including on kill.

#### Scenario: Overlapping start
- **WHEN** a second bridge starts while the first holds the lock
- **THEN** the second exits with the lock-held status and the first keeps the device

### Requirement: Event and light interface
The bridge SHALL expose a versioned interface with `connected`, `input`, `stale`, `recovered` and `disconnected` events through bounded subscriptions, and `setLeds` and `setBrightness` commands. A subscriber that overflows SHALL be closed rather than receive a partial stream. Light frames SHALL be sent as two parts with bounded rate and periodic resend. The interface SHALL carry no task semantics.

#### Scenario: Slow subscriber
- **WHEN** a subscriber's queue exceeds its bound
- **THEN** that subscription closes with reason `overflow` and other subscribers are unaffected

### Requirement: Portable core and lazy native transport
The bridge core SHALL run and be tested without native modules. The node-hid transport SHALL load only when the real device transport is selected, and an OS adapter interface SHALL reserve input injection and UI checks without implementing them.

#### Scenario: Linux CI
- **WHEN** the bridge suite runs in CI
- **THEN** no test loads node-hid or touches USB

# CHOMPI HID protocol, version 1

This package holds the language-neutral contract between the CHOMPI controller
firmware (`firmware/chompi-controller`) and the bridge (`apps/chompi-bridge`).
Both sides test against [`fixtures/v1.json`](fixtures/v1.json). The design and
its reasons are in the [qualification report](../../docs/chompi-controller-qualification.md)
and [Hub #741](https://github.com/jimmie-potts/agent-device-hub/issues/741).
The protocol carries physical events and light commands only; task meaning lives
in the bridge.

## Device identity

| Field | Value |
| --- | --- |
| USB class | HID, one vendor-defined collection, usage page `0xFF00`, usage `0x01` |
| VID:PID | `1209:000C`, a [pid.codes](https://pid.codes/1209/) test PID for this single personal device |
| Manufacturer string | `agent-device-hub` |
| Product string | `Agent Controller` |
| Serial | 24 hex characters derived from the STM32 unique ID |
| Reports | 64-byte input and output reports, no report ID, 1 ms interrupt interval |

The bridge opens only a device that matches VID, PID, product string and usage
page, and that answers with a compatible `hello`. It never opens MIDI or mass
storage interfaces.

## Report layout

Every report is exactly 64 bytes. Byte 0 is the message type and byte 1 the
protocol version (`1`). Multi-byte integers are little-endian. Unused bytes are
zero and ignored. A receiver drops a report with an unknown type, another
version or an invalid field, and takes no action for it.

### Device to host

| Type | Name | Bytes 2.. |
| --- | --- | --- |
| `0x01` | `hello` | epoch u16, firmware major, minor, patch u8, control count (34), encoder count (6), LED count (35) |
| `0x02` | `input` | epoch u16, sequence u16, control ID u8, kind u8 (1 press, 2 release, 3 turn), delta i8 |
| `0x03` | `heartbeat` | epoch u16, last applied LED frame u16, flags u8 (bit 0: host heartbeat current) |

- The firmware picks a new random nonzero **epoch** at every boot and every USB
  (re)enumeration. It sends `hello` before any input whenever a host session
  starts: on the first `host-heartbeat` after enumeration and on the first
  `host-heartbeat` after a host timeout, because Windows discards reports sent
  while no handle is open. The epoch may stay the same across a host timeout.
  Input from an older epoch is discarded by the bridge, so a reconnect can never
  replay a press. An epoch of 0 is invalid and the bridge rejects that `hello`.
- On a host timeout the firmware clears its input queue and sends no input until
  the next `hello`.
- **Sequence** starts at 1 per epoch and wraps after 65535. The bridge ignores
  a duplicate or older sequence within an epoch.
- The firmware never queues input while no host is connected. Queued input is
  bounded (32 events); on overflow it drops the oldest and still sends releases
  for keys that are physically up.
- `press` and `release` carry delta 0. `turn` carries a nonzero delta (positive
  is clockwise) and is valid only for encoder turn IDs.
- `heartbeat` is sent every 500 ms.

### Host to device

| Type | Name | Bytes 2.. |
| --- | --- | --- |
| `0x81` | `leds` | frame u16, part u8 (0 or 1), count u8, then `count` RGB triples |
| `0x82` | `host-heartbeat` | profile version u32, brightness percent u8 (0-100) |

- A light frame has two parts: part 0 carries LEDs 0-18 (19 triples), part 1
  carries LEDs 19-34 (16 triples). The firmware applies a frame only after both
  parts with the same frame number arrive, then reports it in `heartbeat`.
- Colors are RGB; the firmware converts to each chain's order (keys GRB, panel
  RGB) and applies its own caps (panel about 9%, keys about 25%) after the
  host's brightness percent.
- After opening the device the host stays silent for 2.5 s, longer than the
  firmware's host timeout, then sends `host-heartbeat` every 500 ms and waits for
  `hello`. Without a heartbeat for 2 s the firmware
  shows the disconnected pattern: a slow dim white breathe on the CHOMPI key LED
  only, with every other LED off. No task state uses that pattern.

## Control and LED IDs

| IDs | Controls |
| --- | --- |
| 1-15 | Front-row white keys, left to right (task slots) |
| 16-25 | Second-row black keys, left to right |
| 26 | CHOMPI key |
| 27 | Play |
| 28 | Loop |
| 29-34 | Clicks of encoders `ENC_1`-`ENC_6` |
| 41-46 | Turns of encoders `ENC_1`-`ENC_6` |

Encoder numbers follow the firmware. The four small top knobs, left to right,
are `ENC_4`, `ENC_1`, `ENC_2`, `ENC_3`; `ENC_5` is very likely the big wheel
and `ENC_6` is the volume knob. Profiles map positions to IDs, and #743 confirms
the physical identities. The far-left switch is never reported.

| LED index | Light |
| --- | --- |
| 0-24 | Under keys 1-25 |
| 25 | CHOMPI key |
| 26-29 | Small knobs `ENC_4`, `ENC_1`, `ENC_2`, `ENC_3` |
| 30-31 | Big wheel, two LEDs |
| 32 | Play |
| 33 | Loop |
| 34 | Volume knob |

Keys 26-28 have panel LEDs (indices 25, 32, 33) rather than key-chain LEDs.

## Fixture vectors

`fixtures/v1.json` lists named reports as 64-byte hex strings with their decoded
message, plus invalid reports with the rejection reason both sides must report:
`unknown-type`, `unsupported-version`, `invalid-length`, `invalid-control`,
`invalid-kind`, `invalid-delta`, `invalid-led-range`, `invalid-brightness` and
`incompatible-device`. A change to any value here is a new protocol version.

# chompi-controller-firmware Specification

## Purpose

Define the CHOMPI controller firmware: its USB identity and protocol behavior, session and replay rules, physical input semantics, light handling and the launcher-compatible artifact.

## Requirements

### Requirement: Controller USB identity and protocol
The controller firmware SHALL enumerate as one vendor-defined HID interface with VID `1209`, PID `000C`, product string `Agent Controller`, usage page `0xFF00` and 64-byte reports, and SHALL implement CHOMPI HID protocol version 1 as defined by `packages/chompi-protocol`. It MUST NOT present MIDI or mass storage and MUST NOT mount the SD card.

#### Scenario: Shared fixture vectors
- **WHEN** the firmware's protocol module processes every vector in `packages/chompi-protocol/fixtures/v1.json`
- **THEN** valid reports round-trip to the stated message and invalid reports are rejected with the stated reason and cause no action

### Requirement: Session start and replay protection
The firmware SHALL pick a new random nonzero epoch at every boot and USB enumeration, SHALL send `hello` before any input when a host session starts (the first host heartbeat after enumeration or after a host timeout), and SHALL number input events from 1 within an epoch. It MUST NOT queue input while no host session is active. On host timeout it MUST clear its input queue, turn its lights off and report light frame 0 until a new frame is applied.

#### Scenario: Bridge restarts while the device stays enumerated
- **WHEN** host heartbeats stop for more than 2 s and later resume
- **THEN** the firmware sends `hello` before any further input and sends no input generated during the gap

#### Scenario: Bounded queue
- **WHEN** more than 32 input events are pending
- **THEN** the oldest are dropped and keys that are physically up still produce releases

### Requirement: Physical input semantics
The firmware SHALL debounce keys, report press and release separately, report encoder turns with signed nonzero deltas separately from encoder clicks, and SHALL NOT report the far-left switch. It MUST NOT reuse the stock shipping-mode or test-mode boot holds as controls.

#### Scenario: Encoder turn versus click
- **WHEN** an encoder is turned while its click is held
- **THEN** the firmware reports the click press, turn events with deltas on the turn ID and the click release, each as separate events

### Requirement: Light frames and disconnected display
The firmware SHALL apply a light frame only after both parts with the same frame number arrive, SHALL convert to each chain's color order and SHALL apply its brightness caps after the host's brightness percent. Without a host heartbeat for 2 s it SHALL show the disconnected pattern, a dim breathe on the CHOMPI key LED only, which no task state uses.

#### Scenario: Partial frame
- **WHEN** only part 0 of a frame arrives before a newer frame
- **THEN** the incomplete frame is never shown

#### Scenario: Host loss
- **WHEN** the bridge stops sending heartbeats
- **THEN** within 2 s every task light turns off and the disconnected pattern shows

### Requirement: Launcher-compatible artifact
The firmware SHALL build with GNU Arm Embedded Toolchain 10.3-2021.10 as a BOOT_SRAM image that fits the 232 KiB code region, SHALL place libDaisy's `boot_info` at `0x38800000`, SHALL stop LED DMA before any reset, and SHALL be installable as `/FIRMWARE/04_AGENT.bin` without changing the bootloader or other slots. Its notices SHALL carry the upstream MIT and third-party licenses.

#### Scenario: Artifact check
- **WHEN** the ARM build completes
- **THEN** the artifact check confirms the size and memory regions, `boot_info` at `0x38800000` and the controller USB identity bytes

### Requirement: USB reconnection without a power cycle
The firmware SHALL restart its USB device (detach, re-initialize and re-attach) once the device has been neither configured nor addressed by the host for 3 s, and SHALL retry every 5 s while it stays that way, so the host enumerates it again after an unplug and replug, a cable bump or a brief drop of the data lines. It MUST NOT restart a configured device, including one suspended under a sleeping host, MUST NOT restart a device the host addressed and left unconfigured (a disabled device, a failed or slow driver install, SET_CONFIGURATION 0), and MUST NOT depend on the charger's input-power reading for this decision. Each new enumeration SHALL start a new epoch as on any enumeration.

#### Scenario: Unplug and replug while running
- **WHEN** the USB cable is unplugged for a few seconds and plugged back in while the controller keeps running on battery
- **THEN** the host enumerates the controller again without a power cycle and the bridge reconnects with a new epoch

#### Scenario: Host leaves the device unconfigured on purpose
- **WHEN** the host addresses the device but does not configure it, for example because the device is disabled in Windows
- **THEN** the firmware does not restart its USB device

#### Scenario: Sleeping host
- **WHEN** the host suspends the bus while the device stays configured
- **THEN** the firmware does not restart its USB device

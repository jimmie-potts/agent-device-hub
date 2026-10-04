## ADDED Requirements

### Requirement: Controller USB identity and protocol
The controller firmware SHALL enumerate as one vendor-defined HID interface with VID `1209`, PID `000C`, product string `Agent Controller`, usage page `0xFF00` and 64-byte reports, and SHALL implement CHOMPI HID protocol version 1 as defined by `packages/chompi-protocol`. It MUST NOT present MIDI or mass storage and MUST NOT mount the SD card.

#### Scenario: Shared fixture vectors
- **WHEN** the firmware's protocol module processes every vector in `packages/chompi-protocol/fixtures/v1.json`
- **THEN** valid reports round-trip to the stated message and invalid reports are rejected with the stated reason and cause no action

### Requirement: Session start and replay protection
The firmware SHALL pick a new random nonzero epoch at every boot and USB enumeration, SHALL send `hello` before any input when a host session starts (the first host heartbeat after enumeration or after a host timeout), and SHALL number input events from 1 within an epoch. It MUST NOT queue input while no host session is active and MUST clear its input queue on host timeout.

#### Scenario: Bridge restarts while the device stays enumerated
- **WHEN** host heartbeats stop for more than 2 s and later resume
- **THEN** the firmware sends `hello` before any further input and sends no input generated during the gap

#### Scenario: Bounded queue
- **WHEN** more than 32 input events are pending
- **THEN** the oldest are dropped and keys that are physically up still produce releases

### Requirement: Physical input semantics
The firmware SHALL debounce keys, report press and release separately, report encoder turns with signed nonzero deltas separately from encoder clicks, and SHALL NOT report the far-left switch. It MUST leave the shipping-mode and test-mode boot holds unchanged.

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

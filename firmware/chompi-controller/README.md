# Agent controller firmware for the CHOMPI

This firmware turns a CHOMPI into a plain USB controller for the agent device
hub. It reports key presses, knob turns and clicks to one Windows bridge
(`apps/chompi-bridge`) and shows the colors the bridge sends. It speaks the
vendor HID protocol in
[`packages/chompi-protocol`](../../packages/chompi-protocol/README.md). It runs
from launcher slot 04. The design comes from the
[qualification report](../../docs/chompi-controller-qualification.md) and
[Hub #741](https://github.com/jimmie-potts/agent-device-hub/issues/741).

**Status: source only.** The image builds and passes host tests and artifact
checks. It has not run on a device. Installation and physical acceptance
belong to [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743).

## What it does and does not do

- Presents USB HID `1209:000C`, "agent-device-hub" / "Agent Controller", with
  a 24-hex-digit serial from the STM32 unique ID. It exposes one vendor
  collection (usage page `0xFF00`) with 64-byte reports at 1 ms. Windows binds
  its built-in HID driver.
- Reports keys 1-28, six encoder clicks (IDs 29-34) and six encoder turns
  (IDs 41-46). Turns and clicks come from separate lines, so a turn is never
  a click. The far-left two-position switch is never reported.
- Debounces every key and click with 7 consecutive samples at 1 kHz, about
  7 ms. It decodes encoders with the stock CHOMPI quadrature rules. Positive
  deltas follow the upstream "clockwise" sign. #743 confirms the physical
  direction.
- Picks a new random nonzero epoch at every enumeration. A host session starts
  with the first `host-heartbeat` after an enumeration or after a 2 s host
  timeout, and `hello` goes out before any input in that session.
- Sends input only while a host is live. Up to 32 events wait for the
  endpoint, and the oldest is dropped on overflow. A release lost that way is
  resent once the key is physically up. Consecutive turns of one encoder merge
  into one event.
- On a host timeout it clears the queue, so nothing is replayed. A key held
  when a session starts, including a key held at power-on, reports nothing
  until it is released and pressed again.
- Applies a light frame only after both parts of the same frame number arrive.
  It scales by the host brightness, then by the stock caps: keys at 1/4,
  panel at 1/11.
- With no live host it shows the disconnected pattern: a slow (4 s) dim white
  breathe on the CHOMPI key LED, all other LEDs off. When the host returns,
  the old frame stays cleared.
- Sends a `heartbeat` every 500 ms with the last applied frame and whether the
  host heartbeat is current.

It never mounts the SD card, so it cannot change music data. It has no audio,
no MIDI and no CDC serial port, and it does not present the stock
`0483:5740` identity. It also does not implement the stock boot holds:
CHOMPI + Play + Loop at power-on (shipping mode) and the volume click at
power-on (test mode). Holding them does nothing here, and the firmware gives
them no other meaning.

It keeps two hardware behaviors from the launcher:

- **USB switch handshake.** At power-on the charger gets the USB data lines
  for port detection, and the firmware then takes them back. A charger
  interrupt can lend the lines out again for a new detection.
- **Low-battery lockout.** When the battery is low and unplugged, the panel
  flashes amber for 15 s. The firmware then stops the LED DMA, leaves USB,
  gives the data lines back and enters shipping mode. On a weak charger with
  a low battery, the LEDs go dark and the MCU sleeps.

Software return to the launcher stays deferred, as #741 decided. To leave the
controller, power-cycle the CHOMPI.

## Layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure C++ with no hardware dependency: protocol codec, debounce and encoder decoding, the event queue, epoch choice, the session controller, light rendering and the USB descriptors |
| `src/hw/` | Board layer on libDaisy: inputs and charger (`board`), the WS2812 DMA driver (`led_driver`), the USB switch handshake (`usb_switch`) and the vendor HID class (`usb_hid`) |
| `src/main.cpp` | Main loop |
| `test/` | Host tests and a small JSON reader for the shared fixtures |
| `scripts/fetch-upstream.sh` | Fetches the pinned upstream sources into `.upstream/` (ignored) |
| `scripts/check-artifact.sh` | Checks a built image |

## Build

You need `make`, `git`, a host C++17 compiler (`g++` or `clang++`) and
[GNU Arm Embedded Toolchain 10.3-2021.10](https://developer.arm.com/downloads/-/gnu-rm),
the release libDaisy and the CHOMPI firmwares are built with. Either put its
`bin` directory on `PATH` or pass `ARM_GCC_BIN=<dir>`. The build stops if
`arm-none-eabi-gcc` is another version.

```sh
cd firmware/chompi-controller
make test                    # host tests against packages/chompi-protocol/fixtures/v1.json
scripts/fetch-upstream.sh    # once: pinned sources into .upstream/
make                         # build/arm/04_AGENT.bin
make check                   # build, then scripts/check-artifact.sh
```

`make test` builds with AddressSanitizer and UndefinedBehaviorSanitizer by
default. Pass `HOST_SANITIZE=` to turn them off, or `HOST_CXX=clang++` to use
another compiler.

`fetch-upstream.sh` makes shallow, blobless, sparse checkouts and verifies each
pinned commit:

| Directory | Source | Used for |
| --- | --- | --- |
| `.upstream/chompi` | [CHOMPI-Club/CHOMPI](https://github.com/CHOMPI-Club/CHOMPI/tree/a73d732613da684e4de844619b690776f0f50ccf) `a73d732613da684e4de844619b690776f0f50ccf` | The prebuilt CHOMPI libDaisy (`firmware/chompi-wave/code/libs/libDaisy`: `build/libdaisy.a`, headers, `core/startup_stm32h750xx.c`), about 35 MB |
| `.upstream/launcher` | [sfaber02/CHOMPI](https://github.com/sfaber02/CHOMPI/tree/79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415) launcher-v1.1 `79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415` | `firmware/chompi-launcher/code/src/chompi_sram.lds`, the app linker script with the `BACKUP_SRAM` fix. The launcher sources the board layer adapts are kept for reference |

DaisySP is not fetched or linked; the controller has no DSP.

### Recorded build (2026-10-03)

GNU Arm Embedded Toolchain 10.3-2021.10 (GCC 10.3.1 20210824), `-O2`:

- `build/arm/04_AGENT.bin`: 82,844 bytes, SHA-256
  `22ea2dfd6e1948bc57e649c28e2e0f681e4d23c43649ce34d3055bb2ef8119b4`.
  Two clean builds from different directories produced the same image.
- `libdaisy.a` SHA-256
  `965f24d4002afe479e3bb56bbe4e73cac9c383ff9f5468b7bc119d60bd453462`.
- `boot_info` at `0x38800000`, in backup SRAM.

| Region | Used | Size | Use |
| --- | --- | --- | --- |
| SRAM_EXEC | 82,844 B | 232 KB | 34.87% |
| SRAM | 16,468 B | 280 KB | 5.74% |
| RAM_D2 | 22,048 B | 32 KB | 67.29% |
| BACKUP_SRAM | 12 B | 4 KB | 0.29% |

`make check` verifies the following:

- The image fits SRAM_EXEC and the launcher's 512 KiB limit.
- The vector table is at `0x24000000`, with the stack at `0x20020000` and a
  reset handler inside the image.
- `boot_info` is at `0x38800000`, and every allocated section is in AXI SRAM,
  RAM_D2, DTCM or backup SRAM.
- The image contains the `1209:000C` device descriptor and both strings.
- No FatFs, SD, CDC, MIDI or libDaisy `UsbHandle` symbols are linked, and the
  stock `0483:5740` bytes are absent.

## Install by copying (owner-operated, #743)

Flashing, card changes and device tests need the owner's explicit authority
under #743. Only the launcher's USB storage mode is used. The launcher's MIDI
firmware upload stays unused.

1. Install the [launcher v1.1](https://github.com/sfaber02/CHOMPI/releases/tag/launcher-v1.1)
   once from a card reader, after backing up the stock card.
2. Power-cycle the CHOMPI and press key 15 to start USB storage mode. The
   card appears on Windows as `CHOMPI-SD`.
3. Copy `build/arm/04_AGENT.bin` to `/FIRMWARE/04_AGENT.bin`. Do not touch the
   `/TAPE`, `/TEMPO` or `/WAVE` folders or the root `CHOMPI.bin`.
4. Eject the drive, then power-cycle. The launcher lights key 4. Press it.
5. The CHOMPI key breathes dim white until the bridge connects.

Save TAPE work before any restart. Its looper buffer lives in SDRAM and is
lost when the firmware changes.

## Recovery

In order:

1. **Power-cycle.** The launcher picker always comes back. This firmware
   writes neither internal flash nor QSPI, so the picker survives a bad
   controller build.
2. **Remove or replace the image.** Boot key 15, then delete or replace
   `/FIRMWARE/04_AGENT.bin`.
3. **Restore the card** from the backup over USB storage, or swap in the
   stock card.
4. **Reflash the bootloader** at <https://flash.daisy.audio> in ROM DFU mode.
   This is outside the epic's current authority and needs a separate owner
   decision.

## Licenses and attribution

The code in `src/` and `test/` is this repository's. Five files adapt MIT code
from the CHOMPI repositories and say so in their headers: `src/core/input.cpp`
(encoder rules), `src/hw/board.*`, `src/hw/led_driver.*`, `src/hw/usb_switch.*`
and `src/hw/usb_hid.cpp` (class pattern). The binary links Electrosmith's
libDaisy (MIT), the STM32 HAL (BSD-3-Clause), CMSIS (Apache-2.0) and the ST
USB Device Library (ST SLA0044, ST parts only). [THIRD_PARTY.md](THIRD_PARTY.md)
has every notice. Per CHOMPI Club's `TRADEMARKS.md`, the device presents
itself as "Agent Controller", not CHOMPI.

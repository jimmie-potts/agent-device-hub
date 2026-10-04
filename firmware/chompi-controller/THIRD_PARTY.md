# Third-party notices

This directory holds no upstream source trees or binaries.
`scripts/fetch-upstream.sh` downloads the pinned upstream sources into the
ignored `.upstream/` directory at build time. Each component keeps its own
license files and file headers there. The built image `04_AGENT.bin` contains
code from the components marked "linked" below, so anyone who redistributes
the image must ship these notices with it.

## CHOMPI firmware, launcher and USB storage fork (MIT)

| Component | Revision | Use |
| --- | --- | --- |
| [CHOMPI-Club/CHOMPI](https://github.com/CHOMPI-Club/CHOMPI/tree/a73d732613da684e4de844619b690776f0f50ccf) | `a73d732613da684e4de844619b690776f0f50ccf` | WAVE hardware map, encoder rules and LED map; source of the vendored libDaisy |
| [sfaber02/CHOMPI](https://github.com/sfaber02/CHOMPI/tree/79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415) launcher-v1.1 | `79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415` | App linker script with the `BACKUP_SRAM` fix (used as fetched); board layer, LED driver and USB switch handshake (adapted) |
| [lnetzel/CHOMPI-lnetzel](https://github.com/lnetzel/CHOMPI-lnetzel) usb-storage | `a609509475a2949baf916a82686aaceff804447f` | Custom USB class pattern on libDaisy's ST core (adapted, not fetched) |

Adapted files, each marked in its header:

- `src/core/input.cpp`: quadrature rules from `firmware/chompi-wave/code/src/encoder.cpp`.
- `src/core/hardware_map.h`, `src/core/leds.cpp`: bit order and LED positions from
  `hardware.h` and `TestPage.h`.
- `src/hw/board.*`: from `firmware/chompi-launcher/code/src/hardware.h`.
- `src/hw/led_driver.*`: from `firmware/chompi-launcher/code/src/temp_led_stuff.h`.
- `src/hw/usb_switch.*`: from `UsbTakeOver()` and `ServiceUsbSwitch()` in
  `firmware/chompi-launcher/code/src/launcher_main.cpp`.
- `src/hw/usb_hid.cpp`: class structure from
  `firmware/chompi-usb-storage/code/src/usb_msc.cpp`.

All three repositories carry this license:

```text
MIT License

Copyright (c) 2026 CHOMPI Club

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

CHOMPI's `THIRD_PARTY.md` credits Electrosmith for the hardware design, the
original firmware platform and the Daisy Bootloader. CHOMPI Club's
`TRADEMARKS.md` keeps the CHOMPI name and marks outside the MIT grant. This
firmware therefore presents itself as "Agent Controller" and does not claim to
be a CHOMPI Club release.

## Linked into the image

| Component | Copyright | License | Notes |
| --- | --- | --- | --- |
| libDaisy, Electrosmith's CHOMPI adaptation of v5.4.0 (`build/libdaisy.a`, headers, `core/startup_stm32h750xx.c`) | (c) 2019 Electrosmith | MIT | Linked prebuilt from `firmware/chompi-wave/code/libs/libDaisy`. Its `LICENSE` is in `.upstream/` |
| STM32H7 HAL and LL drivers, STM32H7xx CMSIS device headers | (c) 2017-2019 STMicroelectronics | BSD-3-Clause | Inside `libdaisy.a`, per file headers |
| STM32 USB Device Library core, libDaisy `usbd_conf.c` | (c) 2015-2019 STMicroelectronics | ST Ultimate Liberty license SLA0044 | Inside `libdaisy.a`. SLA0044 allows use only with ST microcontrollers; the CHOMPI's Daisy Seed uses an STM32H750 |
| STM32 USB Host Library core, libDaisy `usbh_conf.c` (parts) | (c) 2015-2019 STMicroelectronics | ST Ultimate Liberty license SLA0044 | Linked only because libDaisy's shared `OTG_HS_IRQHandler` references the host handle. Host mode is never started |
| CMSIS core headers | (c) 2009-2016 ARM Limited | Apache-2.0 | Headers only |
| newlib-nano, libgcc | GNU Arm Embedded Toolchain 10.3-2021.10 | BSD-style newlib licenses; GCC Runtime Library Exception | From the compiler |

## Not used

- **DaisySP** (MIT, Electrosmith): not fetched or linked, because the
  controller has no DSP.
- **FatFs** (ChaN's BSD-style license): not linked. The controller never
  mounts the card, and `scripts/check-artifact.sh` fails if any FatFs or SD
  symbol is present.
- **TinyUSB**, **coreJSON**: not used.

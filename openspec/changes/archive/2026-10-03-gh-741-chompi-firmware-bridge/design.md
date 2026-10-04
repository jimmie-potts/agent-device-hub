## Context

The #740 report fixes the hardware facts (28 keys, six clickable encoders, 35 RGB LEDs, the USB3740B switch), the launcher constraints (BOOT_SRAM, 232 KiB code, the `BACKUP_SRAM` fix, `/FIRMWARE/NN_NAME.bin` slots) and the owner decisions: non-MIDI USB, card installs through launcher USB storage, a portable TypeScript bridge with OS adapters, and one writer per device. CHOMPI's libDaisy ships only a CDC class with the generic ST identity.

## Goals / Non-Goals

**Goals:** a protocol both sides test against; firmware that reports physical events honestly and never replays them; a bridge core that accepts input only from a verified device session, releases everything on loss, and refuses to run twice.

**Non-Goals:** task routing, Hub feed, slots, dictation, Send, keystroke injection, UI checks (#742); installation and physical acceptance (#743); software return to the launcher, Mac adapter, multi-device support, firmware update over USB.

## Decisions

1. **Vendor HID, `1209:000C`.** A custom class on libDaisy's ST core, as the USB storage firmware does, avoids a libDaisy rebuild and gives framed 64-byte reports with built-in Windows drivers. The pid.codes test PID suits one personal device; the bridge also matches product string and usage page, and requires a compatible `hello`. Rejected: CDC (byte stream, generic ST identity, busy-transmit drops) and MIDI (owner decision; the launcher accepts SysEx firmware writes).
2. **Session-scoped `hello` and epochs.** Windows discards reports while no handle is open, so the firmware sends `hello` when a host session starts (the first host heartbeat after enumeration or after a host timeout), not only at boot. Every boot and enumeration picks a new nonzero epoch. The bridge drops input from older epochs and older or duplicate sequences, so reconnects never replay a press.
3. **No queued input across a gap.** The firmware queues at most 32 events, never while no host is connected, and clears the queue on host timeout. The bridge releases every held control on stale or disconnect, emitting synthetic releases so subscribers never keep a modifier held.
4. **Two-part atomic light frames.** 35 RGB triples do not fit one report, so a frame has two parts applied together. The firmware converts color order and applies its own brightness caps after the host's percentage, so the host cannot overdrive the LEDs.
5. **Distinct disconnected display.** Without host heartbeats for 2 s, only the CHOMPI key LED breathes dim white. No task state uses that pattern, so a stale connection never looks like completion.
6. **Single-instance lock before device open.** hidapi opens Windows HID devices shared, so exclusivity comes from a per-user IPC endpoint (a named pipe on Windows, a Unix socket elsewhere) whose `listen` fails while another instance holds it and frees on process exit.
7. **Portable core with lazy native transport.** The codec, connection manager, lock, simulator and CLI are plain TypeScript tested on Linux with a fake transport and a manual clock. node-hid (MIT, N-API prebuilds for win32/darwin/linux) loads only in the real transport. An OS adapter interface reserves keystrokes, foreground identity and UI checks for #742.
8. **No card access in the controller firmware.** The controller never mounts the SD card, so it cannot damage music data; profiles live on the host.

## Risks / Trade-offs

- The pid.codes test PID is not unique worldwide → the product-string, usage-page and `hello` checks reject other test devices; a second matching device makes the bridge refuse both without `--serial`.
- Encoder steps can drop at fast spins (1 kHz scan) → acceptable for navigation; #743 observes it.
- Physical big-wheel identity (`ENC_5`) is inferred from the board → profiles map IDs; #743 confirms.
- The firmware cannot be exercised on hardware in CI → host tests cover pure modules; the ARM build and artifact checks run in CI; device behavior is #743's acceptance.

## Migration Plan

None: new firmware slot and new packages. Rollback is removing `/FIRMWARE/04_AGENT.bin` from the card or restoring the backup; music slots are untouched.

## Open Questions

None blocking. #743 records the physical control identities and detents.

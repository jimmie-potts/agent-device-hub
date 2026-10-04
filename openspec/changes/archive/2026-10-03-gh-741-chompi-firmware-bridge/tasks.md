## 1. Protocol

- [x] 1.1 Define protocol version 1, device identity, control and LED IDs, and fixture vectors in `packages/chompi-protocol`, including session-scoped `hello`.

## 2. Firmware

- [x] 2.1 Write failing host tests for fixtures, debounce, encoder turn/click separation, bounded queue, session `hello`, host timeout and two-part light frames; implement the pure modules until they pass.
- [x] 2.2 Implement the hardware layer, USB switch handling, vendor HID class and disconnected display; build the ARM artifact and pass the artifact check.
- [x] 2.3 Record upstream pins, licenses, size and memory usage in the firmware README and `THIRD_PARTY.md`.

## 3. Bridge

- [x] 3.1 Write failing tests for the codec, session gating, epoch and sequence rules, synthetic releases, stale handling, light frames, bounded subscriptions, the lock and the CLI; implement until they pass.
- [x] 3.2 Add the simulator, the lazy node-hid transport and the OS adapter seam; run the native Windows check read-only.

## 4. Validation and delivery

- [x] 4.1 Add firmware and bridge checks to `docs/development.md` and CI, adding an eighth Firmware CI job.
- [x] 4.2 Run build, typecheck, bridge, firmware and workflow checks; record results.
- [x] 4.3 Synchronize the new specs and archive this change before final review.

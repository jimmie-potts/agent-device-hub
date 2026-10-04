# CHOMPI bridge

Status: source only, from [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741). Nothing installs or
starts it. Installed bridge and firmware acceptance belong to [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743).
Task routing, the Hub feed, slots, Wispr and Send belong to [#742](https://github.com/jimmie-potts/agent-device-hub/issues/742).

`@jimmie-potts/chompi-bridge` is the one Windows process that owns the CHOMPI controller's USB connection. It speaks
[CHOMPI HID protocol v1](../../packages/chompi-protocol/README.md) and offers a small, versioned event and feedback
interface. It carries physical events and light commands only; it has no task concepts. The core is portable
TypeScript on Node 24. USB goes through [node-hid](https://github.com/node-hid/node-hid), and keystrokes, foreground
identity and UI checks sit behind one OS adapter interface. Boundaries and the owner's decisions are in the
[qualification report](../../docs/chompi-controller-qualification.md#boundary-and-ownership).

## Ownership

- **Single instance.** `run` takes a per-user lock before it creates a transport. The lock is a local IPC endpoint:
  the named pipe `\\.\pipe\agent-chompi-bridge-<user>` on Windows, or a Unix socket in `$XDG_RUNTIME_DIR` (else a
  private `agent-chompi-bridge-<uid>` directory under the temp directory). A second instance exits with code 3 and
  `chompi-bridge-already-running` without opening the device. The operating system releases the lock when the
  holder exits. A Unix socket file left by a killed holder is replaced only after a connection probe is refused and
  only when it is a socket owned by the same user in a directory nobody else can write.
  Known limit: if two instances of the same user recover the same stale Unix socket at the same moment, both could
  end up holding a lock. Unix hosts are not qualified for the bridge; Windows uses a named pipe, which leaves no
  file behind and has no such window.
- **Exact device.** The bridge opens only a HID interface with VID `0x1209`, PID `0x000C`, product
  `Agent Controller`, usage page `0xFF00` and usage `0x01`, and, when given `--serial`, that serial. Two matching
  controllers without a serial are refused. The stock CHOMPI presents MIDI under `0483:5740` and never matches;
  the bridge never opens MIDI or mass storage. hidapi opens Windows HID devices with shared access, so the lock,
  not the open, keeps the bridge the only writer.

## Connection behavior

- After opening, the bridge stays silent for 2.5 s, longer than the firmware's 2 s host timeout. The firmware sends
  `hello` with the first host heartbeat after enumeration or after a host timeout, so the next heartbeat starts a
  fresh host session even when the device was already enumerated. If no `hello` comes within 3 s more, the bridge
  closes the handle and enumerates again.
- Input counts only after a compatible `hello` (34 controls, 6 encoders, 35 LEDs, nonzero epoch). Input from any
  other epoch is dropped. Within an epoch, a duplicate or older sequence is dropped, using 16-bit serial-number
  order so wraparound is accepted. A repeated press and a release without a press are dropped too.
- The bridge sends `host-heartbeat` every 500 ms with the profile version and brightness percent.
- With no device heartbeat for 1.5 s, the bridge releases every held control and emits `stale`. A heartbeat in the
  same epoch emits `recovered`; released controls need a fresh press. After 5 s the bridge closes the handle, emits
  `disconnected` (`heartbeat-timeout`) and searches again. A stale link is a link state, separate from any task
  state.
- On disconnect, epoch change or stop, every held control gets a synthetic `release` (with `synthetic: true` and the
  reason) before `disconnected`, so nothing stays held. A reconnect needs a new handle and a new `hello`, and never
  replays input.
- **Firmware host-session restart.** A device heartbeat whose host-current flag is clear, or a `hello` on the current
  epoch, means the firmware restarted its host session: it turned its lights off, reports frame 0 and forgot which
  keys it reported down. The bridge releases every held control with reason `session-restart`, stops trusting the
  applied light frame and ignores input until that `hello`. On the `hello` it resets the sequence baseline and
  resends its current light frame under a new frame number. Keys still held then need a fresh press. If the flag
  drops and no `hello` follows within 5.5 s, the bridge closes the handle with reason `hello-timeout` and enumerates
  again. After the releases it emits one `session-restart` event per restart; a flag drop followed by the
  firmware's same-epoch `hello` is one restart, and that `hello` completes it. A `hello` proves the device is live,
  so completing a restart that began while stale, or a same-epoch `hello` while stale, also emits `recovered`.
- LED frames go out as the protocol's two parts. The first frame of a connection waits for the device heartbeat, so
  its frame number follows the device's last applied frame. Frame numbers skip 0, which the firmware reports after a
  host timeout. A frame the device has not reported as applied is resent every second. Frames are at most one per
  40 ms; a newer frame replaces a waiting one. The last frame is sent again after a reconnect or session restart.
  `status().appliedLedFrame` is the bridge's own last frame once the device reports it, and null otherwise.
- A brightness change sends an early host heartbeat at most once per 40 ms; a burst coalesces to the newest value,
  so it cannot fill the bounded write queue (32 writes) and drop a healthy link.
- `stop()` waits up to 2 s for an open in flight and closes that handle before it resolves. If the open takes longer,
  `stop()` resolves anyway and the handle is closed as soon as it opens.
- Malformed or incompatible reports are counted by reason in `status().counters` and otherwise ignored.

## Interface for #742 (version 1)

```ts
import { createChompiBridge, createNodeHidTransport, acquireInstanceLock } from '@jimmie-potts/chompi-bridge';

const lock = await acquireInstanceLock();          // before any device open
const bridge = createChompiBridge({ transport: createNodeHidTransport(), profileVersion: 1 });
bridge.start();
for await (const event of bridge.events()) {
  // event.type: 'connected' | 'input' | 'stale' | 'recovered' | 'session-restart' | 'disconnected'
}
bridge.setLeds(colors);      // 35 [r, g, b] triples, LED index order from the protocol README
bridge.setBrightness(40);    // 0-100, before the firmware's own caps
await bridge.stop();
await lock.release();
```

- `connected`: `{ epoch, firmware }`. Input is accepted only in this epoch.
- `input`: `{ epoch, sequence, control, kind, delta, synthetic }`. `kind` is `press`, `release` or `turn`;
  `control` is the protocol control ID (1-34 clicks, 41-46 turns); `delta` is nonzero only for turns (positive is
  clockwise). Synthetic releases have `sequence: null` and a `reason`.
- `stale` and `recovered`: `{ epoch }`. `recovered` comes exactly once when the link leaves `stale` for a healthy
  session: on the next heartbeat, or when a same-epoch `hello` completes a session restart (then after
  `session-restart`). It always precedes any input accepted afterwards.
- `session-restart`: `{ epoch, cause }`, with cause `host-flag-dropped` or `same-epoch-hello`. The firmware restarted
  its host session in the same epoch. Synthetic releases for every held control come first, and input after the
  event is fresh, so a consumer should drop anything pending, such as a selected target. It comes once per restart:
  the `hello` that follows a flag drop does not emit a second one.
- `disconnected`: `{ epoch, reason }`, with reason `device-closed`, `transport-error`, `heartbeat-timeout`,
  `hello-timeout`, `epoch-change` or `stopped`. A synthetic release can also carry `stale` or `session-restart`.
- Every event has `at`, the clock time in milliseconds.

Each subscription is a bounded queue (256 events by default, `events({ limit })`). A subscriber that falls behind is
closed with `closedReason: 'overflow'` and its queue is discarded, so it never sees a press without its release;
treat that end like a disconnect. `BRIDGE_INTERFACE_VERSION` increments on any breaking change to these types.

For development without hardware, `ChompiSimulator` plays the device side of protocol v1 behind the same
`Transport` interface: `plug`, `unplug`, `press`, `release`, `click`, `turn`, `pauseHeartbeats`, `dropHostReports`,
`sendRaw`, plus the applied `leds`, `appliedFrame`, `brightnessPercent`, `pressed` and `display` (`host` or
`disconnected`). It follows the firmware rules: `hello` only with the first host heartbeat after enumeration or a
host timeout; on a timeout, lights off, frame 0 and reported keys forgotten; keys held at session start stay silent
until pressed again; sequence wraps from 65535 to 1. `ManualClock` runs the bridge and simulator in virtual time.
`FakeTransport` is the lower-level test double.

The OS adapter (`OsAdapter`, version 0) is only a type and a Windows stub whose methods reject with
`os-adapter-not-implemented`. #742 implements it; nothing here sends keystrokes or opens links.

## Commands

Run from the repository root after `npm run build`:

```sh
node apps/chompi-bridge/bin/chompi-bridge.mjs probe              # read-only enumeration
node apps/chompi-bridge/bin/chompi-bridge.mjs monitor --simulate # scripted simulator session, JSON lines
node apps/chompi-bridge/bin/chompi-bridge.mjs run [--simulate] [--test-pattern] [--serial <hex>]
```

- `probe` lists matching controllers by VID, PID, product, usage page and usage, and only counts other HID devices.
  It prints no serials or paths and opens nothing.
- `monitor --simulate` runs a fixed press, turn, unplug, replug and stop script in virtual time and exits.
- `run` takes the lock, connects and prints events as JSON lines until SIGINT or SIGTERM. Only `--test-pattern`
  sends LED frames (a static dim gradient). Without `--simulate` it opens the real controller, which is #743 work
  and needs the owner's device authorization.

Exit codes: 0 success, 1 failure, 2 usage, 3 another instance holds the lock.

## Dependencies

node-hid 3.4.0 is an optional dependency of this package only (license MIT or X11; it bundles hidapi under its
BSD, GPLv3 or original license choice; node-addon-api and pkg-prebuilds are MIT). Its N-API v4 prebuilt binaries
include `win32-x64`, so Node 24 needs no native build. The transport loads it lazily, so Linux builds and tests
never load the native module. `@jimmie-potts/chompi-protocol` supplies the fixture vectors the tests run.

## Checks

From the repository root with Node 24:

```sh
npm ci
npm run build
npm run typecheck
npm run test:chompi-bridge
```

The suite runs every protocol fixture vector, the connection rules above against a fake transport and a manual
clock, a simulator roundtrip, the lock across processes, the node-hid adapter against a stand-in module, the CLI and
the OS adapter stub.

`npm run test:chompi-bridge:native:built` must run under native Windows Node 24 after a build; it fails on other
platforms. It enumerates HID devices read-only, checks that the matcher rejects the stock CHOMPI ID, checks that
the named-pipe lock refuses a second holder and is released on exit and on kill, and reruns the portable suites
except the codec fixtures (whose workspace symlink Windows does not follow on a `\\wsl.localhost` checkout). It
opens no device. Linux CI does not qualify Windows HID or named pipes.

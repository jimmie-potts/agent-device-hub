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
- **Exact device.** The bridge opens only a HID interface with VID `0x1209`, PID `0x000C`, product
  `Agent Controller`, usage page `0xFF00` and usage `0x01`, and, when given `--serial`, that serial. Two matching
  controllers without a serial are refused. The stock CHOMPI presents MIDI under `0483:5740` and never matches;
  the bridge never opens MIDI or mass storage. hidapi opens Windows HID devices with shared access, so the lock,
  not the open, keeps the bridge the only writer.

## Connection behavior

- After opening, the bridge stays silent for 2.5 s. A device that was already running sent its `hello` at
  enumeration, before this handle existed. The silence outlasts the firmware's 2 s host timeout, so the next host
  heartbeat counts as a host arriving and the firmware sends `hello` again (see [Open protocol points](#open-protocol-points)).
  If no `hello` comes within 3 s more, the bridge closes the handle and enumerates again.
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
- LED frames go out as the protocol's two parts. The first frame of a connection waits for the device heartbeat, so
  its frame number follows the device's last applied frame. A frame the device has not reported as applied is resent
  every second. Frames are at most one per 40 ms; a newer frame replaces a waiting one. The last frame is sent again
  after a reconnect.
- Malformed or incompatible reports are counted by reason in `status().counters` and otherwise ignored.

## Interface for #742 (version 1)

```ts
import { createChompiBridge, createNodeHidTransport, acquireInstanceLock } from '@jimmie-potts/chompi-bridge';

const lock = await acquireInstanceLock();          // before any device open
const bridge = createChompiBridge({ transport: createNodeHidTransport(), profileVersion: 1 });
bridge.start();
for await (const event of bridge.events()) {
  // event.type: 'connected' | 'input' | 'stale' | 'recovered' | 'disconnected'
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
- `stale` and `recovered`: `{ epoch }`.
- `disconnected`: `{ epoch, reason }`, with reason `device-closed`, `transport-error`, `heartbeat-timeout`,
  `epoch-change` or `stopped`.
- Every event has `at`, the clock time in milliseconds.

Each subscription is a bounded queue (256 events by default, `events({ limit })`). A subscriber that falls behind is
closed with `closedReason: 'overflow'` and its queue is discarded, so it never sees a press without its release;
treat that end like a disconnect. `BRIDGE_INTERFACE_VERSION` increments on any breaking change to these types.

For development without hardware, `ChompiSimulator` plays the device side of protocol v1 behind the same
`Transport` interface: `plug`, `unplug`, `press`, `release`, `click`, `turn`, `pauseHeartbeats`, `sendRaw`, plus the
applied `leds`, `brightnessPercent` and `display` (`host` or `disconnected`). `ManualClock` runs the bridge and
simulator in virtual time. `FakeTransport` is the lower-level test double.

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

## Open protocol points

- Protocol v1 says the firmware sends `hello` at boot and at USB enumeration. A bridge that starts or restarts while
  the device stays enumerated would never see it. The bridge assumes the firmware also sends `hello` when host
  heartbeats resume after its 2 s host timeout, as the simulator does. The firmware and protocol README need to
  state this before #743.
- The firmware should discard its input queue when the host times out, so a bridge restart inside the timeout does
  not receive presses from the gap. The bridge's quiet period already forces that timeout.

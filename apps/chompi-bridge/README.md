# CHOMPI bridge

Status: source only. The transport core is from [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741);
task routing (Hub feed, slots, lights, focus, Wispr and Send) is from [#742](https://github.com/jimmie-potts/agent-device-hub/issues/742).
Nothing installs or starts it. Installation, live client focus, dictation placement and optical results belong to
[#743](https://github.com/jimmie-potts/agent-device-hub/issues/743).

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

The OS adapter (`OsAdapter`, interface version 1, `src/os-adapter.ts`) is the seam between the portable routing core
and the desktop. Every observation is `known` or `unknown`, and titles are compared inside the adapter, so no title or
conversation text crosses it. `createOsAdapter()` returns the Windows adapter (`src/windows/`) on Windows and an
unsupported adapter elsewhere, whose observations are all `unknown`, so every focus fails closed and nothing is typed.

The Windows adapter uses [koffi](https://koffi.dev/) FFI for `SendInput`, `GetForegroundWindow`, package identity and
`ShellExecute`, and a long-lived PowerShell UI Automation helper (`src/windows/uia-helper.ps1`, started with
`-EncodedCommand`) for the composer and Codex selected-row checks. It reads Codex archive filenames and Claude Desktop
session records by name and key only. Its observations follow the clients' current UI, recorded in
[UIA-NOTES.md](src/windows/UIA-NOTES.md):

- `composerFocused` is known `false` when the client is not the foreground app.
- `codexSelectedTitle` is `unknown` (`codex-not-foreground`) when Codex is not the foreground app.
- `approvalVisible` is always `unknown`: no approval-card selector is qualified yet. Under the router's rule an unknown
  approval refuses Send, so **Send stays blocked until #743 qualifies an approval selector**. Focus and Record work.

The built code reads the helper script from `src/windows/` (`dist/windows` resolves `../../src/windows/`), so an
installation (#743) must ship `src/windows/uia-helper.ps1` beside `dist/`.

## Task routing

`src/routing/` turns controller events and the Hub's session feed into slot lights, exact-task focus, Wispr dictation
and Send. The design, acceptance examples and owner decisions are in the
[OpenSpec change](../../openspec/changes/gh-742-chompi-task-routing/design.md) and the
[qualification report](../../docs/chompi-controller-qualification.md#routing-design).

### Run

```sh
node apps/chompi-bridge/bin/chompi-bridge.mjs run --profile <file> --hub http://127.0.0.1:<port> \
  --token-file <private token file> --state <private directory> [--serial <hex>]
```

The bridge takes the single-instance lock, loads and validates the profile, opens the slot file and loads the
Windows adapter. Any failure exits 1 before the controller opens: `chompi-bridge-profile-invalid`,
`chompi-bridge-hub-invalid`, `chompi-bridge-state-invalid` or `chompi-bridge-os-adapter-unavailable`. It then connects
the controller, the feed and the router. It prints JSON lines with slot numbers and reason codes only: link events,
`feed`, `slot-assigned`, `overflow`, `focused`, `focus-failed`, `sent`, `send-refused`, `send-uncertain`,
`invalidated`, `profile-rejected` and similar. It never prints titles, text or the token. Starting it against the real
controller and desktop is #743 work and needs the owner's device authorization.

### Profile

`profiles/default.json` is the shipped profile (`schemaVersion: 1`, at most 64 KiB):

| Field | Default |
| --- | --- |
| `controls.slots` | Keys 1-15; slot *n* is the *n*th entry |
| `controls.record` | 26, the CHOMPI key, held for dictation |
| `controls.send` | `[33]`, the big-wheel click; add 27 to let Play send too |
| `controls.back` | 28, Loop: alone it clears the target; with a held Claude slot key it is the release gesture |
| `controls.scroll` | 45, the big-wheel turn: scrolls the client conversation |
| `scroll` | `notchesPerStep` 1 (1-10 wheel notches per detent) and `invert` `false` (clockwise scrolls down) |
| `shortcuts` | Codex composer `LeftAlt`+`L`, Send `Enter`, Wispr dictation `LeftControl`+`LeftWindows` |
| `colors`, `brightnessPercent` | RGB per state and the host brightness percent (firmware caps still apply) |
| `timing` | Verification 3000 ms polled every 100 ms, adapter calls 2000 ms, Send repeat window 1000 ms, release hold 800 ms, attention pulse 1000 ms, error flash 1500 ms, archive check 30 s, profile poll 2 s |
| `qualifiedVersions` | Both required: `codex` `26.930.3930.0` and `claude` `2.19675.0.0`. The UI selectors (and Claude's undocumented link) depend on the version, so an unlisted or unknown version disables that client's routing and leaves the other alone |

Validation rejects unknown fields and bad values with a path, for example
`profile.controls.send[0]: 30 is a small-knob click and can never send`. Key names are exactly the ones the Windows adapter can type
(`KEY_NAMES`: `Enter`, `LeftShift`, `LeftControl`, `LeftAlt`, `LeftWindows`, `A`-`Z`, `0`-`9`); anything else is
rejected, for example `profile.shortcuts.codexComposer[1]: "F13" is not an allowed key name (...)`. Only
`shortcuts.send` may contain `Enter`, and dictation keys must be modifiers. Send can never be a small-knob click (29-32), the volume click (34), a turn, a slot, Record or
Back. The profile has no URIs, paths, commands or package identities, so loading it runs nothing. The bridge polls the
file; a valid change is swapped in whole, clears the target and releases held keys; an invalid or unreadable file is
reported once and the last good profile stays.

### Hub feed

The bridge reads `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and follows `GET /api/monitor/v1/changes` with a
`read`-only bearer token read from a private file (on POSIX it must not be group- or world-accessible). It refetches a
whole snapshot on each notification and replays nothing. It sends no other request, so it cannot ingest, acknowledge
or approve. The origin must be `http://127.0.0.1:<port>`. A snapshot request has 3 s and 2 MiB, a silent stream is
dropped after 5 s, and failures retry every 2 s. The feed is `stale` until it is healthy again, and every assigned key
then shows the stale color. A Hub without snapshot 1.3 is read at 1.2, which has no Claude Desktop IDs, so Claude
routing stays off.

### Slots

Root Codex Desktop threads are keyed by thread ID and root Claude Desktop sessions by `hostSessionId` (the
`local_<id>` that survives `/clear`), each with its Hub host and source. New tasks take the lowest free of slots 1-15
in provider, client, host, source and task ID order; assigned tasks never move. Overflow is reported and nothing is
evicted. A slot is released only when the adapter reports the Codex thread archived or the Claude record archived
(checked every 30 s and at each press), or by the Claude release gesture (hold the slot key 800 ms, then press Loop).
Hub retirement, expiry, idle and a stale feed never release. A released task returns only with newer activity. The
slots live in `<state>/slots.json`, written 0600 through a temporary file and rename; an invalid file stops start-up.

### Lights

| State | Meaning |
| --- | --- |
| `empty` | No task |
| `attention` (pulsing) | The Hub reports attention of any kind |
| `active` | Working |
| `unread` | Idle with a completion notice nobody acknowledged and no `read` evidence; the only completion color |
| `idle` | Idle or interrupted otherwise |
| `unknown` | Unknown activity, uncertain freshness or restart uncertainty |
| `ended` | The Hub no longer lists the session, or it ended; the slot is kept |
| `stale` | The feed is stale or unavailable |
| `error` | A refused action, for 1.5 s |

The verified target shows `selected`, the Record LED shows `record` while dictating and the wheel LEDs show
`sendReady` or `sendBlocked`. The disconnected pattern is the firmware's own.

### Safety rules

- A slot press only focuses. It never acknowledges, approves or dismisses, and it clears any earlier target at once.
- Focus fails closed. Every step must pass, or the key flashes error and no target remains:
  - the slot holds a task whose archive state is known and not archived, and Claude's Desktop version is listed;
  - the fixed link brings the expected package family (`OpenAI.Codex_2p2nqsd0c76g0` or `Claude_pzs8sxrjxfjjc`) to
    the front;
  - the exact task is selected. Codex: the slot's title is on the selected row and on no other row. Claude: only the
    target's `lastFocusedAt` moved past the press;
  - the composer has focus.

  Observations are polled; the link and keystrokes are never repeated.
- Record holds the dictation chord only after a re-check of the target and releases it with Record. Release never
  sends.
- Send re-checks the target, needs a current feed, no Hub approval for the task and an adapter answer of no visible
  approval card (today always `unknown`, so Send is refused until #743 qualifies the check), then types one Enter. A repeat within 1 s, a Send during dictation or an uncertain keystroke never
  types a second Enter, and an uncertain one clears the target.
- A big-wheel turn scrolls the target's client, or without a target the foreground Codex or Claude window, through the
  adapter's `scrollClient` mouse-wheel primitive, which acts only while that client is in front with the pointer inside
  it. Scroll never types, selects a task or changes the target, never runs while Record is held, and is not retried
  when the adapter answers `false` or unknown. Other encoder turns are inert.
- A controller `stale`, `session-restart` or `disconnected`, Back, a profile swap, an overflowed subscription and
  shutdown release every held key and clear the target. A fresh slot press is needed afterwards.

## Commands

Run from the repository root after `npm run build`:

```sh
node apps/chompi-bridge/bin/chompi-bridge.mjs probe              # read-only enumeration
node apps/chompi-bridge/bin/chompi-bridge.mjs monitor --simulate # scripted simulator session, JSON lines
node apps/chompi-bridge/bin/chompi-bridge.mjs run [--simulate] [--test-pattern] [--serial <hex>]
node apps/chompi-bridge/bin/chompi-bridge.mjs run --profile <file> --hub <origin> --token-file <path> --state <dir> [--serial <hex>]
```

- `probe` lists matching controllers by VID, PID, product, usage page and usage, and only counts other HID devices.
  It prints no serials or paths and opens nothing.
- `monitor --simulate` runs a fixed press, turn, unplug, replug and stop script in virtual time and exits.
- `run` without a profile takes the lock, connects and prints events as JSON lines until SIGINT or SIGTERM. Only `--test-pattern`
  sends LED frames (a static dim gradient). Without `--simulate` it opens the real controller, which is #743 work
  and needs the owner's device authorization.

Exit codes: 0 success, 1 failure, 2 usage, 3 another instance holds the lock.

## Dependencies

node-hid 3.4.0 is an optional dependency of this package only (license MIT or X11; it bundles hidapi under its
BSD, GPLv3 or original license choice; node-addon-api and pkg-prebuilds are MIT). Its N-API v4 prebuilt binaries
include `win32-x64`, so Node 24 needs no native build. The transport loads it lazily, so Linux builds and tests
never load the native module. koffi 3.3.2 (MIT) is an optional dependency for the Windows adapter's FFI; its
platform prebuilds (`@koromix/koffi-<platform>-<arch>`) are pinned in the lockfile and the adapter loads it lazily, only
on Windows. `@jimmie-potts/chompi-protocol` supplies the fixture vectors the tests run.

## Checks

From the repository root with Node 24:

```sh
npm ci
npm run build
npm run typecheck
npm run test:chompi-bridge
```

The suite runs every protocol fixture vector, the connection rules above against a fake transport and a manual
clock, a simulator roundtrip, the lock across processes, the node-hid adapter against a stand-in module, the CLI,
and the routing core: profile validation and reload, the feed client against a fake Hub, slots, lights, every row of
the no-misrouting matrix against a scripted fake adapter, and an end-to-end routing run through the simulator.

`npm run test:chompi-bridge:native:built` must run under native Windows Node 24 after a build; it fails on other
platforms. It enumerates HID devices read-only, checks that the matcher rejects the stock CHOMPI ID, checks that
the named-pipe lock refuses a second holder and is released on exit and on kill, runs the Windows adapter's read-only
observations (koffi load, foreground identity, a UI Automation helper ping, composer and Codex selected-title
observations and client versions, with `SendInput` and `ShellExecute` replaced by throwing guards), and reruns the
portable suites except the codec fixtures (whose workspace symlink Windows does not follow on a `\\wsl.localhost`
checkout). It opens no device, link or keystroke. On a `\\wsl.localhost` checkout installed from Linux, run `npm ci`
on Windows first so the `@koromix/koffi-win32-x64` prebuild sits beside koffi. Linux CI does not qualify Windows HID,
named pipes, FFI or UI Automation.

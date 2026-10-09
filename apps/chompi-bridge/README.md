# CHOMPI bridge

Source, installed-client and physical evidence have separate owners. The
[#743 trial](https://github.com/jimmie-potts/agent-device-hub/issues/743#issuecomment-5998042747)
records accepted Windows/client and device checks for its exact versions; it does
not qualify other hosts or every later feature. New runtime integration remains
separately scoped under [#837](https://github.com/jimmie-potts/agent-device-hub/issues/837).

The transport core is from [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741);
task routing (Hub feed, slots, lights, focus, Wispr and Send) is from [#742](https://github.com/jimmie-potts/agent-device-hub/issues/742),
and press-time Send with big-wheel card answers is from [#821](https://github.com/jimmie-potts/agent-device-hub/issues/821).
The source commands do not install or start a persistent service. Installation,
live client focus, dictation placement and optical evidence belong to
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
bridge.setProfileVersion(2); // u32 sent from the next host heartbeat, after a profile reload
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
  event is fresh, so a consumer should drop anything pending, such as a held chord. It comes once per restart:
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

The OS adapter (`OsAdapter`, interface version 6, `src/os-adapter.ts`) is the seam between the portable routing core
and the desktop. Every observation is `known` or `unknown`, and titles are compared inside the adapter, so no title or
conversation text crosses it; since version 5 the clients' own model and effort labels do. Version 3 (#821) adds the card operations. Version 4 (#865) adds `sendVolumeKey`, which
taps the Windows volume keys (`VK_VOLUME_UP` 0xAF, `VK_VOLUME_DOWN` 0xAE, `VK_VOLUME_MUTE` 0xAD) 1-10 times. They act
on the system volume: the adapter targets and checks no window, though Windows delivers them through the foreground
thread's input stream and handles them as a system app command. Like any tap, they are refused while the adapter holds a key or the user holds
a modifier, so a volume key never joins the dictation chord. They are not shortcut keys, so no profile can name them.
Version 5 (#906) adds the model and effort operations, keystroke-free wherever the clients allow it:

- `pickerState(client)` reads, without changing anything, only the qualified model and effort controls: the open
  qualified menu (Claude's `Model: <name>` menu, Codex's `Select effort` picker or its model list) with its entries'
  kinds, labels and selection, the focused entry and whether focus is in it; Claude's open `Effort` slider range;
  Claude's `Model:` and `Effort:` buttons (text after the prefix and expanded state) or Codex's picker button (its
  `<model> <effort>` name and state); and Codex's picker announcement (`<model> <level>, <n> of <count>.`, parsed).
  Any other menu is never read.
- Eight UI Automation actions on those controls only: `expandSetting` and `collapseSetting` (Claude; Codex's picker
  does not close on `Collapse`), `invokeSelectModel` (Codex's "Select model"), `focusMenuEntry` (`SetFocus`, read back),
  `selectMenuOption` (`SelectionItem.Select`, only on the option holding focus), `invokeCurrentOption` (Codex: `Invoke`
  on the model list's current option, which returns to the picker unchanged), `setSliderValue` (`RangeValue.SetValue`,
  one step from the value read, within its range) and `focusComposer`. Each re-reads its target just before acting and
  refuses on any difference: a missing or duplicated control, a changed entry count, another state.
- `tapInClient(client, keys, presses)` taps one chord 1-10 times only while that client's window is in front, read
  again right before `SendInput`; otherwise it answers known `false` and types nothing. It is the only way to type
  `Left`, `Right` (extended keys) and `Escape`, which no profile can name. Like any tap it is refused while the adapter
  holds a key or the user holds a modifier. The knobs use it only for Codex's one closing Escape, the owner's effort
  chords and, without chords, Right and Left on a focused Power entry.
- `claudeSettings(localId)` reads one Claude Desktop session record's `model` and `effort` keys.

Version 6 (#907) adds Claude's next-step suggestions, as counts and booleans only: the suggestions are model output, so
no suggestion text crosses the adapter.

- `suggestionState('claude')` reads, without changing anything, the qualified band above Claude's composer (how many
  suggestions, which one holds keyboard focus) and the composer itself (focused, empty). Empty means the composer's
  value is empty or only one trailing line break: Claude's empty composer reads as one `\n` (2026-10-06), and its ghost
  text never shows in the value.
- `focusSuggestion('claude', index, count)` moves keyboard focus to one suggestion (`SetFocus`, read back), and
  `invokeSuggestion('claude', index, count)` invokes it only while it holds focus and the composer is empty. Each
  re-reads the band just before acting and refuses when it is gone, out of shape or no longer has `count` suggestions.
- Codex answers `invalid-client`: Codex next steps are #908's.

The shortcut key names gain `Equal` (`VK_OEM_PLUS`, 0xBB) and `Minus` (`VK_OEM_MINUS`, 0xBD) for the owner's Codex
effort chords.
`createOsAdapter()` returns the Windows adapter (`src/windows/`) on Windows and an
unsupported adapter elsewhere, whose observations are all `unknown`, so every focus fails closed and nothing is typed.

The Windows adapter uses [koffi](https://koffi.dev/) FFI for `SendInput`, `GetForegroundWindow`, package identity and
`ShellExecute`. A window process without package identity, such as Codex Desktop's `ChatGPT.exe`, is identified by the
installed package folder its image runs from directly under the 64-bit Program Files' `WindowsApps` (`ProgramW6432`,
else `ProgramFiles`, on a drive letter), which only the installer can
write; a real package identity always wins. A long-lived PowerShell UI Automation helper (`src/windows/uia-helper.ps1`,
started by a short `-EncodedCommand` loader that reads the file named in its `CHOMPI_UIA_HELPER_SCRIPT` environment
variable, so the path never sits inside a PowerShell string) handles the composer, Codex selected-row and
approval-card checks, the card answers and the read-only picker read. It reads Codex archive filenames and Claude Desktop
session records by name and key only, and Codex's own thread names from `session_index.jsonl` in the Codex home (only
`id`, `thread_name` and `updated_at`; a thread's last line is its current name). Its observations follow the clients' current UI, recorded in
[UIA-NOTES.md](src/windows/UIA-NOTES.md):

- `composerFocused` is known `false` when the client is not the foreground app.
- `codexSelectedThread` compares the selected row with the name Codex keeps for the thread, or with the Hub's title
  when Codex has never named it (the Hub carries a Codex title only when the owner set one). It is `unknown`, so the
  press fails closed, when:
  - neither name exists (`codex-title-missing`, logged as `title-missing`);
  - another thread currently has the same name, even one whose row is collapsed, archived or deleted
    (`codex-name-not-unique`, logged as `title-not-unique`);
  - the index cannot be read, or the thread's newest entry is unusable or older than an earlier one (logged as
    `selection-unknown`);
  - a name exists but Codex is not the foreground app (`codex-not-foreground`).

  Names stay inside the adapter and are never logged or stored.
- `approvalVisible` counts elements in the client's foreground window by class token, never by text. Claude is
  `true` while any element carries `epitaxy-approval-card` (its question and permission cards, offscreen ones
  included) and `false` otherwise. Codex's approval card replaces its composer, so Codex is `false` only while
  exactly one `ProseMirror` composer exists; no composer (`codex-composer-absent`) or several
  (`codex-composer-count`) is `unknown`. A client not in front (`codex-not-foreground`, `claude-not-foreground`)
  or any helper failure is `unknown` too. The router refuses Send unless the answer is `false`.
- `cardButtons`, `focusCardButton` and `invokeCardButton` answer a card with the big wheel. They count the open
  card's actionable buttons (enabled `Button` elements with Invoke and without ExpandCollapse, in tree order; more
  than 64 `Button` elements in scope, before that filter, is `unknown`) and report the focused one's index and the
  card's identity (its container's UI Automation runtime ID, not text; that a new card never shares it is assumed). They move keyboard focus to one of them, or
  press the focused one. They return counts, indexes, booleans and that ID only, and never read a Name or Value.
  - The wheel's stops are the actionable buttons, except that a Claude question card stops only on its answer rows
    and its "Other" row (the buttons carrying the class token `text-left`). A Claude permission card and Codex cards
    stop on every actionable button.
  - After a focus request the helper reads focus back every 25 ms for at most 400 ms, because Claude applies focus
    asynchronously, and answers the index it observed.
  - Claude's card is the one element carrying `epitaxy-approval-card`.
  - Codex's card is found by structure, because Codex does not reliably give it focus: while no composer exists and
    exactly one sidebar row is selected (the thread view), it is the one on-screen `Group` that directly holds a
    `Text` element and at least two actionable buttons, whose actionable buttons (Deny, then approve) are its stops.
    Keyboard focus does not decide it: with focus on the sidebar row or any other button outside the stops, the card
    stays established with no stop focused. Otherwise it is `unknown`: `codex-selected-row-count`,
    `codex-card-unestablished` (no such group), `codex-card-ambiguous` (several) or `card-too-many-groups` (more than
    512 groups, as a very long thread can have).
  - A focus or press names the card by its identity and is `unknown` (`card-changed`) when that card is gone or
    replaced or its button count changed. A press answers `false` when the button no longer has keyboard focus.
  - These two are the only helper operations that change UI state; see [UIA-NOTES.md](src/windows/UIA-NOTES.md#card-answers).
- `pickerState` returns only the qualified model and effort controls of the client's foreground window (#906), so
  the helper returns only model and effort labels. Claude's menu is the one `Menu` named `Model: ...`; Codex's are the
  `Select effort` picker and, while the picker button is expanded, the one other `Menu` whose own entries are all
  model `RadioButton`s. Entries are `RadioButton` (option), `MenuItem` (action) and `CheckBox` (toggle), at most 64.
  Claude's buttons are found by their `Model: ` and `Effort: ` prefixes (two with one prefix is `unknown`); Codex's
  picker button is the one `ExpandCollapse` button near its composer named `Select effort` or `<model> <effort>` with
  a known effort label at the end, so its attachments and permissions buttons are never taken for it. Every label is trimmed to at most 128 characters
  and may not hold control characters. The eight setting actions are the only other helper operations, besides the
  two card operations, that change UI state; see [UIA-NOTES.md](src/windows/UIA-NOTES.md#model-and-effort-controls).

The built code reads the helper script from `src/windows/` (`dist/windows` resolves `../../src/windows/`), so an
installation (#743) must ship `src/windows/uia-helper.ps1` beside `dist/`.

## Task routing

`src/routing/` turns controller events and the Hub's session feed into slot lights, exact-task focus, Wispr dictation
and Send. The design, acceptance examples and owner decisions are in the
[OpenSpec design](../../openspec/changes/archive/2026-10-03-gh-742-chompi-task-routing/design.md) and the
[qualification report](../../docs/chompi-controller-qualification.md#routing-design).

### Run

```sh
node apps/chompi-bridge/bin/chompi-bridge.mjs run --profile <file> --hub http://127.0.0.1:<port> \
  --token-file <private token file> --state <private directory> [--serial <hex>]
```

The bridge takes the single-instance lock, loads and validates the profile, opens the slot file and loads the
Windows adapter. Any failure exits 1 before the controller opens: `chompi-bridge-profile-invalid`,
`chompi-bridge-hub-invalid`, `chompi-bridge-state-invalid` or `chompi-bridge-os-adapter-unavailable`. It then warms
the adapter when it offers `warmUp()` (the UI Automation helper and cached client versions) and logs `adapter-ready` or
`adapter-warm-up-failed`, all before the controller connects, and only then connects the controller, the feed and the
router. It prints JSON lines with slot numbers and reason codes only: link events,
`feed`, `slot-assigned`, `overflow`, `page`, `slots-beyond-pages`, `focused`, `focus-failed`, `sent`, `send-refused`, `send-uncertain`,
`attention-open` (slot and waiting count), `attention-refused` (`none-waiting`, `feed-stale` or `feed-unavailable`),
`volume` (key and presses), `volume-ignored` (`dictating`), `volume-failed`,
the model and effort knob events `knob-menu` (`opened`, or `closed` with a reason, the `method` used, `collapse`,
`escape` or `none`, and whether the close was `verified`), `knob-refused`, `knob-composer-unfocused`, `model-step`
(index and count), `model` and `effort` (an `outcome` of `applied`, `mismatch`, `unverified`, `unsupported` or
`at-limit`, with indexes, positions and counts but no labels), `input-dropped`,
`invalidated`, `profile-rejected`, `dictation-started`, `record-refused`, the card events `card-step`,
`card-pressed`, `card-refused` (reasons `card-wheel-moving`, `card-busy`, `card-nothing-focused`, `card-nothing-chosen`,
`card-focus-moved`), `card-press-uncertain`, `card-step-failed` and `card-unknown`, and similar. `sent`,
`send-refused` and the card events name the `client`. Card events carry button indexes and counts, never option text. A Claude `focused` line carries `evidence`: `advanced` when the target's
`lastFocusedAt` moved past the press, or `already-newest` when it was already strictly the newest (see the safety
rules); a Codex `focused` line has no `evidence` field. It never prints titles, text or the token. Starting it against the real
controller and desktop is #743 work and needs the owner's device authorization.

### Profile

`profiles/default.json` is the shipped profile (`schemaVersion: 1`, at most 64 KiB):

| Field | Default |
| --- | --- |
| `controls.slots` | Keys 1-15; key *n* shows slot (visible page - 1) x 15 + *n* |
| `controls.record` | 26, the CHOMPI key, held for dictation |
| `controls.send` | `[33, 27]`, the big-wheel click and Play; each runs the same guarded Send at the press. On an open card the big-wheel click presses the focused card button instead; Play never does |
| `controls.back` | 28, Loop: alone it releases held keys and cancels a focus in progress; with a held Claude slot key it is the release gesture |
| `controls.scroll` | 45, the big-wheel turn: scrolls the conversation, or steps through an open card's buttons. Its click is the turn ID minus 12 (33) |
| `scroll` | `notchesPerStep` 1 (1-10 wheel notches per encoder count) and `invert` `false` (clockwise scrolls down) |
| `pages` (optional, not in the shipped profile) | `count` 4 (1-8 task pages of 15 slots, so 60 tasks) and `stepCounts` (1-96 knob 4 counts per page, defaulting to the card step constant). Small knob 4's turn (control 43) pages; it is reserved, so `controls.scroll` can never be 43. `attentionClick` `true` makes knob 4's click (control 31) the Attention click (#865); `false` leaves the click inert. Control 31 carries nothing else: no control may map it |
| `keys` (optional, not in the shipped profile) | None: no black key does anything. Maps black-key controls 16-25 to `attention` (the same action as the Attention click) or `back` (what Loop does), for later #744 presets; a key without an entry does nothing. A control already mapped elsewhere (slots, Record, Send, Back) is rejected |
| `volume` (optional, not in the shipped profile) | `stepCounts` 1 (1-96 volume knob counts per volume key; Windows moves 2 points per key) and `invert` `false` (clockwise raises the volume). The volume knob's turn (46) and click (34) are reserved: with a `volume` section, `controls.scroll` 46 or `controls.record` or `controls.back` 34 is rejected; an earlier profile without one that maps them keeps its mapping, and the knob sends no volume key |
| `model` (optional, not in the shipped profile) | Knob 1 (#906): `stepCounts` 6 (1-96 knob 1 counts per menu step), `invert` `false` (clockwise moves down the menu) and `clickStillMs` 250 (0-2000 ms of stillness before knob 1's click picks the focused model). Knob 1's turn (44) and click (32) are reserved like the volume knob's: with a `model` section, `controls.scroll` 44 or `controls.record` or `controls.back` 32 is rejected; an earlier profile without one that maps them keeps its mapping, and knob 1 sets no model |
| `effort` (optional, not in the shipped profile) | Knob 2 (#906): `stepCounts` 6 (1-96 knob 2 counts per effort level) and `invert` `false` (clockwise raises the effort). Knob 2's turn (41) and click (29) are reserved the same way. Knobs 1-3 have not been measured on the device, so their defaults use the conservative card step constant, which knob 4 also pages with: a light touch never changes a setting. #745 measures them |
| `nextSteps` (optional, not in the shipped profile) | Knob 3 (#907): `stepCounts` 6 (1-96 knob 3 counts per suggestion step), `invert` `false` (clockwise moves to the next suggestion) and `clickStillMs` 250 (0-2000 ms of stillness before knob 3's click fills a draft). Knob 3's turn (42) and click (30) are reserved the same way; an earlier profile that maps them keeps its mapping, and knob 3 picks nothing |
| `cards` (optional, not in the shipped profile) | `stepCounts` 6 (1-96 encoder counts per card step) and `clickStillMs` 250 (0-2000 ms of stillness before a click presses a card button). The wheel turns smoothly; one slow full turn each way measured about 25 counts per revolution on the trial device (2026-10-05), so 6 is about a quarter turn. The step default lives in one constant, `DEFAULT_CARD_STEP_COUNTS` in `src/routing/profile.ts`; a profile value overrides it |
| `shortcuts` | Codex composer `LeftAlt`+`L`, Send `Enter`, Wispr dictation `LeftControl`+`LeftWindows`. `codexEffortIncrease` and `codexEffortDecrease` (optional, both or neither, not in the shipped profile) name the owner's own Codex "Increase reasoning effort" and "Decrease reasoning effort" chords, such as `["LeftControl", "LeftAlt", "Equal"]` and `["LeftControl", "LeftAlt", "Minus"]`: `LeftControl`, `LeftAlt` or `LeftWindows` with exactly one other key, never `Enter`. Knob 2 sends them first, with Codex in front (owner decision on #906); absent, Codex effort uses its picker's Power entry |
| `colors`, `brightnessPercent` | RGB per state and the host brightness percent (firmware caps still apply). `colors.pages` (optional) lists knob 4's LED color per page, page 1 first, at least one per page; the defaults are cyan, magenta, green, grey-white, blue, pink, lime and teal, none of them the attention orange. `colors.applied` (optional, default `[0, 255, 120]`) is the knob 1 and knob 2 flash for a change the client confirmed (#906). `selected`, `sendReady` and `sendBlocked` from earlier profiles are accepted and ignored |
| `timing` | Verification 3000 ms polled every 100 ms, adapter calls 2000 ms, Send repeat window 1000 ms, release hold 800 ms, attention pulse 1000 ms, error flash 1500 ms, archive check 30 s, profile poll 2 s. `attentionRepeatMs` (optional, 500-30000, default 4000) is the Attention click's repeat window. `menuTimeoutMs` (optional, 1000-30000, default 5000) is how long a knob's model menu, effort slider or picker stays open, or knob 3's highlight stays, after its last turn (#906, #907). The knobs read back within `verifyTimeoutMs`, polled every `verifyPollMs` |
| `qualifiedVersions` | Both required: `codex` `26.930.3930.0` and `claude` `2.19675.0.0`. The UI selectors (and Claude's undocumented link) depend on the version, so an unlisted or unknown version disables that client's routing and leaves the other alone; see [Qualify a client update](#qualify-a-client-update) |

Validation rejects unknown fields and bad values with a path, for example
`profile.controls.send[0]: 30 is a small-knob click and can never send`. Key names are exactly the ones the Windows adapter can type
(`KEY_NAMES`: `Enter`, `LeftShift`, `LeftControl`, `LeftAlt`, `LeftWindows`, `A`-`Z`, `0`-`9`, `Equal`, `Minus`); anything else is
rejected, for example `profile.shortcuts.codexComposer[1]: "F13" is not an allowed key name (...)`. Only
`shortcuts.send` may contain `Enter`, and dictation keys must be modifiers. Send can never be a small-knob click (29-32), the volume click (34), a turn, a slot, Record or
Back. The profile has no URIs, paths, commands or package identities, so loading it runs nothing. Fields added after
the first release (`cards`, `pages`, `colors.pages`, `keys`, `volume`, `timing.attentionRepeatMs`, for #906
`model`, `effort`, `shortcuts.codexEffortIncrease` and `shortcuts.codexEffortDecrease`, `timing.menuTimeoutMs` and
`colors.applied`, and for #907 `nextSteps`) are optional, so an earlier profile still loads, and the installed owner
profile gets knobs 1-3 without edits. An earlier bridge rejects them as unknown fields, so remove them before rolling back. The bridge polls the file; a valid change
is swapped in whole, cancels pending actions and releases held keys; an invalid or unreadable file is reported once and
the last good profile stays.

### Qualify a client update

Codex Desktop updates itself often, and each update disables Codex routing until its version is listed. A slot press
then logs `focus-failed` with `reason: "client-unqualified"`, the `client` and the `observedVersion`. The gate also runs
again after verification and before the composer shortcut, and Send checks the version of the client in front at
every press, so a client that updated while the bridge ran is caught before any Enter; Send logs `send-refused` with
the same reason and version. An unqualified client's wheel scrolls but never answers cards. To qualify it:

1. Check the selectors against [UIA-NOTES.md](src/windows/UIA-NOTES.md) for that version (the selected-row and
   composer structure), for example with the native check's read-only observations. Re-check the
   [approval-card selectors](src/windows/UIA-NOTES.md#approval-cards) too, as in the #743 trial: open a harmless
   approval or permission card in a throwaway task in that client, and confirm that a Claude card still carries
   `epitaxy-approval-card`, or that a Codex card still replaces the composer, and that the client reads as having
   no card again once it closes. With the card open, check the [card answers](src/windows/UIA-NOTES.md#card-answers):
   the wheel steps through the card's buttons in the client's order, skips text fields and disabled buttons, and a
   still click presses the focused one (deny or a harmless option, in a throwaway task). Re-check the
   [model and effort controls](src/windows/UIA-NOTES.md#model-and-effort-controls) as well, in a throwaway task:
   Claude's `Model:` and `Effort:` buttons (ExpandCollapse), the model options (SelectionItem) and the Effort slider
   (RangeValue), and Codex's picker button and its `<model> <effort>` name, the `Select effort` picker, its "Select
   model" (Invoke) and "Power" entries, the model options and its announcement.
2. Add the logged `observedVersion` to `qualifiedVersions.codex` (or `.claude`) in the profile. Keep earlier versions
   only while they can still be installed.
3. Save the file. The bridge reloads it within `timing.profilePollMs` and logs `profile-applied`; no restart is needed.

A Claude Desktop update needs the same check plus the undocumented `claude://code/continue` link and session store,
because the report qualified those per version.

### Hub feed

The bridge reads `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and follows `GET /api/monitor/v1/changes` with a
`read`-only bearer token read from a private file (on POSIX it must not be group- or world-accessible). It refetches a
whole snapshot on each notification and replays nothing. It sends no other request, so it cannot ingest, acknowledge
or approve. The origin must be `http://127.0.0.1:<port>`. A snapshot request has 3 s and 2 MiB, a silent stream is
dropped after 5 s, and failures retry every 2 s. The feed is `stale` until it is healthy again, and every assigned key
then shows the stale color. A Hub without snapshot 1.3 is read at 1.2, which has no Claude Desktop IDs, so Claude
routing stays off; the bridge asks for 1.3 again every 5 minutes and on every reconnect.

### Slots

Root Codex Desktop threads are keyed by thread ID and root Claude Desktop sessions by `hostSessionId` (the
`local_<id>` that survives `/clear`), each with its Hub host and source. Slots come in pages of 15 (`pages.count`,
default 4): page *p* holds slots 15(*p*-1)+1 to 15*p*. New tasks take the lowest free slot across all pages in
provider, client, host, source and task ID order; assigned tasks never move to another slot or page. Overflow is
reported only when every page is full, and nothing is evicted. A slot is released only when the adapter reports the Codex thread archived or the Claude record archived
(checked every 30 s and at each press), or by the Claude release gesture (hold the slot key 800 ms, then press Loop).
Hub retirement, expiry, idle and a stale feed never release. A released task returns only with newer activity. The
slots live in `<state>/slots.json`, written 0600 through a temporary file and rename by the bridge alone; an invalid
file stops start-up.

#### Task pages

- Turning small knob 4 (control 43) shows the next or previous page, one page per `pages.stepCounts` counts. A
  reversal restarts the count, so a light touch or a wiggle never pages, and paging stops at the first and last page.
  Paging only changes which slots the keys show: it sends no input, opens or focuses nothing and calls no adapter.
- Slot keys, the release gesture and the key lights act on the visible page. A held key keeps the slot it showed when
  pressed, so paging during the release gesture's hold still releases that slot. The bridge starts on page 1 and does
  not remember the page across restarts; a profile reload keeps the page, clamped to the new count. A `page` line is
  logged on every change.
- If the profile asks for fewer pages than an assigned slot needs, that task is kept (never dropped or moved) without
  a visible key and takes no new task; the bridge logs `slots-beyond-pages` with the count. Archive evidence still
  releases it, and it shows again when the pages return. Its attention still pulses knob 4's LED; to clear that
  pulse, raise `pages.count` so its page has keys again and handle the task there, or release the task (archive it, or
  use the release gesture once its page is visible).

#### Slot file versions and rollback

- The slot file is `schemaVersion: 2` (slots 1-120). A version 1 file from an earlier bridge loads unchanged onto
  page 1; opening alone writes nothing, and the first slot change rewrites it as version 2.
- An earlier bridge (5add03a and before) reads only version 1 and stops at start-up with
  `chompi-bridge-state-invalid: slot state has an unsupported schemaVersion`. To roll back:
  1. Stop the bridge.
  2. Copy `<state>/slots.json` to a backup.
  3. In `slots.json`, remove every entry of `slots` whose `slot` is above 15, and set `schemaVersion` to 1.
  4. If you added `pages` or `colors.pages` to the profile, remove them: an earlier bridge rejects unknown profile
     fields and would keep its last good profile, or refuse to start with this one. The same goes for `keys`,
     `volume`, `timing.attentionRepeatMs` and `pages.attentionClick` (#865), and `model`, `effort`,
     `shortcuts.codexEffortIncrease`, `shortcuts.codexEffortDecrease`, `timing.menuTimeoutMs` and `colors.applied`
     (#906). A bridge from before #865 leaves knob 4's click and the volume knob inert, and one from before #906
     leaves knobs 1 and 2 inert.
  5. Start the earlier bridge. Tasks that lost their slot get one again when a slot frees up, first-free.

#### Attention click and volume knob

- **Attention click on knob 4** (control 31, owner decision on #865, 2026-10-06). A click opens the task that has
  waited longest for the owner, on whatever page it sits, through the same open and verify path as its slot key, and
  shows that page. The profile switch is `pages.attentionClick` rather than a control number, because 31 carries
  only this action and knob 4 already belongs to task pages. A black key mapped to `attention` does the same.
  - "Waited longest" is the order in which the bridge first saw each assigned task's attention (question, input or
    approval) on a current feed. Hub attention carries no time, so the bridge keeps this order in memory only; it
    restarts with the bridge, which orders tasks it sees waiting in one snapshot by slot. Attention that clears and
    comes back goes to the back.
  - A click within `timing.attentionRepeatMs` (4 s) of the last one moves on to the next waiting task, and around to
    the first. A later click opens the earliest waiting task again.
  - With no task waiting, or a feed that is not current, it refuses (`attention-refused`) and knob 4's LED flashes
    the error color, then shows the page again (a mapped black key flashes itself instead). Slots beyond the
    profile's pages have no visible key and are skipped.
  - It is navigation only. Like a slot key it never acknowledges, approves or dismisses anything, and it changes no
    Hub state; the task keeps its attention.
- **Back key.** A black key mapped to `back` does exactly what Loop does: alone it releases held keys and cancels a
  focus in progress, and with a held Claude slot key it is the release gesture.
- **Volume knob** (`ENC_6`). A turn (control 46) sends one volume-up or volume-down key per `volume.stepCounts`
  counts, with the reversal rule of the other knobs; fast turns coalesce into calls of at most 10 presses. A click
  (control 34) toggles mute. The bridge targets no window and checks no foreground, composer or card, so the keys work
  with any app in front and type nothing into a Codex or Claude window. Windows delivers a volume key through the
  foreground thread's input stream and handles it as a system app command; installed check 2 for #865 confirms that
  Codex and Claude do not react to it.
- **Volume during Record.** While Record holds the dictation chord, the volume knob is ignored (`volume-ignored`
  with `dictating`) and its LED flashes the error color. A volume key combined with the held `LeftControl` and
  `LeftWindows` would be a different shortcut, so the router drops it rather than releasing the chord, which would end
  dictation. The adapter refuses it as well. A Record press during a volume keystroke presses the chord right after
  it, as it does after a Send's Enter. A failed volume key is never retried.

#### Model and effort knobs

Small knob 1 (`ENC_4`: turn 44, click 32, LED 26) sets the model and small knob 2 (`ENC_1`: turn 41, click 29, LED 27)
the reasoning effort of the Codex or Claude task in front (owner decision on #744, 2026-10-06; #906). Each acts on the
qualified client in front at the turn, through that client's own controls as the #906 qualification recorded them
(Claude Desktop 2.19675.0.0, Codex Desktop 26.930.3930.0). The work is done with UI Automation actions wherever the
client allows it; model lists and level names come from each client and are never compared across clients.

- **Claude model (knob 1).** The first detent expands the `Model: <name>` button and moves keyboard focus to the
  current model (`SetFocus`, read back; the menu's own initial focus varies). Each further detent moves focus one
  model option, stopping at the first and last; "More models" is never a stop. A click after `model.clickStillMs` of
  stillness calls `Select` on the option holding focus, which applies it and closes the menu. The readback waits for
  the `Model: <name>` button to name the pick and, when the router can tell the session in front from the sessions it
  knows (strictly the newest `lastFocusedAt`), for that session record's `model` to change. Then the composer gets
  focus back, so Play still works.
- **Claude effort (knob 2).** A detent expands the `Effort: <level>` button when the slider is not open and sets the
  slider one `SmallChange` from the value it reads (`RangeValue.SetValue`), which applies at once. The range comes from
  the slider, so at an end nothing is set: one `at-limit` with a red flash, and the detents still waiting are dropped.
  The readback waits for the `Effort:` button to change and, when the session in front is known, its record's
  `effort` too. A model without an Effort button, such as Haiku 4.5, is `unsupported`.
- **Codex model (knob 1).** The first detent expands the picker button (named `<model> <effort>` while collapsed and
  `Select effort` while expanded), invokes the picker's "Select model" entry and focuses the current model in the
  list. Further detents move focus one option. A still click calls `Select` on the option holding focus (`Invoke` when
  it is already the current model, because `Select` on it does nothing); Codex returns
  to its picker, which stays open, and the bridge closes it (below). The pick is `applied` when the closed button's
  name starts with the picked model, `mismatch` when it names another option, and `unverified` when it names none
  (such as after "Default") or the picker did not close.
- **Codex effort (knob 2).** With the owner's chords in the profile (`shortcuts.codexEffortIncrease` and
  `codexEffortDecrease`, owner decision on #906), each detent sends one chord through `tapInClient`, only with Codex
  qualified and in front, no card and the picker closed, and reads the picker button's name: `applied` when it changed,
  else `mismatch` (`unchanged`, usually the end of the range) with the waiting detents dropped. The picker is never
  opened. Without chords, a detent expands the picker, focuses its "Power" entry by UI Automation and sends Right or
  Left only while a fresh read shows the picker holding focus on Power; the level count comes from the announcement
  each time, and at an end nothing is sent (`at-limit`). A picker without Power is `unsupported`.
- **Closing.** An open control closes after `timing.menuTimeoutMs` without a turn, on knob 2's click (for effort), and
  before any other control acts: a slot key, Send, Record, Loop, the big wheel, knob 4, the volume knob, the other
  setting knob, a profile reload or a controller loss. Input that arrives meanwhile waits in order, so two flows never
  act at once.
  - Claude: `Collapse` on the button, only when a read shows it expanded, then the composer gets focus.
  - Codex does not close on `Collapse`. A model list left without a pick first gets `Invoke` on its current model,
    which returns to the picker unchanged (observed 2026-10-07; `Select` on it does nothing); Escape is never sent from
    the list. Then exactly one Escape, only when a
    fresh read shows the `Select effort` picker holding focus, and a bounded wait for the picker button to read
    collapsed. A picker still open after that wait is logged as closed and unverified; it never gets a second Escape.
  - A control the owner already closed gets nothing.
- **Lagging reads.** A read that gates an action (is the menu open, does the option have focus, is the button
  expanded) waits up to 400 ms for its condition, because UI Automation can lag a change. Each action re-checks its
  target in the helper anyway, so a stale read never makes the bridge act twice.
- **Refusals.** A knob refuses, with its LED flashing the error color and nothing done, when another app is in front
  (`not-agent-client`), the foreground is unknown, the client is unqualified (`client-unqualified` with the
  `observedVersion`), a card is open or unknown (`card-open`, `card-unknown`), the controls cannot be read
  (`picker-unknown`), one of them is already open (`menu-open`), its button is missing (`model-control-missing`,
  `picker-button-missing`), Record holds the dictation chord (`dictating`), or a Send or task focus is in progress. A
  knob 1 click refuses while the knob still moves (`knob-moving`), with no menu open (`menu-not-open`), with no option
  confirmed focused (`nothing-chosen`, `focus-moved`), or while a step runs (`knob-busy`).
- **Lights.** While its control is open, the knob's LED shows the `active` color. For the error flash time after a
  change it shows `applied` (`colors.applied`) for `applied`, the `unknown` color for `unverified`, and the error color
  for a refusal, `mismatch`, `unsupported` or `at-limit`.
- **Keys.** The knobs never press Enter, never type into a composer, send a prompt or answer a card. Their only keys
  are Codex's one closing Escape, the owner's chords, and Right and Left on a focused Power entry without chords, all
  through `tapInClient` into Codex. The remaining windows between the confirming read and those keys are in
  [UIA-NOTES.md](src/windows/UIA-NOTES.md#residual-windows). No personal setting or key binding is changed.

#### Next-step knob

Small knob 3 (`ENC_2`: turn 42, click 30, LED 28) picks Claude's suggested next step (owner decision on #744,
2026-10-06; #907). Claude Desktop's `next-steps` mod shows up to three suggested prompts as buttons above the composer
after a turn. The #907 qualification (Claude Desktop 2.19675.0.0) recorded the band as a `Group` holding a `Text` "next:", one
`Button` per suggestion and a `Button` "dismiss", two `Group`s below the branch beside the composer's group (observed
2026-10-07); the buttons take keyboard focus, and Claude draws its own focus ring.

- **Turn.** With Claude qualified and in front, no card and no model or effort control open, a band showing and the
  composer empty, the first detent moves keyboard focus to the first suggestion (`SetFocus`, read back) and knob 3's
  LED shows `active`. Each further detent moves focus one suggestion, stopping at the first and last; "dismiss" is
  never a stop.
- **Click with a suggestion highlighted.** After `nextSteps.clickStillMs` without a turn, a fresh read confirms the
  same band, that suggestion focused and the composer empty; then `invokeSuggestion`, which the helper performs only
  on the focused suggestion into an empty composer. The mod writes the suggestion into the composer as a draft, the
  composer gets focus back and the readback waits for it to hold a draft (`filled`, else `unverified`). Play then
  sends it.
- **Click with nothing highlighted.** Claude's ghost text (its own prompt suggestion, which with the mod is the top
  suggestion) is invisible to UI Automation, and a Right arrow accepts it (owner check on #907). The click sends one
  Right arrow through `tapInClient`, only when a fresh read shows Claude in front with its composer focused and empty
  and no card or menu open. The bridge cannot tell whether ghost text is showing: the readback reports `filled` when
  the composer then holds a draft and `unverified` (`composer-empty`) when it stays empty, as with no ghost text,
  where the arrow does nothing (owner-accepted rule on #907).
- **Refusals.** Knob 3 refuses with its LED flashing the error color and nothing typed: Codex in front
  (`codex-no-next-steps`; Codex next steps are #908's), another app (`not-agent-client`), an unqualified client, a card
  open or unknown, a model or effort control open (`menu-open`), no band on a turn (`no-suggestions`), a draft in the
  composer (`draft-present`), an unfocused composer on a ghost click (`composer-unfocused`), an unreadable band
  (`suggestions-unknown`), Record held (`dictating`), a Send or task focus in progress, a click while the knob moves
  (`knob-moving`) or while a step runs (`knob-busy`). A highlighted suggestion that lost focus, a band that changed or
  went away and a refused invoke (`focus-moved`, `band-changed`, `band-gone`, `suggestion-changed`) end the highlight.
- **Closing.** The highlight drops after `timing.menuTimeoutMs` without a turn and before any other control acts, as
  the knob 1 and 2 flows close (another control, Record, a profile reload or a controller loss); input waits in order,
  so two flows never act at once. Dropping it gives the composer focus (`focusComposer`), so Play sends, even when the
  owner moved focus elsewhere in Claude meanwhile.
- **No digit fallback.** The issue's fallback of typing 1-3 into the empty composer, which the mod documents, is
  dropped: the qualification showed the suggestion buttons take keyboard focus, and the owner-accepted rule is invoke,
  else one Right arrow (S907-1 on #943). The bridge types no digits.
- **Keys and text.** Knob 3 never presses Enter and never sends. Its only key is the one Right arrow into Claude's
  focused, empty composer; the remaining window between the confirming read and that arrow is in
  [UIA-NOTES.md](src/windows/UIA-NOTES.md#residual-windows). Logs carry indexes and counts, never suggestion text.

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
| `error` | A refused slot press on its key, a refused or uncertain Send or card press on both big-wheel LEDs, a refused Attention click on knob 4's LED (or on a black key mapped to `attention`), an ignored or failed volume key on the volume knob's LED, a refused, mismatched, unsupported or at-limit model or effort change on knob 1's or knob 2's LED, or a refused next step on knob 3's LED, for 1.5 s |

Slot keys show the visible page's slots, and keys for its empty slots stay off. Small knob 4's LED shows the visible
page in its `colors.pages` color; while a task on any other page has attention, it alternates between the page color
and the attention color on the attention pulse. Only attention shows there (owner decision on #822, 2026-10-05); other
states, such as an unread completion, show on the keys when their page is visible.

The Attention click has no light of its own: a waiting task on the visible page pulses its key, and one on a hidden
page alternates knob 4's LED as above. A black key mapped to `attention` shows the `attention` color, steady, while
any task on a page waits, and is off otherwise or while the feed is not current. A Back key has no light. The volume
knob's LED lights only for its error flash. Knob 1's and knob 2's LEDs show `active` while their control is open and
then flash the change's outcome (see Model and effort knobs). Knob 3's LED shows `active` while a suggestion is
highlighted, then `applied` for a filled draft, the `unknown` color for an unconfirmed fill and the error color for a
refusal (see Next-step knob).

Slot keys show task state only. Nothing marks a selected task, because Send acts on whatever is in front, so a
focused key with attention keeps pulsing and focusing never looks like acknowledging. The Record LED shows `record`
while dictating. The big-wheel LEDs show nothing about readiness: Send and card navigation are decided at the press,
and nothing polls the window in front to light them. A refused or uncertain Send or card press (Play or the wheel
click) flashes both big-wheel LEDs in the `error` color for `timing.errorFlashMs` (owner decision on #821). A `repeat`
bounce right after a Send and a Send abandoned because Record was pressed (`superseded`) do not flash. The screen
shows what is in front and the card's own focus ring. The disconnected pattern is the firmware's own.

### Safety rules

- A slot press only opens and focuses. It never acknowledges, approves or dismisses, and it arms nothing: Send and
  Record act on whatever is in front when they are pressed.
- Focus fails closed. Every step must pass, or the key flashes error:
  - the slot holds a task whose archive state is known and not archived, and Claude's Desktop version is listed;
  - the fixed link brings the expected package family (`OpenAI.Codex_2p2nqsd0c76g0` or `Claude_pzs8sxrjxfjjc`) to
    the front;
  - the exact task is selected. Codex: the thread's name (Codex's own, else the Hub's title) is on the selected row
    and on no other row. Codex exposes only the sidebar rows on screen, so the sidebar must be expanded with the
    task's row in view; otherwise the press fails with `selection-unknown` or `selection-mismatch`. Claude: only the target's `lastFocusedAt` moved past the press. Claude Desktop stamps it
    only when the selection changes, so a press for the session Claude already shows also verifies when Claude was
    in front before the link and the target was strictly newest among known sessions (slot records and Hub
    `hostSessionId`s, read completely), and after the link it still is and no other session's moved past the press.
    A tie, Claude not in front, an incomplete read or any unknown answer gives no extra evidence; the advance rule
    applies. Residual: the window's view is unobserved, so Code home, the Chat tab or an unknown session in front is
    covered only by the link navigating;
  - the composer has focus.

  Observations are polled; the link and keystrokes are never repeated.
- Send (the big-wheel click or Play) types one Enter only when, at the press:
  - Codex or Claude Desktop is in front at a qualified version;
  - its composer has focus;
  - the adapter sees no card (`approvalVisible` known `false`);
  - the 1 s repeat window has passed;
  - Record is not held.

  Anything else refuses with a reason code, and any other app in front gets nothing (`not-agent-client`). An
  uncertain keystroke is never retried. A refusal or uncertain keystroke flashes the big-wheel LEDs red, except a
  `repeat` bounce right after a Send and a Send abandoned because Record was pressed (`superseded`).
- Cut assurances (owner decision on #821):
  - **No Hub check on Send.** Hub `approval` attention and a stale feed no longer block Send. The bridge's own card
    and composer checks are its only guards.
  - **Codex cards with their own field.** A Codex card with its own focused `ProseMirror` field would count as the
    composer and accept Enter, as a keyboard would. No such card was observed.
  - **Record works anywhere.** Record holds the dictation chord whatever is in front, a card's free-text field
    included, and releases it with Record. Release never sends. A Record press is never refused: it abandons a Send
    still checking the window (`superseded`), even when Record is released again before the check ends, and during a
    Send's Enter keystroke the chord goes down right after it.
- Card answers: while a card is open in a qualified Codex or Claude window in front:
  - A big-wheel turn moves keyboard focus one stop per `cards.stepCounts` encoder counts. The count restarts on a
    reversal, so a small wiggle back never steps back. Steps stop at the first and last stop. A Claude question
    card's stops are its answer rows and its "Other" row; other cards stop on every actionable button.
  - A step counts as chosen only when focus is seen on the requested stop within the helper's 400 ms read-back.
    Focus that Claude applies later is not chosen, and a click then presses nothing. A still click while a step's
    read-back is still running is refused (`card-busy`) and presses nothing; click again once the step is done.
  - A big-wheel click presses the focused button only when the wheel's own step moved focus to it on this card, so at
    least one deliberate step is needed: when a Codex card opens with its approve button focused, a click without a
    turn presses nothing (`card-nothing-chosen`). A step that cannot move focus, because focus is already at the
    first or last stop, chooses nothing and leaves any earlier choice from a real move, so on a card that opens with
    approve focused the owner turns away and back before clicking (owner decision on #821). When nothing has focus, as Codex often
    leaves its card, the first clockwise step focuses Deny (the first stop) and a counter-clockwise step focuses
    approve (the last stop). The click also needs `cards.clickStillMs` without a turn and no step
    in flight. Turning while the click is held moves nothing, and the press clears partial rotation. Wheel actions
    outside a card clear partial rotation, so scroll counts never shorten the first card step.
  - Play is refused (`approval-visible` for a Claude card, `composer-unfocused` for a Codex card). An unknown card state, including a Codex view without a composer whose
    card container cannot be established, makes the wheel do nothing: no scroll, no step, no press, no Enter.
  - This click is the one controller gesture that may approve a permission request (owner decision on #744 and
    #821). It is a client UI action, never a Hub acknowledgement.
  - Residual: Codex cards are identified by structure. A composer-less thread view (one selected sidebar row) whose
    focused button sits in a group with text and two or more actionable buttons is treated as a card; settings and
    dialogs without a selected row are not. A press there still needs a deliberate step and a still click. After a
    press, Claude can leave focus off the composer, and Send then refuses until the composer has focus again.
- Outside a card, a big-wheel turn scrolls the foreground Codex or Claude window through the adapter's `scrollClient`
  mouse-wheel primitive, which acts only while that client is in front with the pointer inside it. The wheel never
  types or selects a task, never runs while Record is held, and is not retried when the adapter answers `false` or
  unknown. Small knob 4's turn pages the slot keys (see Task pages), and the volume knob steps the system volume (see
  Attention click and volume knob), knobs 1 and 2 set the model and effort (see Model and effort knobs), and knob 3
  picks Claude's next step into the composer, never sending (see Next-step knob). Knob 4's click is the Attention click.
- A controller `stale`, `session-restart` or `disconnected`, Back, a profile swap and an overflowed subscription
  release every held key and cancel pending wheel steps, pending volume keys, pending knob steps and a focus in
  progress. A loss also drops input waiting for a knob flow to close, and the flow's open control closes the way its
  knob closes it (knob 3's highlight drops to the composer). Nothing pressed
  before them is replayed: after a reconnect, each control acts on a fresh press, evaluated at that press.
- Stopping: SIGINT, SIGTERM, SIGHUP and, on Windows, SIGBREAK (console close) stop the bridge, which releases every
  held key before closing. On any process exit the adapter's synchronous `releaseAllSync()` runs as well, and an
  uncaught exception or unhandled rejection releases keys, prints `chompi-bridge-fatal` and exits 1. A forced kill
  (`SIGKILL`, End task) runs no code, so a dictation chord held at that moment stays down in Windows until those keys
  are pressed and released; press left Ctrl and left Win once to clear it.

## Commands

Run from the repository root after `npm run build`:

```sh
node apps/chompi-bridge/bin/chompi-bridge.mjs probe              # read-only enumeration
node apps/chompi-bridge/bin/chompi-bridge.mjs monitor --simulate # scripted simulator session, JSON lines
node apps/chompi-bridge/bin/chompi-bridge.mjs run [--simulate] [--test-pattern] [--serial <hex>]
node apps/chompi-bridge/bin/chompi-bridge.mjs run --profile <file> --hub <origin> --token-file <path> --state <dir> [--simulate] [--desktop sim] [--serial <hex>]
```

- `probe` lists matching controllers by VID, PID, product, usage page and usage, and only counts other HID devices.
  It prints no serials or paths and opens nothing.
- `monitor --simulate` runs a fixed press, turn, unplug, replug and stop script in virtual time and exits.
- `run` without a profile takes the lock, connects and prints events as JSON lines until SIGINT or SIGTERM. Only `--test-pattern`
  sends LED frames (a static dim gradient). Without `--simulate` it opens the real controller, which is #743 work
  and needs the owner's device authorization.

- `--desktop sim` (with the routing flags) replaces the Windows OS adapter with the simulated desktop in
  `src/sim/desktop.ts`. It is for verification runs and the scenario catalog; see
  [Verification runs](#verification-runs). Without the flag the bridge never imports `src/sim`.

Exit codes: 0 success, 1 failure, 2 usage, 3 another instance holds the lock.

## Verification runs

[#853](https://github.com/jimmie-potts/agent-device-hub/issues/853) lets a bridge change be tried before it merges,
without the controller, the Windows desktop or the installed Hub:

- `src/sim/desktop.ts` is a simulated desktop behind OS adapter interface version 6. It has Codex, Claude and one
  other app, each with a package family and a qualified version. It models the foreground window, the selected
  task, composers with focus and text, approval and question cards with stops and focus, Claude `lastFocusedAt`,
  Codex thread names, synthetic dictation on the chord's release, a synthetic system volume and mute that the volume
  keys change, each client's model and effort controls (`src/sim/pickers.ts`, #906), Claude's next-step band and
  ghost text (`src/sim/suggestions.ts`, #907, found through the helper's locator rule in `src/sim/band-tree.ts`), and a key and press log. `tests/adapter-contract.test.mjs` holds it and
  the router tests' fake adapter to the same adapter behavior; the fake uses the same picker and suggestion models,
  each with a mode in which reads lag one change behind.
- `src/sim/hub.ts` is a synthetic Hub feed: the sessions snapshot (1.3 and 1.2) and change stream in the Hub's
  released format, with a run-generated bearer token, served in memory or over loopback HTTP.
- `src/sim/scenarios.ts` is the scenario catalog. It is shared by the in-memory runner
  (`npm run -s test:chompi-bridge:scenarios`, Tier 1) and disposable runs
  (`npm run -s verify:chompi -- <operation>`, Tier 2). Both run the real CLI with `--simulate --desktop sim`.

[`verify/README.md`](verify/README.md) covers the run, its control page, the boundary checks and the steps. A run
proves routing behavior only. UI Automation fidelity, real focus timing, Wispr and file hashes stay with
`test:chompi-bridge:native:built` and the owner's installed checks.

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
npm run -s test:chompi-bridge:scenarios
```

The suite runs every protocol fixture vector, the connection rules above against a fake transport and a manual
clock, a simulator roundtrip, the lock across processes, the node-hid adapter against a stand-in module, the CLI,
and the routing core: profile validation and reload, the feed client against a fake Hub, slots, lights, every row of
the no-misrouting matrix against a scripted fake adapter, press-time Send, Record, big-wheel card answers, the model and
effort knobs and the next-step knob (`routing-knobs.test.mjs`: each step, the single confirmed Escape, knob 3's single
Right arrow into an empty composer and the no-Enter assertion, readback outcomes, refusals, lagging reads, fallbacks
and the close before other controls), and an end-to-end routing run through the simulator. It also holds the simulated desktop and the fake adapter to one
adapter contract, reads the synthetic Hub feed with the real feed client, checks that `--desktop sim` is the only
way the CLI loads `src/sim`, and tests the scenario runner. `test:chompi-bridge:scenarios` runs the catalog (Tier 1).
The verification run's own checks are in [`verify/README.md`](verify/README.md#checks).

`npm run test:chompi-bridge:native:built` must run under native Windows Node 24 after a build; it fails on other
platforms. Before running it, have Codex show one ordinary task with the sidebar expanded and the selected row
visible: Codex exposes only on-screen rows, and the selected-thread probe otherwise fails with `selected-row-count`
or `document-count`. It enumerates HID devices read-only, checks that the matcher rejects the stock CHOMPI ID, checks that
the named-pipe lock refuses a second holder and is released on exit and on kill, runs the Windows adapter's read-only
observations (koffi load, foreground identity, a UI Automation helper ping, composer, Codex selected-thread, approval
and card-button observations and client versions, with `SendInput` and `ShellExecute` replaced by throwing guards; it
never focuses or presses a card button; it checks the volume key table and that malformed volume requests are refused
before any attempt, sending no volume key; it records which model and effort controls each running client exposes,
with their UI Automation patterns, through the read-only picker read and calls no setting action; it records the shape
of Claude's next-step band (suggestion count, focus, the level above the composer it was found at) and the composer's
focus and emptiness, read-only and without text, and focuses or invokes no suggestion; checks the
`tapInClient` and chord key tables, and checks that malformed client taps are refused before any attempt, sending no
key), and reruns the
portable suites except the codec fixtures (whose workspace symlink Windows does not follow on a `\\wsl.localhost`
checkout). It opens no device, link or keystroke. On a `\\wsl.localhost` checkout installed from Linux, run `npm ci`
on Windows first so the `@koromix/koffi-win32-x64` prebuild sits beside koffi. Linux CI does not qualify Windows HID,
named pipes, FFI or UI Automation.

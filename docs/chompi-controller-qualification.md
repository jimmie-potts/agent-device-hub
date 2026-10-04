# CHOMPI controller qualification

Work source: [Hub #740](https://github.com/jimmie-potts/agent-device-hub/issues/740),
part of [epic #738](https://github.com/jimmie-potts/agent-device-hub/issues/738).
Evidence collected October 3, 2026 UTC.

**A non-MIDI controller is feasible and both Desktop clients have a usable,
fail-closed routing design. Nothing here has passed on the device or in a live
client yet.** The selected route is a controller firmware in launcher slot 04
that talks vendor-defined HID to one Windows bridge. The bridge reads the Hub's
session feed, keeps task slots, opens tasks by deep link, verifies the result
and sends keystrokes only after verification. Claude routing depends on an
undocumented Claude Desktop link, which the owner accepted with fail-closed
checks. [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743)
owns the device and live-client trial.

This was a read-only investigation. No firmware was flashed, no USB device was
opened, no link was launched, no keystroke was sent and no setting changed.
Bundle inspection read code, key names and schemas, never task content.

## Evidence classes and setup

`D` means official documentation, `S` inspected source, built output,
installed bundle, local configuration or filesystem artifact, `O` owner
decision or report, and `L` an authorized live
observation. This report contains no `L` evidence. `?` marks an unverified
point that #743 must observe.

| Item | Checked revision or version |
| --- | --- |
| CHOMPI open-source release | [`CHOMPI-Club/CHOMPI@a73d732`](https://github.com/CHOMPI-Club/CHOMPI/tree/a73d732613da684e4de844619b690776f0f50ccf), the final release of a discontinued product, MIT |
| Multi-firmware launcher | [`sfaber02/CHOMPI` launcher-v1.1](https://github.com/sfaber02/CHOMPI/releases/tag/launcher-v1.1) at `79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415` (v1.0 at `614a7cfd`) |
| USB storage firmware | [`lnetzel/CHOMPI-lnetzel` usb-storage-v1.0](https://github.com/lnetzel/CHOMPI-lnetzel/releases/tag/usb-storage-v1.0). The release binary is byte-identical to a build of `a609509475a2949baf916a82686aaceff804447f` (`perf/faster-transfers`), not of the tag `7c452f0` |
| Compiler | GNU Arm Embedded Toolchain 10.3-2021.10 (GCC 10.3.1), the libDaisy-supported version |
| Codex Desktop | AppX `OpenAI.Codex` 26.930.3930.0, package family `OpenAI.Codex_2p2nqsd0c76g0`, window process `ChatGPT.exe`, window title "ChatGPT" |
| Claude Desktop | AppX `Claude` 2.19675.0.0, package family `Claude_pzs8sxrjxfjjc`; bundled Claude Code 2.1.286 running in WSL |
| Wispr Flow | 1.6.1034; push-to-talk is left Ctrl + left Win (`S`, current preferences) |
| Windows device history (`S`) | The owner's CHOMPI enumerated before as `USB\VID_0483&PID_5740` with a MIDI endpoint named "CHOMPI". It was unplugged on the collection date |

Local builds with GCC 10.3.1 all succeeded: upstream WAVE (200,100 bytes),
launcher v1.1 WAVE (200,736), the v1.1 launcher (124,956) and USB storage
(89,268). Upstream TAPE fails on Linux because `Sampler.h` includes
`Limiter.h` while the file is `limiter.h`; macOS hides the case mismatch. The
controller does not build TAPE.

## Owner decisions

Given in conversation on October 3, 2026 and recorded in the
[#738 pickup](https://github.com/jimmie-potts/agent-device-hub/issues/738#issuecomment-5974160427)
and [routing](https://github.com/jimmie-potts/agent-device-hub/issues/738#issuecomment-5974359583)
comments, [#784](https://github.com/jimmie-potts/agent-device-hub/issues/784#issuecomment-5974902280)
and [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741#issuecomment-5974936965):

- Card backups and controller installs use the launcher's key-15 USB storage
  mode from Windows. The owner has a card reader for the one-time launcher
  install. The launcher's MIDI firmware upload stays unused.
- If no supported route opens an exact existing Claude Code session, stop for
  an owner decision. The owner then accepted the undocumented
  `claude://code/continue` link with the fail-closed checks below.
- The Claude Desktop session ID comes from the Hub's own hook, through a new
  versioned lifecycle field. Personal hook settings stay unchanged.
- The Hub keeps that ID in memory only, with no stored-format change, and
  the bridge remembers each slot's ID across Hub restarts.
- If Claude Desktop archive is not observable to the Hub, an explicit CHOMPI
  gesture releases a Claude slot.
- The bridge is a portable TypeScript/Node 24 core with one small OS adapter
  interface, so a later move to the owner's Mac mini needs only a macOS
  adapter. Only the Windows adapter is built now.

## CHOMPI hardware

### Controls (`S`: schematic, BOM, board coordinates, firmware)

| Control | Firmware ID | Notes |
| --- | --- | --- |
| Front row, 15 white keys | `KEY_1`-`KEY_15`, left to right | The 15 task slots. Also the launcher's firmware picker keys |
| Second row, 10 black keys | `KEY_16`-`KEY_25` | Reserved for #744 utility actions |
| Top-left CHOMPI key | `KEY_26` | TAPE's record/shift key. Proposed Record (Wispr hold) control |
| Play, Loop | `KEY_27`, `KEY_28` | Proposed optional Send and Back |
| Four small knobs, left to right | `ENC_4`, `ENC_1`, `ENC_2`, `ENC_3` | Knobs 1-4 for #744. Clicks are on the button chain |
| Bottom-board encoder | `ENC_5` | Direct GPIOs, separate click. Very likely the big wheel (`?`) |
| Rightmost knob | `ENC_6` | Volume. Holding its click at boot enters test mode |
| Far-left two-position switch | `SW_TOG` | Stays unmapped |

Every key has its own CD4021 input, so there is no matrix, ghosting or
rollover limit. The button chain is five CD4021s and the small encoders use a
sixth. libDaisy debounces with a 7-sample integrator at up to 1 kHz, about
7 ms of latency, and decodes encoder steps at the same 1 kHz cap. Fast spins
may drop steps (`?`); detent count is unknown (`?`). All six encoders click.
There is no separate Record key and no pot or slider.

Two boot holds are reserved and the controller must not reuse them: CHOMPI +
Play + Loop at power-on enters shipping mode (power-off), and the volume click
at power-on enters test mode.

### Lights (`S`)

There are 35 addressable RGB LEDs on two WS2812-style chains driven by timer
PWM and DMA: 25 under keys 1-25 (GRB order) and 10 on the top panel (RGB order:
CHOMPI key, four small knobs, two wheel LEDs, Play, Loop and volume). Stock
firmware caps panel LEDs at about 9% and key LEDs at about 25% for heat and the
LED supply rail; the controller keeps those caps. A full refresh takes about
1.7 ms. LED DMA must stop before any reset or firmware handover, or the next
firmware's first frame is corrupted.

### USB (`S`)

The USB-C jack goes through a USB3740B switch. By default the switch gives the
data lines to the charger for BC1.2 detection; firmware must take them for the
Daisy's USB_HS pins (full speed, internal PHY). The launcher's
`UsbTakeOver`/`ServiceUsbSwitch` handshake does this correctly and lends the
lines back to the charger on its interrupt. The controller copies it; without
it the device disappears after a replug. The unit runs on battery, so
unplugging does not reset it.

CHOMPI's libDaisy is Electrosmith's adaptation of v5.4.0, shipped prebuilt. Its
USB stack is the ST USB Device Library with a CDC class only; MIDI is a
descriptor switch inside it. The identity `0483:5740` ("CHOMPI") is baked in,
so TAPE, the launcher picker and any stock libDaisy CDC build all present the
same VID/PID. The USB storage firmware registers its own class and descriptors
on the same ST core as `1209:C0A1`.

### Firmware base and launcher (`S`)

CHOMPI apps are `BOOT_SRAM` images that run from SRAM at `0x24000000`; the
launcher accepts images up to 512 KiB, but code must fit the 232 KiB
`SRAM_EXEC` region of the app linker script. A controller built from WAVE's
hardware layer, the launcher's USB switch and LED teardown, and a HID class
following the USB storage firmware's pattern, without DSP, should be near the
launcher's size (about 125 KB), leaving roughly 100 KiB of that region
(`?` until built).

Every launcher firmware must carry the `BACKUP_SRAM` linker fix so libDaisy's
`boot_info` sits at `0x38800000`. Without it libDaisy can skip clock and SDRAM
setup at random (the "64 MHz bug"). Verify with `nm` that `boot_info` is at
`0x38800000`.

Slots are named `/FIRMWARE/NN_NAME.bin`. TAPE, TEMPO and WAVE hold 01-03 and USB
storage holds 15, so the controller takes **slot 04**. It needs no card files:
mapping and colors live in the Windows bridge's JSON. A controller that never
mounts the card cannot damage music data.

After its first install the launcher writes only the card, never internal
flash. QSPI changes only when the root `CHOMPI.bin` changes. Selecting a
firmware is a power cycle plus a key press: 1 TAPE, 2 TEMPO, 3 WAVE, 4
controller, 15 USB storage. A software return to the picker through
`ResetToBootloader(DAISY_SKIP_TIMEOUT)` after teardown is plausible from source
(`?`) and stays deferred, as #741 states. The default `ResetToBootloader()`
enters ROM DFU and must not be used.

### Music data, recovery and storage mode (`S`)

Under the launcher, each music firmware keeps its samples, `options.json` and
`presets.json` in its own folder (`/TAPE`, `/TEMPO`, `/WAVE`) and falls back to
the root if the folder is missing. TAPE's looper buffer lives only in SDRAM and
is lost on any power cycle or firmware switch. An unsaved sample capture is
also at risk. Trials use saved disposable material and warn before every
restart.

Recovery, in order: power cycle; restore card files from the backup over USB
storage, or swap in the stock card; reflash the bootloader at
<https://flash.daisy.audio> in ROM DFU mode. Reflashing the bootloader is
outside the epic's current authority and needs a separate owner decision.
Stock units ship bootloader v6.2 (`S`); the owner's unit is unverified until
#743, and the published source is 6.4-beta.

USB storage is a separate firmware that hands the whole card to the PC as a
SCSI block device. It renames the card `CHOMPI-SD` and runs at about 1 MB/s.
It has no event channel, no LED path and no file view while mounted, so it is
an install and backup route, never an agent input protocol.

### Licenses to carry

CHOMPI, the launcher and the USB storage fork are MIT. Keep `THIRD_PARTY.md`
notices and respect `TRADEMARKS.md` (do not name derived hardware CHOMPI).
libDaisy, DaisySP and the Daisy bootloader are MIT; CMSIS is Apache-2.0; the
STM32 HAL is BSD-3-Clause; FatFs uses ChaN's BSD-style license; the ST USB
Device Library uses ST's SLA0044, which limits use to ST parts. No TinyUSB is
involved.

## Transport decision

**Selected: vendor-defined HID** (usage page `0xFF00`, 64-byte interrupt
reports at 1 ms) with its own VID/PID and a per-unit serial. It follows the USB
storage firmware's pattern of a custom class on libDaisy's ST core, about
150-300 lines with no libDaisy rebuild. Windows binds the built-in HID driver
with no install or admin rights, and reports arrive framed. Exclusive open is
not portable: hidapi, which node-hid wraps, always opens Windows HID devices
with shared read and write access, so one-writer enforcement belongs to the
bridge (see [Boundary and ownership](#boundary-and-ownership)).

The ID must not be `0483:5740` (TAPE, the picker and generic ST devices) or
`1209:C0A1` (USB storage), and must avoid PIDs `8360`, `8297` and `8298` under
any VID: Codex Desktop claims those, with Espressif VID `303A` and usage page
`0xFF00`, for its own Work Louder "Codex Micro" controller, and its filter
checks the PID and usage page. #741 selects the ID and documents it.

**Fallback: USB CDC ACM.** It is the smallest firmware change, but it is a byte
stream needing framing, drops data on a busy transmit, shares the generic ST
VID/PID unless libDaisy is rebuilt, and its COM port can change.

**Rejected: MIDI** (owner decision, and the launcher picker accepts SysEx
firmware writes, so the bridge must never open MIDI) and **mass storage** (no
event or LED channel).

## Desktop clients

Each row's status is **Supported**, **Unsupported** or **Unverified**, with its
evidence class. Supported from `D` or `S` evidence still needs the #743 live
observation before anything depends on it in installed use.

### Codex Desktop

| Capability | Status | Detail | Evidence |
| --- | --- | --- | --- |
| Exact task identity | Supported | Hub `sessionId` = Codex hook `session_id` = Desktop thread UUID = deep-link `<thread-id>` | `S`: `packages/agent-state/src/providers.ts`, deep-link schema in the bundle; [provider qualification](provider-qualification.md) |
| Opening an existing task | Supported | `codex://threads/<id>` is registered as an AppX protocol; the running instance raises its window and navigates. An unknown ID raises the window and leaves the previous task selected, without creating a task. Foreground behavior under Windows focus rules is unverified | `D`: [Codex commands](https://learn.chatgpt.com/docs/reference/commands); `S`: manifest and main-process handler |
| Selected-task verification by exact ID | Unsupported | The window title is static and no local state records the selection | `S` |
| Selected-task verification by UI Automation | Unverified | UIA may expose the selected sidebar row and its title; a title is not an exact identity | `S`: DOM attributes in the bundle are not UIA properties |
| Lifecycle and attention feed | Supported | The Hub already receives activity, `attention.approval` (no request ID) and unread for Codex Desktop | `S`: `providers.ts`, `apps/hub/src/codex-desktop.ts`; installed since #191 |
| Archive signal | Supported | `SessionEnd` retires the session on archive or delete, but also on normal close and after 30 minutes idle and unopened in any connected client, so it is not an archive signal by itself. Archived threads appear as `archived_sessions/rollout-<timestamp>-<id>.jsonl` filenames in the Codex home | `D`, `S`: [provider qualification](provider-qualification.md); archive end accepted in #218 |
| Composer focus | Supported | `Alt+L` moves focus to the main composer | `S`: bundle command table |
| Pending-approval guard | Unverified | Enter approves and Esc declines an open approval card. Whether Enter in a focused composer approves while a card is open is unverified. The Hub marker can outlive the request, which only over-blocks | `D`, `S` |
| Send | Supported | Keystroke only: Enter sends (`composerEnterBehavior = "enter"` in the owner's Codex config); mid-turn Enter queues. No non-keystroke send route exists | `S` |
| Model change | Supported | `Ctrl+Shift+M` opens the model picker and `Alt+M` the recent model and effort combinations | `D`, `S` |
| Effort change | Unverified | Increase, decrease and cycle commands exist without default keys. Binding one is a personal settings change outside the epic's current authority | `S` |
| Model and effort readback | Unsupported | Per-task values are not observable locally; config values are defaults only | `S` |
| Plugins, custom UI, app-server control of another task | Unsupported | None can select, focus or send into another task. The Desktop app-server is a private stdio child; a second app-server would compete as a writer | `D`, `S` |

### Claude Desktop Code tab

| Capability | Status | Detail | Evidence |
| --- | --- | --- | --- |
| Documented links to an existing Code session | Unsupported | Only `claude://code/new[?q,folder]` is documented, and it creates a session. Chat and project links do not reach Code sessions | `D`: [Claude Desktop links](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link) |
| Opening an existing session by undocumented link | Supported, undocumented | `claude://code/continue?session=local_<id>` opens that exact session if it exists and is not archived; otherwise it silently shows the Code home. The app builds this link itself for its taskbar Jump List. Any Desktop update can change it | `S`: main-process URL handler in the installed bundle. Accepted by the owner with fail-closed checks |
| Unsafe undocumented links | Unsupported | `code/needs-input` opens a different waiting session when the ID is absent. `claude://resume` imports or unarchives sessions. Never use either | `S` |
| Desktop session identity | Supported, undocumented | Desktop's `local_<uuid>` differs from the hook `session_id`, which changes on `/clear`; the Desktop ID survives `/clear` | `S`: Desktop session store |
| Desktop ID available to hooks | Unverified | Desktop-hosted Code processes carry `CLAUDE_CODE_HOST_SESSION_ID=local_<uuid>` and `CLAUDE_CODE_ENTRYPOINT=claude-desktop`. Hook processes are expected to inherit them; the installed observation planned in [#784](https://github.com/jimmie-potts/agent-device-hub/issues/784) will check it. If they do not, Claude routing stays disabled | `S`: Code process environment |
| Lifecycle and attention feed | Supported | Desktop-hosted Code sessions load the WSL user settings that run the installed Hub producer for every hooked event, so activity, `attention.approval` for permission prompts and session ends reach the Hub like other Claude Code sessions. A live Desktop session in the feed is still to be observed | `S`: user hook configuration, `providers.ts`; [provider qualification](provider-qualification.md) |
| Hub distinguishes Desktop from CLI | Unsupported | Both use client `code` and one source today | `S`: `providers.ts`, provider qualification |
| Selected-session verification | Supported, undocumented | When a session becomes visible the app stamps its `lastFocusedAt` and saves its record under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code-sessions\`. The window title is always "Claude". Split panes and pop-out windows are unverified | `S` |
| Archive signal | Supported, undocumented | The same private store records `isArchived` and an `archived-sessions.idx` index. Archiving stops the Code process; whether that emits `SessionEnd` is unverified | `S` |
| Composer focus | Unverified | Composer state is not stored locally; a UIA keyboard-focus check is the planned route | `S` |
| Pending-permission guard | Unverified | The Hub's `attention.approval` covers permission prompts. Whether Enter approves a focused permission card is unverified | `S` |
| Send | Supported | Enter sends | `D`: [Claude Code Desktop](https://code.claude.com/docs/en/desktop) |
| Model and effort change | Unverified | Menu shortcuts are documented for macOS (Cmd+Shift+I, Cmd+Shift+E); the Windows mapping is unverified | `D` |
| Model and effort readback | Supported, undocumented | Stored per-session values are readable | `S` |
| Mods controlling a session from outside | Unsupported | A mod can fill and submit its own session's prompt and fetch outbound, but cannot select a session, raise the window or listen. Enabling one is a personal plugin change outside the epic's current authority | `D`: [Claude mods](https://claude.com/blog/claude-code-mods); `S` |

## Routing design

### Boundary and ownership

- The Hub in WSL stays the only agent-state owner. The bridge reads
  `GET /api/monitor/v1/sessions` and `/changes` with its own `read`-only
  credential over numeric loopback. It never ingests, acknowledges or
  approves, and it adds no lifecycle reducer.
- One Windows bridge process is the only CHOMPI writer. It takes a per-user
  single-instance lock before opening the device, and a second instance that
  cannot take the lock exits without opening it. The lock is portable (a held
  lock file, or a named mutex in the Windows adapter). The bridge matches the
  controller's VID, PID, product and serial only.
  The legacy MIDI bridge must not run during the controller trial, and the
  controller firmware never presents MIDI.
- Slot assignments live in the bridge's own private state on Windows,
  separate from Hub feed retention. No SQLite file is shared across Windows and
  WSL.
- Input stays on Windows beside the apps, as [desktop controls](desktop-controls.md)
  requires.

The bridge follows the repository's TypeScript/Node 24 convention, as the
owner decided. A portable core holds the protocol, slots, profile, feed client
and routing decisions, and uses node-hid for USB. Keystrokes, foreground
identity, UI checks and client file paths sit behind one OS adapter interface.
The Windows adapter uses FFI for `SendInput` and package identity and a
long-lived PowerShell helper for UI Automation, adding no new toolchain; the
legacy `chompi-codex` bridge's `SendInput` and package-identity approach is
reusable. A macOS adapter (`open` for deep links, CGEvent keystrokes and the
Accessibility API) is a later, separately qualified step. Protocol fixtures
stay JSON.

### Exact-task focus, fail closed

A task key press selects and focuses only. It never acknowledges, approves or
dismisses attention. Before any input:

1. **Target check.** The slot's task still exists and is not archived. Codex:
   no `archived_sessions` filename carries the thread ID. Claude: the Desktop
   record exists with `isArchived=false`. A session the Hub has retired after
   idle or close stays openable; its key shows the ended state.
2. **Open.** Codex: `codex://threads/<sessionId>`. Claude:
   `claude://code/continue?session=<local_id>`, using the Desktop ID the Hub
   feed supplied for that slot.
3. **Verify.** The foreground window belongs to the expected package family.
   Codex: UI Automation shows the selected sidebar row with the thread's
   name, and no other open Codex task shares that name; a duplicate name
   fails closed. The name is the one Codex keeps in its local
   `session_index.jsonl`, or the Hub's title when Codex has never named the
   thread (the Hub carries a Codex title only when the owner set one; found
   in the #743 trial). A name any other thread in that index also has fails
   closed too, because collapsed, archived or deleted rows are not in the
   sidebar's count. Claude: only the target session's `lastFocusedAt` moved past the
   press time and no other session's is newer.
4. **Composer.** Codex sends `Alt+L`; both clients then require UI Automation
   keyboard focus on the composer.
5. **Unsupported client version.** The bridge keeps a list of qualified
   client versions. An unknown Claude Desktop version disables Claude routing
   until it is re-qualified, because the link is undocumented.

Any failed step lights the key's error state, keeps the previous target
invalid and sends nothing. A task switch invalidates pending input.

### Dictation and Send

- **Record (proposed `KEY_26`)** holds left Ctrl + left Win for Wispr, which
  dictates through the computer microphone, only after the composer check
  passes, and releases on key release. Release inserts a
  draft and never sends. Disconnect, reload or a task switch releases held keys.
- **Big-wheel click** sends one Enter to the verified composer. It is blocked
  while the Hub shows `attention.approval` for that session, or the approval
  check is unknown, because Enter approves an open request in Codex. An
  uncertain Send is never retried. Small-knob clicks never send.
- Avoid controls that collide with Wispr (left Ctrl + left Win, Ctrl+Win+Space,
  Esc dismiss) or Codex (Ctrl+Space, Ctrl+Q, Alt+L, Alt+M).

### Slot release

Slots are first-free among keys 1-15 and stay fixed through response end,
waiting, pause, restarts, stale observations and Hub retirement after idle or
close. The bridge keys Codex slots by thread ID and Claude slots by Desktop ID,
which survives `/clear`; it keeps each slot's last-known title. A slot is
released only by explicit archive or the owner's release gesture:

- Codex: an `archived_sessions` filename for the thread ID, read by name only.
- Claude: the Desktop record's `isArchived` flag, read by key only. This
  undocumented store is the one the focus check already reads.
- Claude: an explicit CHOMPI gesture, for example holding the slot key with
  Loop (Loop is a proposed key), as the owner decided. Extending the gesture
  to Codex needs an owner
  decision.

Hub expiry after 24 hours without evidence never releases a slot.

### Minimal protocol (for #741)

| Direction | Message | Purpose |
| --- | --- | --- |
| Device to host | `hello` | Protocol version, firmware version, control and LED counts; starts a new connection epoch |
| Device to host | `input` | Epoch, sequence, control ID, kind (`press`, `release`, `turn ±n`) |
| Device to host | `heartbeat` | Liveness with the last applied LED frame number |
| Host to device | `leds` | Frame number and 35 RGB values in two reports, under the brightness caps |
| Host to device | `host-heartbeat` | Host liveness and profile version |

The firmware never queues input while disconnected. The bridge drops input
from an earlier epoch, so a reconnect cannot replay Send. Without a host
heartbeat for about two seconds the firmware shows a dim disconnected pattern
that cannot be mistaken for any task state.

## No-misrouting test matrix

| Case | Required result |
| --- | --- |
| Key for an archived task, an empty slot or a stale Hub feed with no cached target | No link opened; error light |
| Claude Desktop ID unknown, malformed or archived | No link opened; error light |
| Hub retires a session after idle, close or `/clear` | Slot kept; key shows ended; it still opens the same task |
| Link opened but a different task stays selected (Codex unknown ID, Claude Code home) | Verification fails; nothing typed |
| Two live tasks with the same title | Codex verification fails closed; Claude still verifies by ID |
| Target app not foreground after open | No input |
| Task switch between Record and Send | Pending target cleared; Send refused |
| Approval pending on the target | Send refused; key press does not approve or acknowledge |
| Duplicate or repeated wheel click; Send outcome uncertain | One Enter at most; no retry |
| Disconnect during Record hold | Modifiers released; no draft sent |
| Reconnect or bridge restart | No replay; slots retained; fresh press required |
| Unqualified client version | That client's routing disabled; the other unaffected |
| Second bridge instance, including an overlapping restart | Single-instance lock refused; the second instance exits before opening the device |
| Legacy MIDI bridge running | Never sees the controller, which presents no MIDI |

## Owner-operated trial plan (#743)

Preparation: connect CHOMPI directly by USB-C; back up the stock card through
the reader, because USB storage mode exists only after the launcher is
installed; install the launcher; back up later changes over USB storage; boot key 15 and copy
`/FIRMWARE/04_<NAME>.bin`; install the bridge for the owner's user; create
throwaway Codex and Claude tasks, including two with the same title.

1. Identify the big wheel, detents and power switch; confirm the proposed
   Record, Send and Back controls.
2. Confirm the Claude hook environment carries `CLAUDE_CODE_HOST_SESSION_ID`
   matching the Desktop record, across `/clear`, resume and an app restart.
3. For each client, open task B while A is visible and while another app has
   focus; record selection, foreground and the verification result. Repeat
   with unknown, archived and duplicate-title targets.
4. Check whether Enter in a focused composer approves an open approval or
   permission card, and confirm Send stays blocked while attention is open.
5. Record → Wispr with the computer microphone → draft → wheel Send in each
   client; confirm one send, no
   send from small knobs, and no send on release.
6. Observe active, idle, attention and disconnected lights; press a flashing
   key and confirm attention remains.
7. Change one harmless JSON mapping without reflashing; load invalid JSON and
   confirm the last good profile stays.
8. Unplug and replug, restart the bridge, and confirm slots, released
   modifiers and no replay.
9. Save a disposable TAPE sample, restart into TAPE, play it, restart into the
   controller and confirm saved assets and slots.
10. Check whether Claude archive emits `SessionEnd`, and the Claude release
    gesture.

## Findings for dependent work

GitHub issues own status and blocked-by relationships. These are the findings
each dependent issue must use.

- [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741), firmware
  and bridge: vendor HID on libDaisy's ST core with a new VID/PID; slot 04;
  the `BACKUP_SRAM` fix; the launcher's USB switch and LED teardown; the
  minimal protocol above; one writer enforced by a single-instance lock; a
  TypeScript core with a
  Windows OS adapter.
- [#784](https://github.com/jimmie-potts/agent-device-hub/issues/784): the
  owner-selected Hub hook field that carries the Claude Desktop session ID,
  kept in Hub memory. Its planned installed observation is the first check
  that hooks see `CLAUDE_CODE_HOST_SESSION_ID`. Installing it uses the
  installer change in [#794](https://github.com/jimmie-potts/agent-device-hub/issues/794).
- [#742](https://github.com/jimmie-potts/agent-device-hub/issues/742), task
  routing: Claude routing consumes #784's field and the bridge's own
  archive and focus reads. Codex verification needs UI Automation, which #743
  qualifies. Reading archive and focus evidence for slot bookkeeping must not
  reinterpret lifecycle state; #742 confirms that boundary.
- [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743), first
  installed trial: its Claude routing uses #784's field, and its plan adds the
  hook environment check (trial step 2), approval-guard checks and big-wheel
  identification.
- [#744](https://github.com/jimmie-potts/agent-device-hub/issues/744) and
  [#745](https://github.com/jimmie-potts/agent-device-hub/issues/745), knobs and
  their installed check: Codex model change has default shortcuts, but Codex
  effort change needs a personal key binding, and Claude's Windows model and
  effort shortcuts are unverified. A personal binding needs owner authority
  beyond the current epic grant. Until #743 records what is available, knob 1
  and knob 2 "for each client" may need an explicit owner scope decision.

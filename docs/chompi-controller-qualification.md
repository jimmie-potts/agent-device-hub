# CHOMPI controller qualification

Work source: [Hub #740](https://github.com/jimmie-potts/agent-device-hub/issues/740),
part of [epic #738](https://github.com/jimmie-potts/agent-device-hub/issues/738).
Evidence collected October 3, 2026 UTC.

**A non-MIDI controller is feasible and both Desktop clients have a usable,
fail-closed routing design.** This opening describes the October 3 investigation,
before the live trial. Later dated rows and the
[#743 accepted trial](https://github.com/jimmie-potts/agent-device-hub/issues/743#issuecomment-5998042747)
record Windows/client and physical evidence separately; they do not qualify other
versions or every later feature. New runtime integration remains #837. The selected route is a controller firmware in launcher slot 04
that talks vendor-defined HID to one Windows bridge. The bridge reads the Hub's
session feed, keeps task slots, opens tasks by deep link, verifies the result
and sends keystrokes only after verification. Claude routing depends on an
undocumented Claude Desktop link, which the owner accepted with fail-closed
checks. [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743)
owns the device and live-client trial.

The October 3 investigation was read-only. No firmware was flashed, no USB device was
opened, no link was launched, no keystroke was sent and no setting changed.
Bundle inspection read code, key names and schemas, never task content.

## Evidence classes and setup

`D` means official documentation, `S` inspected source, built output,
installed bundle, local configuration or filesystem artifact, `O` owner
decision or report, and `L` an authorized live
observation; each dated `L` row cites its live trial or follow-up. `?` marks an
unverified point, not a current blocker inferred from the original plan.

| Item | Checked revision or version |
| --- | --- |
| CHOMPI open-source release | [`CHOMPI-Club/CHOMPI@a73d732`](https://github.com/CHOMPI-Club/CHOMPI/tree/a73d732613da684e4de844619b690776f0f50ccf), the final release of a discontinued product, MIT |
| Multi-firmware launcher | [`sfaber02/CHOMPI` launcher-v1.1](https://github.com/sfaber02/CHOMPI/releases/tag/launcher-v1.1) at `79ea9e7e18f1ca6057ce35ae1a3a17d47f8a4415` (v1.0 at `614a7cfd`) |
| USB storage firmware | [`lnetzel/CHOMPI-lnetzel` usb-storage-v1.0](https://github.com/lnetzel/CHOMPI-lnetzel/releases/tag/usb-storage-v1.0). The release binary is byte-identical to a build of `a609509475a2949baf916a82686aaceff804447f` (`perf/faster-transfers`), not of the tag `7c452f0` |
| Compiler | GNU Arm Embedded Toolchain 10.3-2021.10 (GCC 10.3.1), the libDaisy-supported version |
| Codex Desktop | AppX `OpenAI.Codex` 26.930.3930.0, package family `OpenAI.Codex_2p2nqsd0c76g0`, window process `ChatGPT.exe` (runs from the package folder without package identity, found in the #743 trial; the bridge identifies it by that folder), window title "ChatGPT" |
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
| Second row, 10 black keys | `KEY_16`-`KEY_25` | #744 utility actions through the profile's `keys` map, which maps none by default; they do nothing until a later #744 slice maps them |
| Top-left CHOMPI key | `KEY_26` | TAPE's record/shift key. Proposed Record (Wispr hold) control |
| Play, Loop | `KEY_27`, `KEY_28` | Send (with the big-wheel click); proposed Back |
| Four small knobs, left to right | `ENC_4`, `ENC_1`, `ENC_2`, `ENC_3` | Knob 1 (`ENC_4`, turn 44, click 32, LED 26) sets the model and knob 2 (`ENC_1`, turn 41, click 29, LED 27) the effort of the task in front (#906); knob 3 (`ENC_2`, turn 42, click 30, LED 28) picks Claude's suggested next step into the composer as a draft, never sending (#907). Knob 4 (`ENC_3`, turn 43, LED 29) pages task slots (#822); its click (31) is the Attention click (#865), and a refused click flashes LED 29 red. Clicks are on the button chain |
| Bottom-board encoder | `ENC_5` | Direct GPIOs, separate click. Very likely the big wheel (`?`) |
| Rightmost knob | `ENC_6` | Volume (#865): turn 46 sends the system volume keys, click 34 toggles mute, LED 34 flashes on an ignored or failed volume key. Holding its click at boot enters test mode |
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
| Pending-approval guard | Unverified | Enter approves and Esc declines an open approval card. In the #743 trial the escalation card replaced the composer and took keyboard focus, so the bridge treats approval as absent only while exactly one composer exists ([UIA notes](../apps/chompi-bridge/src/windows/UIA-NOTES.md#approval-cards)); the installed Codex guard refusal remains unverified by that receipt; its question-card refusal was in Claude. Later card-answer behavior is separately owned. Since #821 Send no longer reads the Hub marker, which could outlive the request | `D`, `S`, `L` |
| Send | Supported | Keystroke only: Enter sends (`composerEnterBehavior = "enter"` in the owner's Codex config); mid-turn Enter queues. No non-keystroke send route exists | `S` |
| Model change | Supported | The picker button (`<model> <effort>` while collapsed, `Select effort` while expanded) supports ExpandCollapse; its "Select model" entry supports Invoke and opens the model list, whose options support SelectionItem; `Select()` applies a model and returns to the picker, which stays open. `Collapse` does not close the picker; one Escape into it does. `Ctrl+Shift+M` also opens it. Knob 1 uses the UI Automation route (#906) | `D`, `S`, `L` (2026-10-06, [#906](https://github.com/jimmie-potts/agent-device-hub/issues/906#issuecomment-6027688512)) |
| Effort change | Supported | The owner bound "Increase reasoning effort" and "Decrease reasoning effort" to `Ctrl+Alt+=` and `Ctrl+Alt+-` on 2026-10-06; both are app-scoped and unused elsewhere, except that `Ctrl+Alt+-` splits a Claude Desktop pane. In the picker, the "Power" entry (Invoke only, no RangeValue) steps the level with Right and Left. Knob 2 uses the chords, sent only with Codex in front, no card and the picker closed (owner decision on #906); Power with arrows only when no chords are configured | `S`, `O` ([chords](https://github.com/jimmie-potts/agent-device-hub/issues/906#issuecomment-6023061003)), `L` (2026-10-06, #906) |
| Model and effort readback | Supported | The picker button's name, `<model> <effort>` while collapsed (for example `GPT-6 Luna Extra High`), carries both without opening anything; the open picker's live `StatusBar` also announces `<model> <level>, <n> of <count>.`, whose count differs by model. No per-task value is stored locally | `S`, `L` (2026-10-06, #906) |
| Plugins, custom UI, app-server control of another task | Unsupported | None can select, focus or send into another task. The Desktop app-server is a private stdio child; a second app-server would compete as a writer | `D`, `S` |

### Claude Desktop Code tab

| Capability | Status | Detail | Evidence |
| --- | --- | --- | --- |
| Documented links to an existing Code session | Unsupported | Only `claude://code/new[?q,folder]` is documented, and it creates a session. Chat and project links do not reach Code sessions | `D`: [Claude Desktop links](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link) |
| Opening an existing session by undocumented link | Supported, undocumented | `claude://code/continue?session=local_<id>` opens that exact session if it exists and is not archived; otherwise it silently shows the Code home. The app builds this link itself for its taskbar Jump List. Any Desktop update can change it | `S`: main-process URL handler in the installed bundle. Accepted by the owner with fail-closed checks |
| Unsafe undocumented links | Unsupported | `code/needs-input` opens a different waiting session when the ID is absent. `claude://resume` imports or unarchives sessions. Never use either | `S` |
| Desktop session identity | Supported, undocumented | Desktop's `local_<uuid>` differs from the hook `session_id`, which changes on `/clear`; the Desktop ID survives `/clear` | `S`: Desktop session store |
| Desktop ID available to hooks | Observed on the installed path | [#784 closeout](https://github.com/jimmie-potts/agent-device-hub/issues/784#issuecomment-5975964904) confirmed hook inheritance with a matching Desktop `hostSessionId` in snapshot 1.3 and no field on an interactive CLI root. Missing or invalid evidence still disables exact routing | `S`, installed observation (2026-10-04) |
| Lifecycle and attention feed | Supported | Desktop-hosted Code sessions load the WSL user settings that run the installed Hub producer for every hooked event, so activity, `attention.approval` for permission prompts and session ends reach the Hub like other Claude Code sessions. The #784 installed observation confirmed a live Desktop root in the feed; later client versions require their own qualification | `S`: user hook configuration, `providers.ts`; [provider qualification](provider-qualification.md) |
| Hub distinguishes Desktop from CLI | Unsupported | Both use client `code` and one source today | `S`: `providers.ts`, provider qualification |
| Selected-session verification | Supported, undocumented | When a session becomes visible the app stamps its `lastFocusedAt` and saves its record under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code-sessions\`. The window title is always "Claude". Split panes and pop-out windows are unverified | `S` |
| Archive signal | Supported, undocumented | The same private store records `isArchived` and an `archived-sessions.idx` index. Archiving stops the Code process; whether that emits `SessionEnd` is unverified | `S` |
| Composer focus | Observed in the #743 trial | Composer state is not stored locally; the Windows UIA adapter verifies keyboard focus before input. The [trial receipt](https://github.com/jimmie-potts/agent-device-hub/issues/743#issuecomment-5998042747) records drafts placed in both clients | `S`, `L` (2026-10-04/05) |
| Pending-permission guard | Observed for the #743 Claude question card | The Hub's `attention.approval` covers permission prompts, but since #821 Send relies on the bridge's own card check instead. In the #743 trial, permission and question cards each carried the class token `epitaxy-approval-card` while the composer kept focus, so the bridge blocks Send while any element carries it ([UIA notes](../apps/chompi-bridge/src/windows/UIA-NOTES.md#approval-cards)); the [#743 receipt](https://github.com/jimmie-potts/agent-device-hub/issues/743#issuecomment-5998042747) records Send refused with `approvalCards: 1` and the question card untouched, then one Send after the owner answered with the mouse. This bounds the installed result to that Claude trial, not every card or later client version | `S`, `L` (2026-10-04/05) |
| Send | Supported | Enter sends | `D`: [Claude Code Desktop](https://code.claude.com/docs/en/desktop) |
| Model and effort change | Supported | The `Model: <name>` button supports ExpandCollapse (Expand opens the menu, Collapse closes it unchanged); model options support SelectionItem, and `Select()` applies one and closes the menu. The `Effort: <level>` button supports ExpandCollapse, and its `Effort` slider supports RangeValue (0-5, SmallChange 1), where `SetValue` applies a level at once. A model without an effort setting (Haiku 4.5) shows no Effort button. `Ctrl+Shift+I` and `Ctrl+Shift+E` also open them. Knobs 1 and 2 use the UI Automation route (#906) | `D`, `L` (2026-10-06, [#906](https://github.com/jimmie-potts/agent-device-hub/issues/906#issuecomment-6027688512)) |
| Model and effort readback | Supported, undocumented | The composer's `Model: <name>` and `Effort: <level>` buttons, and the session record's `model` and `effort`, which updated within about 1 s of a change | `S`, `L` (2026-10-06, #906) |
| Next-step suggestions | Supported, undocumented | With the `next-steps` mod, a `Group` holds a `Text` `next:`, one `Button` per suggestion (named with its label) and a `Button` `dismiss`; it sits two `Group`s below the branch beside the composer's group (observed 2026-10-07, after the first locator missed it); the buttons accept keyboard focus (`IsKeyboardFocusable`, `HasKeyboardFocus` after `SetFocus`) and Claude draws its own focus ring. Sending a message hides the band. Claude's ghost text is not exposed to UI Automation (the empty `Prompt` editor's Value reads one line break), and a Right arrow accepts it without sending. Knob 3 uses `SetFocus` and `Invoke` on the band and one Right arrow for the ghost text (#907) | `L` (2026-10-06, [#907](https://github.com/jimmie-potts/agent-device-hub/issues/907)), `O` (Right arrow accepts; the knob 3 click rule) |
| Mods controlling a session from outside | Unsupported | A mod can fill and submit its own session's prompt and fetch outbound, but cannot select a session, raise the window or listen. Enabling one is a personal plugin change outside the epic's current authority | `D`: [Claude mods](https://claude.com/blog/claude-code-mods); `S` |

## Routing design

### Boundary and ownership

- The Hub in WSL stays the only agent-state owner. The bridge reads
  `GET /api/monitor/v1/sessions` and `/changes` with its own `read`-only
  credential over numeric loopback. It never ingests, acknowledges or
  approves through the Hub, and it adds no lifecycle reducer. Since #821 a
  still big-wheel click can press a button on an open card, which may approve a
  permission request in the client's UI; that is not a Hub acknowledgement.
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
dismisses attention, and since #821 it arms nothing: Send and Record act on
whatever is in front when they are pressed. Before any input:

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
   press time and no other session's is newer. Claude stamps `lastFocusedAt` only
   when the selection changes, so a link to the session it already shows moves
   nothing (found in the #743 trial). That press also verifies when Claude was
   in front before the link and the target was strictly newest among known
   sessions (slot records and Hub `hostSessionId`s, read completely), and after
   the link it still is and no other session's moved past the press. A tie,
   Claude not in front or any unknown read gives no extra evidence; the advance
   rule applies. Residual: the window's view is unobserved, so Code home, the
   Chat tab or an unknown session in front is covered only by the link
   navigating; the composer check does not narrow it.
4. **Composer.** Codex sends `Alt+L`; both clients then require UI Automation
   keyboard focus on the composer.
5. **Unsupported client version.** The bridge keeps a list of qualified
   client versions. An unknown Claude Desktop version disables Claude routing
   until it is re-qualified, because the link is undocumented.

Any failed step lights the key's error state and sends nothing. A task switch
releases held keys and cancels pending input.

### Dictation and Send

The owner chose a keyboard-like model on #821 (2026-10-05); it replaced the
#742 verified-target model, under which a reload or Back left Send without a
target and a task chosen with the mouse could not be sent to.

- **Record (`KEY_26`)** holds left Ctrl + left Win for Wispr, which dictates
  through the computer microphone, whenever it is pressed, and releases on key
  release. There is no foreground, card or composer check, so dictation works
  in any app, a card's free-text field included. Release inserts a draft and
  never sends. A Record press is never refused: it abandons a Send still
  checking the window, and during a Send's Enter keystroke the chord goes down
  right after it. Disconnect, reload, Back, a task switch and shutdown release
  held keys.
- **Big-wheel click or Play** (the default profile maps both; owner choice in
  the #743 trial) sends one Enter at the press only when Codex or Claude
  Desktop is in front at a qualified version, its composer has focus, the
  bridge's card check finds no card (Enter approves an open request in Codex),
  the repeat window has passed and Record is not held. Any other app in front
  gets nothing. An uncertain Send is never retried. A refused or uncertain
  Send or card press flashes both big-wheel LEDs in the error color (owner
  decision on #821). Small-knob clicks never send.
- **Cut assurances** (owner decision on #821): Send no longer checks the Hub's
  `attention.approval` or the feed's freshness; the card and composer checks
  are its only guards. A Codex card with its own focused `ProseMirror` field
  would accept Enter, as a keyboard would. Record works anywhere.
- **Card answers.** While a card is open in a qualified Codex or Claude window
  in front, big-wheel turns move keyboard focus between the card's actionable
  buttons through UI Automation, one button per software detent
  (`cards.stepCounts`, default 6 counts, about a quarter turn at the about 25
  counts per revolution measured on the trial device on 2026-10-05,
  restarting on a reversal). A big-wheel click presses the focused button only
  when the wheel's own step moved focus to it on that card, after
  `cards.clickStillMs` (default 250 ms) of stillness; a Codex card's initially
  focused approve button is never pressed by a click alone. Play is refused on
  a card. An unknown card state, including a Codex view whose card container
  cannot be established, makes the wheel do nothing. Codex cards are
  identified by structure (no composer, exactly one selected sidebar row, and a
  focused button in a group holding text and two or more actionable buttons),
  which leaves a narrowed residual: see the
  [UIA notes](../apps/chompi-bridge/src/windows/UIA-NOTES.md#card-answers).
  #821's installed trial checks the feel of the detent and stillness.
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
| Link opened but a different task stays selected (Codex unknown ID; Claude Code home when the target is not strictly newest among known sessions) | Verification fails; nothing typed |
| Claude in front on Code home, the Chat tab or a session the bridge does not know, the target strictly newest among known sessions, and the link does not navigate | Accepted residual: verification passes. The #743 trial checks that the link navigates |
| Two live tasks with the same title | Codex verification fails closed; Claude still verifies by ID |
| Target app not foreground after open | No input |
| Send with no slot press, Codex or Claude in front at a qualified version, composer focused, no card | One Enter to the task in front (press-time model, #821) |
| Send with another app in front, an unknown foreground, an unqualified or unknown client version, the composer unfocused or unknown, or Record held | Send refused; nothing typed; wheel LEDs flash red |
| Record pressed while a Send is checking, or while its Enter is typed | Chord pressed at once and the checking Send abandoned, or chord pressed right after the Enter |
| Task switch between Record and Send | Chord released; the next Send is evaluated at its own press |
| Approval or question card visible, or card state unknown | Send and Play refused; key press does not approve or acknowledge |
| Hub `approval` attention or a stale feed without a visible card | Cut assurance (#821): Send types one Enter; the card and composer checks are its only guards |
| Codex card with its own focused `ProseMirror` field | Accepted residual (#821): counts as the composer and accepts Enter; not observed |
| Card open: wheel turn | Focus moves one stop per detent threshold; reversal restarts the count; stops at the ends; text fields, disabled and menu buttons are skipped. A Claude question card's stops are its answer rows and "Other" only (class token `text-left`), not its header or footer buttons; other cards stop on every actionable button |
| Card open: Claude applies a wheel step's focus late | Chosen when focus is seen on the requested stop within the helper's 400 ms read-back; otherwise no choice and a click presses nothing. A still click during the read-back is refused (`card-busy`) |
| Card open: wheel click within the stillness time, while a step runs, with no button focused or with focus moved | Nothing pressed; nothing typed; wheel LEDs flash red |
| Card open: wheel click without a wheel step to the focused button (a Codex card opening with approve focused, focus moved by the mouse, or a new card) | Nothing pressed (`card-nothing-chosen`); nothing typed; wheel LEDs flash red. A clamped step on such a Codex card (one clockwise step with approve, the last stop, focused) chooses nothing either; a step away and back chooses approve |
| A card replaced by another with the same buttons | Assumed: the new card has a new runtime ID, so the earlier choice does not apply; the installed check below confirms it for a multi-question Claude card |
| Codex view without a composer and without exactly one selected sidebar row, without exactly one on-screen group holding a text element and two actionable buttons, or with more than 512 groups (a very long thread) | Card state unknown: the wheel does nothing. That settings pages and dialogs fall here is unverified; the installed check below confirms it |
| Codex card with focus on the sidebar row or another button outside its stops | Still a card, with no stop focused; one clockwise step focuses Deny |
| Codex card shown with no element focused (installed check 4, 2026-10-05) | Found by structure: one clockwise step focuses Deny (the first stop), one counter-clockwise step focuses approve (the last); a still click presses the stop reached |
| Codex thread view without a composer with exactly one on-screen group holding text and two or more actionable buttons that is not a card | Narrowed residual: treated as a card; a press still needs a deliberate wheel step and a still click |
| Scroll, then a card opens | Earlier scroll counts never shorten the first card step |
| Card open: still wheel click on a focused button | That one button pressed through UI Automation, never retried; no Enter |
| Card state or Codex card container unknown | Wheel does nothing: no scroll, step, press or Enter |
| Duplicate or repeated Send click (wheel or Play), or card press; Send outcome uncertain | One Enter or press at most; no retry |
| Disconnect during Record hold | Modifiers released; no draft sent |
| Reconnect or bridge restart | No replay; slots retained; each control acts on a fresh press, evaluated at that press |
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

## Installed checks for #821

With harmless cards in throwaway tasks, after the bridge with #821 is installed:

1. Open Codex settings, and a Codex confirmation dialog if one is at hand, and confirm that the wheel does nothing
   there and the bridge logs `card-unknown` (`cardButtons` reads unknown).
2. Answer a multi-question Claude question card with the wheel. After the card moves to its next question, click
   the wheel without turning it and confirm that nothing is pressed (`card-nothing-chosen`); then step and press.
3. On a Codex approval card, check both starting states. If Codex focused approve, one clockwise step (clamped) and
   a still click press nothing; one counter-clockwise step to Deny and one clockwise step back, then a still click,
   press approve once. If nothing has focus (as in installed check 4 on 2026-10-05, when the wheel was inert
   before the structural rule), one clockwise step focuses Deny and one counter-clockwise step focuses approve, and
   a still click presses the stop reached. Without a turn, a click presses nothing and the wheel LEDs flash red.
4. Click into a task with the mouse and send with Play; pick a Claude question option and a permission option
   with the wheel; confirm that a light wheel touch while clicking does not change the option.
5. On a Claude question card, confirm that the wheel steps through the option rows and "Other" only, never the
   header or footer buttons, and that a still click right after a step presses the option reached (the 2026-10-05
   live check found every click refused while Claude applied focus late). On a permission card, confirm that the
   wheel steps through all its answers.
6. In a long Codex thread (many messages), open a harmless approval card and confirm the wheel still steps and
   presses. More than 512 `Group` elements makes the card read unknown (`card-too-many-groups`) and the wheel inert;
   if that happens, record the thread length so the bound can be revisited.

## Installed checks for #822

After the bridge with task pages is installed, with more than 15 open throwaway tasks:

1. Confirm that tasks beyond the first 15 get keys on page 2 and later, and that no `overflow` is logged until every
   page is full.
2. Turn knob 4 lightly and confirm that nothing changes; turn it one deliberate step and confirm that the keys show
   page 2 and knob 4's LED changes to page 2's color. Confirm that paging opens and types nothing.
3. On page 2, press a task's key and confirm that the bridge opens that task (slot 16 or later).
4. While page 2 is visible, let a task on page 1 raise attention, and confirm that knob 4's LED alternates with the
   attention color without switching pages. Then let a task on page 1 finish unread (no attention) and confirm that
   the LED stays steady: only attention shows on the indicator (owner decision on #822, 2026-10-05).
5. Hold a Claude task's key on page 1, turn knob 4 to page 2 during the hold, press Loop, and confirm that the page-1
   task is the one released.
6. Restart the bridge and confirm that every task keeps its key and page, and that the keys show page 1.

## Installed checks for #865

These belong to #745's batched installation. After the bridge with the Attention click on knob 4 and the volume knob is installed,
with more than 15 open throwaway tasks:

1. Turn the volume knob slowly both ways and confirm that the Windows volume moves one step (2 points) per count and
   that the step size feels right. If not, set `volume.stepCounts` (and `volume.invert` if the direction is wrong) in
   the profile and record the value.
2. Click the volume knob twice and confirm that Windows mutes and then unmutes. With Codex and then Claude in front,
   each with a draft in its composer, confirm that neither the turns nor the clicks change the draft, send, move focus
   or trigger anything in the client. A volume key enters the foreground thread's input stream, so only this check
   shows that the clients ignore it.
3. Hold Record, turn and click the volume knob, and confirm that the volume does not change, the volume knob's LED
   flashes red and dictation keeps going; release Record and confirm that Wispr still inserts the dictation.
4. With no task waiting, click knob 4 and confirm that its LED flashes red, then shows the page color again, and that
   nothing opens.
5. Let a throwaway task on page 2 raise attention, then one on page 1. Confirm that knob 4's LED alternates with the
   attention color and that no black key lights. With page 1 visible, click knob 4 and confirm that the page-2 task
   opens and the keys show page 2. Click again within 4 s and confirm that the page-1 task opens and the keys show
   page 1.
6. Confirm that the attention stays on both tasks after they open (the click acknowledged nothing), and that knob 4's
   LED shows the page color steadily once both are answered.

## Installed checks for #906

These belong to #745's batched installation. Run them after the bridge with the model and effort knobs is installed,
in throwaway tasks, with Claude Desktop and Codex Desktop at the qualified versions. The profile should name the
owner's Codex effort chords for checks 4 and 6.

1. **Read-only picker read.** Run the native check (`test:chompi-bridge:native:built`) with Claude's model menu,
   then its Effort slider, then Codex's picker open by mouse. Record its `claudePicker` and `codexPicker` shapes:
   - the qualified menu kind;
   - the expandable buttons;
   - the slider range;
   - for Codex, that exactly one picker button is found and not `codex-picker-button-ambiguous`.

   These confirm the `pickerState` selectors in
   [UIA-NOTES.md](../apps/chompi-bridge/src/windows/UIA-NOTES.md#model-and-effort-controls).
2. **Claude model.** With a Claude task in front, turn knob 1 one slow detent at a time.
   - The first detent opens the model menu with the current model highlighted.
   - Each further detent moves one model, "More models" is never reached, and a light touch moves nothing.
   - If a detent moves more or less than one entry, set `model.stepCounts` (and `model.invert` if the direction is
     wrong) and record the value; do the same for knob 2 with `effort.stepCounts`.
   - Stop on another model and click knob 1. The model changes, the menu closes, the composer has focus with any
     draft unsent, and Play then sends. The bridge logs `model` `applied` with `button-and-record`.
3. **Claude effort.**
   - Turn knob 2 one detent each way. The level changes at once, the bridge logs `effort` `applied`, and knob 2
     flashes the applied color.
   - Turn up past the top: one `at-limit`, one red flash, and the knob reacts at once when turned back (no queued
     detents).
   - Leave it: the slider closes after about 5 s and the composer has focus.
   - Select Haiku 4.5: knob 2 reports `unsupported`.
4. **Codex model.** With a Codex task in front, turn knob 1. The picker and model list open on the current model.
   - A still click applies the focused model, the picker closes with a single Escape, and the bridge logs `model`
     `applied` with `picker-name`.
   - Turn knob 1 again and leave the list: the current model is invoked, which returns to the picker (observed
     2026-10-07), the picker closes with one Escape, and nothing changes.
   - Pick "Default" once and record what the bridge logs (`unverified` is expected).
5. **Codex effort with chords.** Turn knob 2.
   - Each detent changes the picker button's level with the picker never opening, and the bridge logs `effort`
     `applied` through `chord`.
   - At the top it logs `mismatch` (`unchanged`) once and drops the rest.
   - With Claude in front, knob 2 drives Claude's slider and no pane ever splits.
6. **Codex effort without chords.** Remove the chords from the profile and turn knob 2.
   - The picker opens on Power and each detent steps the level as announced.
   - At the top nothing is sent (`at-limit`).
   - Knob 2's click closes the picker with one Escape.
7. **Other controls.** Open each knob's control, then press Play with a draft. The control closes first (Collapse and
   composer focus for Claude, one Escape for Codex) and Send submits the draft unchanged. Repeat with Record and with
   a slot key.
8. **Refusals.** With a harmless card open, and then with another app in front, turn both knobs: each gives a red
   flash and nothing happens in any window.

## Installed checks for #907

These belong to #745's batched installation. Run them after the bridge with the next-step knob is installed, with
Claude Desktop at the qualified version and the `next-steps` mod enabled, in a throwaway task after a turn long enough
for the band to show.

1. **Read-only band read.** With the band showing, run the native check (`test:chompi-bridge:native:built`) and
   record its `claudeSuggestions` shape: the suggestion count, the focused suggestion (-1), the `level` of the composer
   ancestor the band was found under (1 for the layout observed on 2026-10-07), and `composerFocused` and `composerEmpty` (true with an empty composer). Repeat
   with a draft typed (`composerEmpty` false) and after sending a message (`suggestions` 0). A refusal such as
   `suggestion-band-unqualified` or `suggestion-band-ambiguous` is evidence for
   [UIA-NOTES.md](../apps/chompi-bridge/src/windows/UIA-NOTES.md#next-step-suggestions), not a pass.
2. **Highlight.** Turn knob 3 one slow detent at a time.
   - The first detent highlights the first suggestion with Claude's own focus ring, and knob 3's LED shows `active`.
   - Each further detent moves one suggestion, "dismiss" is never reached, and a light touch moves nothing. If a
     detent moves more or less than one suggestion, set `nextSteps.stepCounts` (and `nextSteps.invert` if the direction
     is wrong) and record the value.
   - Leave it: after about 5 s the highlight drops and the composer has focus (caret visible).
3. **Pick.** Highlight the second suggestion and click knob 3 after holding it still.
   - The suggestion appears in the composer as a draft, nothing is sent, the composer has focus, and knob 3 flashes
     the applied color. The bridge logs `next-step` `filled` with route `suggestion`, index and count, and no text.
   - Record where Claude leaves focus right after the `Invoke` (before the bridge returns it to the composer), and
     whether the band stays.
   - Press Play: the draft is sent, and the band hides.
4. **Ghost text.** With a suggestion showing as ghost text in the empty composer and nothing highlighted, click knob
   3. The ghost text becomes the draft, nothing is sent, and the bridge logs `next-step` `filled` with route `ghost`.
   With no ghost text showing (for example right after sending), a click logs `unverified` (`composer-empty`) and
   changes nothing.
5. **Refusals.** Each gives a red knob 3 flash and no input: Codex in front (`codex-no-next-steps`), a draft in
   Claude's composer (turn and click), a harmless card open, no band (turn), and the model menu open by mouse.
6. **Other controls.** Highlight a suggestion, then hold Record and dictate a few words: the highlight drops to the
   composer first, so the dictation lands there. Highlight again and press a slot key or turn knob 1: each drops the
   highlight to the composer before it acts.

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
  their installed check: the 2026-10-06 qualifications on #906 recorded Claude's
  model menu and Effort slider and Codex's picker with their UI Automation
  patterns, and readback for both clients, including Codex's picker button
  name. The owner bound Codex's effort chords, which knob 2 uses first, with
  Codex in front only.
  [#906](https://github.com/jimmie-potts/agent-device-hub/issues/906) delivers
  the knobs from source; #745 runs the installed checks for #906 above. The
  2026-10-06 qualification on #907 recorded Claude's next-step band and its
  ghost text; [#907](https://github.com/jimmie-potts/agent-device-hub/issues/907)
  delivers knob 3 from source, and #745 runs the installed checks for #907
  above.

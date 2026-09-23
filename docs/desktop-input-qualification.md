# N30 Codex qualification

Work source: [Hub #64](https://github.com/jimmie-potts/agent-device-hub/issues/64).
Evidence collected September 22–23, 2026 UTC.

**The owner passed the brief Windows trial for all four Codex actions, ordinary
input outside Codex, and restoration after stopping.** The selected route uses
existing N30 outputs and portable AutoHotkey 2.0.28, scoped to the running Codex
application. The owner accepted that other keyboards' PageUp/PageDown and other
mice's Back/Forward share those mappings while Codex is active. Receiver-specific
filtering is not part of this personal-project route.

The photographed mouse is N30 model 85CA, using its 2.4 GHz receiver, associated
by operator inventory with `VID_062A&PID_4101`. The reported Codex package is
`OpenAI.Codex` version `26.917.6896.0`. This is a positive bounded qualification,
not delivery or installation of the reusable mapper. Those stages remain with
[Hub #65](https://github.com/jimmie-potts/agent-device-hub/issues/65) and
[Hub #66](https://github.com/jimmie-potts/agent-device-hub/issues/66).

The owner selected 2.4 GHz receivers and subsequently reported that both devices
are connected and working. The large A/B accessory is plugged into the keyboard.
The receiver comparison below adds operator-observed Windows inventory for the
N30. The photos identify packaging and do not establish firmware. Private photos stay outside Git.

The owner now keeps keyboard A/B and the attached Super Buttons outside
B.U.N.N.Y. Their preferred personal assignments remain B=Wispr Ctrl+Win and
A=Enter on a separate press, programmed directly on the keyboard. This
supersedes the earlier requirement for version 1 A/B editing and removes A/B
from #65, #66, #70 and preset bindings. The completed trial below is historical
evidence; it creates no further B.U.N.N.Y. keyboard acceptance gate.

## Evidence and inventory

`D` means official documentation, `S` inspected source or filesystem artifact,
`O` owner report, and `L` an authorized live observation. These evidence classes
are independent. A supported result under `D` never implies an `L` pass.

| Item | Evidence on the collection date | Remaining qualification |
| --- | --- | --- |
| Keyboard and Dual Super Buttons | O: packaging identifies Retro Mechanical Keyboard N Edition, model 85HA, with N Edition Dual Super Buttons; owner reports working keyboard and connected accessory. L via O: mapped A Enter pair and B Ctrl+Win hold/release | Outside B.U.N.N.Y.; no further keyboard qualification required |
| Mouse | O: packaging reads 85CA, 2.4G, 1000 DPI and AA battery; design matches N30; owner reports basic operation. L via O: four distinct browser outputs below | Brief Codex action trial passed below; firmware, per-device event attribution and controlled hold timing remain unverified |
| N30 receiver identity | L via O: `VID_062A&PID_4101` disappeared from present mouse-class inventory when the operator removed the N30 receiver; normal operation returned after reconnect | Interface/usage and native D-pad event attribution remain unverified; omit serials and instance paths from shared evidence |
| Ultimate Software V2 | D: keyboard support is documented; N30 custom mapping support is not established | Keyboard configuration is outside scope; do not apply R8 capabilities to N30 |
| Wispr | O: current push-to-talk setting is Ctrl+Win. S: local directories named `app-1.6.872`, `app-1.6.886`, `app-1.6.897` exist | Historical personal trial passed below; directory names do not identify the active installation; no further Wispr acceptance gate |
| Codex | O: current-user package `OpenAI.Codex`, version `26.917.6896.0`; D: Windows defaults below | Trial resolved the running window executable within that installed package and the owner reported action/focus checks passed; no executable path or custom settings retained |
| CHOMPI bridge | S: local C# source inspected; no Git commit exists in that checkout | Installed binary revision and coexistence; no bridge was launched or changed |
| Live input/application results | L via O: focused N30/Super Buttons events, successful brief Wispr/Notepad trial and mapping restoration | Codex routing and stop/restoration passed in the later trial; per-device attribution and long-term recovery remain unqualified |

The WSL-to-Windows inventory failed with `UtilBindVsockAnyPort:307` both in the
normal context and after an approved sandbox escalation. The native Node tool
also failed before execution because of `sandboxCwd`. The mounted Windows app
package directory denied access. These are inventory gaps, not evidence that
hardware or software is absent. The later N30 and Super Buttons checks used
focused browser listeners. The owner performed separately authorized temporary
A/B fast mappings. At that stage no system-wide listener, adapter injection or service change
ran. The later authorized AutoHotkey trial below temporarily translated the four
selected signals. The owner supplied the selected Windows inventory values below.
Application and restoration results are recorded separately.

## Operator receiver and package inventory

On September 23, 2026 UTC, the owner ran a read-only PowerShell inventory of
present mouse-class devices, returning only VID/PID pairs. The owner then removed
the identified N30 receiver and repeated the command. Only `VID_062A&PID_4101`
disappeared. After reconnecting it, the owner confirmed mouse movement and clicks
worked again. This associates that pair with the operator-selected N30 receiver;
it does not establish its HID interfaces or attribute D-pad events to a native
Raw Input device. Other peripheral IDs stay outside this report.

The owner's `Get-AppxPackage '*Codex*' | Select-Object Name, Version` output
reported `OpenAI.Codex` version `26.917.6896.0`. That is installed package
metadata, not verification of the running process, customized shortcuts or
foreground dispatch. These inventory commands changed no mappings and observed
no keystrokes. Receiver reconnection/restoration is complete; no trial remains
active.

## Authorized N30 browser observations

The owner authorized the prepared local page with "Run the N30 input check".
It observes allowlisted navigation/modifier keys, mouse-button numbers and wheel
direction only while armed and focused. Each direction has a 15-second deadline
and a 20-event cap. It changes no mappings, has no microphone or network access,
and retains results only in page memory until the owner copies them.

The owner first ran the check inside Codex and confirmed that the pointer stayed
inside the observation box for Left and Right. After those directions produced
no allowed events, the owner supplied the requested repeat from a separate
Windows browser. Its name and version were not supplied.

| Physical direction | Codex preview observation | Separate Windows browser observation | Finding and limit |
| --- | --- | --- | --- |
| Up | `PageUp`: 10 initial downs, one repeated down and 9 ups; 20-event cap | Not repeated | A PageUp down/up path and a repeat were observed. Recording ended on a down, so its missing corresponding up does not establish a stuck control. |
| Down | `PageDown`: 10 down/up pairs; 20-event cap | Not repeated | PageDown down/up observed; no controlled hold trial. |
| Left | No allowed event in 15 seconds | Mouse button `3`: 10 down/up pairs; 20-event cap | Distinct browser button events observed outside the preview. |
| Right | No allowed event in 15 seconds | Mouse button `4`: 10 down/up pairs; 20-event cap | Distinct browser button events observed outside the preview. |

The repeated taps reached the recorder's limit, so retain its incomplete status.
They establish event presence without qualifying a timed hold or recovery. The
preview and separate-browser difference does not identify the interception
mechanism. Missing preview events are not an unsupported-control finding.

Physical direction and device attribution come from the operator. Browser events
do not establish VID/PID, receiver identity, Windows raw codes, selective
suppression or Codex action dispatch. The observer cannot distinguish the N30's
PageUp/PageDown from those keys on another keyboard. Separate local Chromium
checks exercised its focus, privacy, timeout and event-cap behavior with simulated
inputs; those checks are not physical acceptance.

Observer SHA-256:
`abde4df3317554401224df2a22d1c61179e58e0d1c98f8ab6905b2e7504d92df`.
The temporary page and raw owner traces remain outside Git. The
[issue receipt](https://github.com/jimmie-potts/agent-device-hub/issues/64#issuecomment-5770483024)
records the dated result and remaining qualification.

## Capability matrix

`Supported` and `Unsupported` below apply only to the cited product family or
API. `Unknown` means the available evidence does not establish that cell.
The browser observations above are partial input evidence. The later temporary
application route passed its brief owner trial; persistent installation remains
separate.

| Capability | USB cable | 2.4 GHz receiver | Bluetooth | Source and limit |
| --- | --- | --- | --- | --- |
| N Edition keyboard connection | Supported D/O | Supported D/O | Supported D/O | [Keyboard product page][keyboard] and owner packaging |
| N30 mouse connection | Unsupported D as a mouse-to-PC cable mode | Supported D/O | Unsupported D | [N30 product page][mouse] lists its receiver connection; the USB receiver is not a wired mouse mode |
| Keyboard fast mapping at its control panel | Mode-specific behavior unknown | Mode-specific behavior unknown | Mode-specific behavior unknown | [Keyboard manual][keyboard-manual], English page 05 documents on-device chord assignment without host software; it does not qualify each transport's held output or retention |
| Keyboard Ultimate Software configuration by mode | Unknown | Unknown | Unknown | Family support is documented; mode-specific editing not established |
| N30 vendor custom mapping | Not applicable | Unknown; no supported configuration route found | Not applicable | [N30 manual][mouse-manual] documents its existing controls, not custom mapping |
| Mapping retention after closing software or reconnecting | Unknown for keyboard | Unknown | Unknown for keyboard | Keyboard persistence is outside scope; trial hotkeys stop on exit; persistent mapper setup remains separate |

The keyboard page documents programmable keyboard A/B keys and Dual Super
Buttons. Its manual permits up to six simultaneous keys through fast mapping,
with individual cancellation. That documents chord assignment, not proof that
the chord remains down for the physical hold. [Keyboard][keyboard],
[keyboard manual, English page 05][keyboard-manual]

The N30 manual labels A/B as ordinary left/right click, C as touch scrolling,
and D/E/F/G as Page Up, Back, Page Down and Forward on its side D-pad. Those are
four existing navigation controls, not R8 programmable side buttons. The browser
observations and later Windows trial establish the selected translation below. Neither the manual
nor the product page establishes N30 vendor custom profiles. [N30 manual][mouse-manual]

| Physical control | Documented assignment/default | USB event/hold/release | 2.4 GHz event/hold/release | Bluetooth event/hold/release | Qualification disposition |
| --- | --- | --- | --- | --- | --- |
| Attached Big A | Programmable D | Unknown | L via O: Enter down/up, 144 ms, no repeat; receiver attribution unknown | Unknown | Personal keyboard setup observed and cleared; excluded from B.U.N.N.Y. |
| Attached Big B | Programmable D | Unknown | L via O: Ctrl+Win down/up, 1,758 ms overlap, 50+ repeats; receiver attribution unknown | Unknown | Personal keyboard setup observed and cleared; excluded from B.U.N.N.Y. |
| Keyboard A | Programmable D | Unknown | Unknown | Unknown | Keyboard-owned; outside B.U.N.N.Y. |
| Keyboard B | Programmable D | Unknown | Unknown | Unknown | Keyboard-owned; outside B.U.N.N.Y. |
| Other typing/function keys | Exact remappable set unknown | Unknown | Unknown | Unknown | Preserve typing; wider keyboard inventory is outside this qualification |
| Ctrl, Win, Alt, Shift | Manual permits fast key swap D | Unknown | Unknown | Unknown | Preserve current modifier layout |
| Volume knob | Reassignment unknown | Unknown | Unknown | Unknown | Preserve normal function |
| Connection selector | Reassignment unknown | Unknown | Unknown | Unknown | Preserve connection function |
| Pair button | Reassignment unknown | Unknown | Unknown | Unknown | Preserve pairing function |
| Fast-mapping button | Setup/cancellation D; reassignment unknown | Unknown | Unknown | Unknown | Preserve configuration function |
| Profile button | Configuration function; reassignment unknown | Unknown | Unknown | Unknown | Vendor profile is not a hub desk preset |
| N30 D-pad D | Page Up D; custom mapping unknown | Unsupported transport | L via O: browser `PageUp` down/up and one repeat; receiver attribution and controlled hold unknown | Unsupported transport | Shared PageUp trigger; next-attention action passed in the owner trial |
| N30 D-pad E | Back D; custom mapping unknown | Unsupported transport | L via O: browser button `3` down/up; receiver attribution and controlled hold unknown | Unsupported transport | Shared Back/XButton1 trigger; previous action passed in Codex |
| N30 D-pad F | Page Down D; custom mapping unknown | Unsupported transport | L via O: browser `PageDown` down/up; receiver attribution and controlled hold unknown | Unsupported transport | Shared PageDown trigger; command menu passed in the owner trial |
| N30 D-pad G | Forward D; custom mapping unknown | Unsupported transport | L via O: browser button `4` down/up; receiver attribution and controlled hold unknown | Unsupported transport | Shared Forward/XButton2 trigger; next action and outside-Codex behavior passed |
| N30 A/B | Ordinary left/right click D | Unsupported transport | Unknown | Unsupported transport | Preserve clicks; these are not the keyboard's Big A/B |
| N30 C | Touch scrolling D | Unsupported transport | Unknown | Unsupported transport | Preserve scrolling; no middle-click claim |
| N30 power control | Power function D; reassignment unknown | Unsupported transport | Unknown | Unsupported transport | Preserve power function |

The keyboard's extension ports are dedicated to its accessories, not audio
inputs; an attached button is not assumed to enumerate as a separate USB
keyboard. [Keyboard FAQ][keyboard-faq]

Windows `RAWMOUSE` defines left, right, middle, `XBUTTON1` and `XBUTTON2`
transitions. The observed browser key codes and button numbers do not establish
those native events or their device identity. Capture only the selected controls
before selecting a native parser. Do not infer raw codes from the manual's
application-action names or browser button numbers. [Microsoft RAWMOUSE][rawmouse]

## Application bindings and ownership

The trial used the documented Windows defaults below, and the owner reported
that all four actions passed in the active Codex view. Saved shortcut settings
were not retained. Previous/next task or tab remains view-dependent; browser
Back/Forward is a different action. Recheck configured bindings if the app
version, settings or intended view changes. [Codex command reference][codex]

| Accepted action | Windows binding used in the trial | Temporary route result |
| --- | --- | --- |
| Next task needing attention | `Ctrl+Alt+A` | Owner-reported pass; saved custom binding not retained |
| Command menu | `Ctrl+Shift+P` | Owner-reported pass; saved custom binding not retained |
| Previous task/tab | `Ctrl+Shift+Tab` | Owner-reported pass; saved custom binding not retained |
| Next task/tab | `Ctrl+Tab` | Owner-reported pass; saved custom binding not retained |

These are the aggregate owner-reported results recorded below, not separate
per-action event traces. The documented command-menu alternative `Ctrl+K` was
not part of the trial.

Wispr documents `Ctrl+Win` for Windows push-to-talk and
`Ctrl+Win+Space` for hands-free mode. A new binding needs a modifier and at most
three keys; eligible mouse buttons may satisfy the modifier requirement.
Bare F13 is therefore not a documented keyboard shortcut choice. Existing
bindings can be retained by adding another shortcut. Reset replaces custom
bindings without undo. Double-tapping push-to-talk can enter hands-free mode.
[Wispr shortcuts][wispr]

The completed personal trial observed dictation insertion without automatic
Enter and a separate deliberate A press. Wispr settings and both keyboard-owned
assignments stay outside the mouse dispatcher. No further Wispr trial is needed
for this delivery.

For the mouse, do not use Wispr's global mouse bindings as a Codex focus router:
its assigned clicks can be suppressed in other apps. `Ctrl+K` is also a reserved
Wispr combination. Do not share candidate triggers with Wispr, existing vendor
mappings, ordinary typing or CHOMPI. [Wispr shortcuts][wispr]

## Selected route and limits

The owner selected the simpler application-scoped shared-key route after the
receiver-specific observer failed early. Keep N30 firmware and vendor outputs
unchanged. One Windows-local mapper owns the four translations while Codex is
active; other applications retain the original inputs. Keyboard PageUp/PageDown
and other mice's Back/Forward also map inside Codex. This disclosed tradeoff
supersedes the earlier requirement for per-device attribution and suppression;
it does not establish those capabilities.

Portable AutoHotkey 2.0.28 supplied the existing supported hotkey mechanism for
the temporary trial. Its `#HotIf WinActive(...)` condition used the full executable
path resolved from one running window within the installed `OpenAI.Codex`
package directory. The launcher rejects absent or ambiguous targets, checks the
pinned runtime hash, and runs `/Validate` before enabling mappings. No installer,
startup registration, hub service, new driver or firmware change was used.
[AutoHotkey release][ahk-release], [application scope][ahk-hotif],
[executable matching][ahk-wintitle], [validation][ahk-scripts]

| Route | Disposition | Evidence and limit |
| --- | --- | --- |
| Existing N30 outputs plus app-scoped AutoHotkey | Selected for the personal Codex route | Owner passed four actions, outside-app behavior and stop/restoration; keys are shared across devices within Codex |
| Receiver-specific Raw Input/hook adapter | Not selected | First observer stopped on a device-change notification before events; a correction was prepared but not run; no per-device qualification claimed |
| N30 vendor mapping alone | No supported custom route established | Manual documents navigation controls; R8 software evidence does not qualify N30 |
| CHOMPI bridge unchanged | Retains its owner and MIDI bindings | Source inspected; concurrent installed operation was not tested |
| Keyboard A/B fast mapping | Personal trial completed and restored; outside B.U.N.N.Y. | No further keyboard integration or acceptance gate |
| Firmware replacement, custom USB protocol or new driver | Outside scope | No such change was made |

The following API/source observations explain the unselected receiver-specific
investigation. They are not requirements of the accepted shared-key route.

[Raw Input][raw-input] can distinguish input devices. That observation API alone
does not prove selective suppression of the foreground application's original
button action. In particular, `RIDEV_NOLEGACY` is scoped to the registered
application. A [low-level mouse hook][mouse-hook] can suppress an event, but its
standard event data does not establish a four-button, per-device solution.
Do not choose a driver or claim that correlating separate event streams is
reliable without qualification. [RAWINPUTDEVICE][raw-device]

[GetForegroundWindow][foreground] can return no foreground window. The local
CHOMPI source resolves that window's process and package family and rechecks
the window before output. Its keyboard output rejects held modifiers, records
partial insertion, and attempts key-up recovery. It sends a complete down/up
sequence per action, so it is not a Wispr hold adapter. The inspected source
hard-codes `OpenAI.Codex_2p2nqsd0c76g0`; that is not current installed-identity
proof. Reuse the approach only after verifying the actual package and view.

Source provenance, local `chompi-codex` working tree, no commit available:

| Inspected source | SHA-256 |
| --- | --- |
| `src/Chompi.Windows/WindowsKeyboard.cs` | `8323024393bc3e7dc07718f42cf36ad07993c462ae73f72143199b792f139da0` |
| `src/Chompi.Core/KeyboardOutput.cs` | `d5c9bc63b89e32f5d230e468be39d6a8a825a859d35ee322b8e8ee239c0ceaef` |

`SendInput` reports inserted events, not application success. Existing held
keys can interfere, and Windows restricts injection by integrity level. A
foreground check and injection are not an atomic target lock. Keep dispatch
receipts separate from observed Codex results; an unknown focus or failed
release must stop dispatch. Do not elevate an input adapter to bypass those
limits. [Microsoft SendInput][sendinput]

## Completed personal keyboard trial

The focused N30 browser observation above has authorization and results. The
owner also approved a bounded A/B trial and confirmed that both buttons were
unmodified beforehand. That trial temporarily mapped B to Ctrl+Win and A to
Enter, observed their browser events with Wispr quit, then used one short Wispr
dictation and a separate Enter press in blank Notepad before restoration. The prepared
observer records only selected modifier/Enter codes,
transitions, overlapping hold duration and bounded repeats; it stops on release,
focus loss or after 15 seconds. It cannot identify the receiver or prove an app
outcome. The later Codex trial has its own authorization and result below. Reconnect,
sleep and coexistence were not part of that brief trial.

The first A/B attempt ran in a separate Windows Edge/Chrome window. Both samples
ended with "Focus left the observation area; observation incomplete" and no
allowed event. B reported zero observed overlap and repeats; A reported zero
repeats. These values describe an empty capture, not the hardware's hold duration.
The owner then confirmed that the keyboard's own Enter key records correctly
and that assignments used the 8BitDo keyboard's keys. After repeating the
documented assignment, the owner reported that the buttons work. A recorded
Enter down/up pair lasted 144 ms, with no repeats and no recorded key left down.
B recorded ControlLeft and MetaLeft down, with 1,307 ms of observed overlap
before the observer stopped at 50 repeated keydowns. That cutoff leaves release
unobserved; it does not establish stuck keys or a complete hold/release result.
The original empty captures remain part of the evidence, and their cause is
unproven.

The revised observer keeps a saturated `50+` repeat count and continues until
release, focus loss, its edge limit or the unchanged 15-second deadline. Its
SHA-256 is `d0e0ec9fbc5e7c0e3b206aa7632a6d3ea9251d5223e8d870de033147c7e98d9e`.
The same regression failed against the first observer's repeat cutoff and
passed after correction, including both release edges. These automated checks
use synthetic Linux Chromium events and do not establish physical behavior.

The owner's repeat with revision 2 recorded ControlLeft and MetaLeft down,
1,758 ms of overlap, then both keys up. It completed with `50+` repeats and no
recorded key remaining down. This is a complete held-chord observation, shorter
than the requested three seconds. It establishes the reported input interval,
not a three-second measurement. In the subsequent approved Notepad trial, the
owner confirmed that B recorded while held, stopped on release and inserted
text without an automatic Enter. A separate A press added one newline. No
dictated text or audio was retained in this report.

The owner then confirmed both temporary assignments cleared through the
manual's per-button cancellation and reopened Wispr. This closes the bounded
trial and its restoration requirement. It does not establish persistence,
reconnect/sleep recovery, CHOMPI coexistence or installed Codex action routing.

## Completed brief Windows trial

The owner accepted the disclosed shared-key approach with "Let's wrap up the
remaining brief tests." After the prepared launcher was corrected, the owner
reported "Everything passed and looks good." This is an aggregate owner report
for the requested sequence; no per-action trace or task content was retained.
No unavailable action or failure was reported.

| Requested check | Translation or expected behavior | Result |
| --- | --- | --- |
| Up in Codex | PageUp → Ctrl+Alt+A, next existing task needing attention | Owner-reported pass |
| Down in Codex | PageDown → Ctrl+Shift+P, command menu | Owner-reported pass |
| Left in Codex | XButton1 → Ctrl+Shift+Tab, previous task/tab | Owner-reported pass |
| Right in Codex | XButton2 → Ctrl+Tab, next task/tab | Owner-reported pass |
| Separate browser | Normal page scrolling and Back/Forward | Owner-reported pass |
| Stop trial | Down no longer opens the Codex command menu | Owner-reported pass; temporary hotkeys removed |

The trial used existing tasks and the main Codex conversation view. Up would be
unavailable without an existing task needing attention; the owner reported no
exception. These results establish only this tested setup, not arbitrary app
versions, views, customized shortcuts or other hardware.

The script uses `KeyWait` with one hotkey thread to avoid repeated dispatch
while held. Key history and line history are disabled. It sends only the four
complete shortcuts, has a Stop trial tray action and a five-minute deadline.
Those are inspected source properties; no controlled physical hold duration or
long-term recovery result is claimed. The foreground check and input dispatch
are not atomic. [KeyWait][ahk-keywait], [key history][ahk-history]

The first launcher expected exactly one manifest executable and stopped before
any mapping ran. The corrected launcher identifies the running window's
executable inside the installed package directory. The actual failing manifest
layout was not collected. Seven Linux PowerShell selection fixtures passed after
reproducing the original error; both independent reviewers approved the fix.
Those checks are separate from the owner's subsequent Windows pass. The earlier
native observer's early stop is retained as an incomplete observation, not an
unsupported-hardware finding.

| Trial artifact | SHA-256 |
| --- | --- |
| Corrected PowerShell launcher | `b3a0f688f5d61f9e789e19a348292631dc0c20d3f06dafb1f129dbda0c310130` |
| AutoHotkey mapping script | `349dcf9270fb9a0d22fdbe39f8c65682e1c7c8526b33d3286fd3188a31e23b9f` |
| Official portable AutoHotkey 2.0.28 executable | `373181727d1ae858564d4daa678f9fa6cf330d1751f8b284a369c79afdb05e98` |

Private launchers, runtime, owner reports and fixtures remain outside Git. No
arbitrary keystrokes, titles, clipboard contents, dictated text or audio were
collected. The completed trial includes stopping and restoration; no persistent
mapper or startup entry was installed. Keyboard A/B and Wispr settings were not
changed by this mouse trial.

## Acceptance and implementation handoff

The owner's September 23 scope decision selects app-scoped shared inputs for a
personal project. The brief live result reduces the route uncertainty; it does
not remove implementation, packaging or recovery checks for the reusable mapper.
The qualification adds no product behavior or contract to this repository, so
it requires no new OpenSpec capability.

| Criterion | Evidence and outcome |
| --- | --- |
| AC1 | Sourced control/connection matrix, distinct browser signals, receiver association and installed package version; unknown firmware and per-device/hold details remain explicit |
| AC2 | Existing AutoHotkey route selected with one Windows-local mapping owner, Codex application scope, disclosed shared-key behavior and a successful stop/restoration trial |
| AC3 | Documentation, inspected source, synthetic fixtures and owner-reported live actions remain separate; failures and aggregate-report limits are retained |
| AC4 | Per-device isolation, persistent startup, reconnect/sleep recovery and CHOMPI coexistence are unqualified; keyboard A/B is excluded by owner decision, not failed hardware support |

The #64 coordinator owns this qualification record. The local-controls owner
operated and accepted the temporary trial. After normal source delivery gates,
#65 can use the selected route without repeating receiver attribution research.
It must disclose that same-key inputs from other devices map inside Codex, retain
ordinary input outside Codex and provide a clear enable/disable path. Its own
issue-linked specification and implementation checks remain required.

[Hub #66](https://github.com/jimmie-potts/agent-device-hub/issues/66) owns the later
persistent installation and its proportionate lifecycle acceptance. The brief
trial is not completion of that issue. The existing CHOMPI bridge retains its
ownership; no coexistence result was obtained. Broader profiles, presets and
other app/hardware versions need their own qualified capabilities. Keyboard A/B
and attached Super Buttons remain outside all B.U.N.N.Y. mapping and preset work.

Reassess this dated result when the model, transport, application shortcuts,
application version or requested isolation changes.

[keyboard]: https://www.8bitdo.com/retro-mechanical-keyboard/
[keyboard-faq]: https://support.8bitdo.com/faq/retro-mechanical-keyboard.html
[mouse]: https://www.8bitdo.com/n30-wireless-mouse/
[mouse-manual]: https://download.8bitdo.com/Manual/Other/N30-Mouse/N30_Mouse_Manual.pdf?20220513=
[keyboard-manual]: https://download.8bitdo.com/Manual/PC-Peripherals/Retro-Mechanical-Keyboard-8.pdf
[wispr]: https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts
[codex]: https://learn.chatgpt.com/docs/reference/commands#keyboard-shortcuts
[raw-input]: https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input
[rawmouse]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawmouse
[raw-device]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice
[mouse-hook]: https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc
[foreground]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
[sendinput]: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput

[ahk-release]: https://github.com/AutoHotkey/AutoHotkey/releases/tag/v2.0.28
[ahk-hotif]: https://github.com/AutoHotkey/AutoHotkeyDocs/blob/v2/docs/lib/_HotIf.htm
[ahk-wintitle]: https://github.com/AutoHotkey/AutoHotkeyDocs/blob/v2/docs/misc/WinTitle.htm
[ahk-scripts]: https://github.com/AutoHotkey/AutoHotkeyDocs/blob/v2/docs/Scripts.htm#validate
[ahk-keywait]: https://github.com/AutoHotkey/AutoHotkeyDocs/blob/v2/docs/lib/KeyWait.htm
[ahk-history]: https://github.com/AutoHotkey/AutoHotkeyDocs/blob/v2/docs/lib/KeyHistory.htm

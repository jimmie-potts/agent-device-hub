# N30 mouse qualification and completed keyboard trial

Work source: [Hub #64](https://github.com/jimmie-potts/agent-device-hub/issues/64).
Evidence collected September 22, 2026 UTC.

The source investigation identifies supported interfaces and a bounded trial
plan for the [accepted desktop controls](desktop-controls.md).
**Route qualification remains incomplete.** Owner photographs
identify the N Edition keyboard, model 85HA, and mouse model 85CA. The latter
matches the N30, not the earlier R8 candidate. An authorized browser check now
associates its four D-pad directions with distinct events. A separate authorized
trial records Big A as Enter and Big B as a held Ctrl+Win chord with both keys
released. The owner also passed the brief Wispr/Notepad trial and cleared both
temporary assignments. Receiver identities and the N30 mapping route remain unknown.
This report does not complete #64 or make
[Hub #65](https://github.com/jimmie-potts/agent-device-hub/issues/65) ready.

The owner selected 2.4 GHz receivers and subsequently reported that both devices
are connected and working. The large A/B accessory is plugged into the keyboard.
These are owner reports of basic operation and attachment; no receiver inventory
independently verifies the active transport. The photos identify packaging and
do not establish firmware. Private photos stay outside Git.

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
| Mouse | O: packaging reads 85CA, 2.4G, 1000 DPI and AA battery; design matches N30; owner reports basic operation. L via O: four distinct browser outputs below | Receiver identity, firmware, raw Windows events and controlled hold behavior |
| USB/HID identities | No inventory result | Record VID/PID, interface/usage and connection under operator supervision; omit serials and instance paths from shared evidence |
| Ultimate Software V2 | D: keyboard support is documented; N30 custom mapping support is not established | Keyboard configuration is outside scope; do not apply R8 capabilities to N30 |
| Wispr | O: current push-to-talk setting is Ctrl+Win. S: local directories named `app-1.6.872`, `app-1.6.886`, `app-1.6.897` exist | Historical personal trial passed below; directory names do not identify the active installation; no further Wispr acceptance gate |
| Codex | D: current Windows defaults below | Installed version, customized bindings, package identity and foreground behavior |
| CHOMPI bridge | S: local C# source inspected; no Git commit exists in that checkout | Installed binary revision and coexistence; no bridge was launched or changed |
| Live input/application results | L via O: focused N30/Super Buttons events, successful brief Wispr/Notepad trial and mapping restoration | Receiver-attributed events, Codex routing, persistence and recovery |

The WSL-to-Windows inventory failed with `UtilBindVsockAnyPort:307` both in the
normal context and after an approved sandbox escalation. The native Node tool
also failed before execution because of `sandboxCwd`. The mounted Windows app
package directory denied access. These are inventory gaps, not evidence that
hardware or software is absent. The later N30 and Super Buttons checks used
focused browser listeners. The owner performed separately authorized temporary
A/B fast mappings. No system-wide listener, adapter injection or service change
ran. Application and restoration results are recorded separately below.

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
The browser observations above are partial input evidence; no complete
installed input/application route has qualified.

| Capability | USB cable | 2.4 GHz receiver | Bluetooth | Source and limit |
| --- | --- | --- | --- | --- |
| N Edition keyboard connection | Supported D/O | Supported D/O | Supported D/O | [Keyboard product page][keyboard] and owner packaging |
| N30 mouse connection | Unsupported D as a mouse-to-PC cable mode | Supported D/O | Unsupported D | [N30 product page][mouse] lists its receiver connection; the USB receiver is not a wired mouse mode |
| Keyboard fast mapping at its control panel | Mode-specific behavior unknown | Mode-specific behavior unknown | Mode-specific behavior unknown | [Keyboard manual][keyboard-manual], English page 05 documents on-device chord assignment without host software; it does not qualify each transport's held output or retention |
| Keyboard Ultimate Software configuration by mode | Unknown | Unknown | Unknown | Family support is documented; mode-specific editing not established |
| N30 vendor custom mapping | Not applicable | Unknown; no supported configuration route found | Not applicable | [N30 manual][mouse-manual] documents its existing controls, not custom mapping |
| Mapping retention after closing software or reconnecting | Unknown for keyboard | Unknown | Unknown for keyboard | Keyboard persistence is outside scope; N30 adapter configuration remains unqualified |

The keyboard page documents programmable keyboard A/B keys and Dual Super
Buttons. Its manual permits up to six simultaneous keys through fast mapping,
with individual cancellation. That documents chord assignment, not proof that
the chord remains down for the physical hold. [Keyboard][keyboard],
[keyboard manual, English page 05][keyboard-manual]

The N30 manual labels A/B as ordinary left/right click, C as touch scrolling,
and D/E/F/G as Page Up, Back, Page Down and Forward on its side D-pad. Those are
four existing navigation controls, not R8 programmable side buttons. Observe
their actual Windows events before choosing a translation. Neither the manual
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
| N30 D-pad D | Page Up D; custom mapping unknown | Unsupported transport | L via O: browser `PageUp` down/up and one repeat; receiver attribution and controlled hold unknown | Unsupported transport | Candidate trigger; distinguish from the keyboard's Page Up |
| N30 D-pad E | Back D; custom mapping unknown | Unsupported transport | L via O: browser button `3` down/up; receiver attribution and controlled hold unknown | Unsupported transport | Candidate trigger; suppress original navigation only in Codex |
| N30 D-pad F | Page Down D; custom mapping unknown | Unsupported transport | L via O: browser `PageDown` down/up; receiver attribution and controlled hold unknown | Unsupported transport | Candidate trigger; distinguish from the keyboard's Page Down |
| N30 D-pad G | Forward D; custom mapping unknown | Unsupported transport | L via O: browser button `4` down/up; receiver attribution and controlled hold unknown | Unsupported transport | Candidate trigger; preserve original action outside Codex |
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

The four requested Codex actions have these documented Windows defaults. The
installed app can customize shortcuts, so confirm its Settings > Keyboard
Shortcuts before any trial. Previous/next chat or tab must be checked against
the intended task navigation in the active view. Back/forward navigation is a
different command. [Codex command reference][codex]

| Accepted action | Documented Windows binding | Installed result |
| --- | --- | --- |
| Next task needing attention | `Ctrl+Alt+A` | Unknown |
| Command menu | `Ctrl+Shift+P`, alternatively `Ctrl+K` | Unknown |
| Previous task | `Ctrl+Shift+Tab` | Unknown |
| Next task | `Ctrl+Tab` | Unknown |

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

## Route decision and unresolved gates

**Mouse route remains unqualified.** Preserve the N30's existing hardware
outputs and investigate a Windows-local adapter that translates only its four
D-pad controls within Codex. The adapter would own mouse application scope and
action configuration; vendor mappings and the CHOMPI bridge retain their owners.
No supported complete four-action route has been established, so AC2 remains
open and #65 stays blocked.

The documented keyboard fast mapping passed its authorized personal trial.
Keyboard A/B and attached Super Buttons are now outside B.U.N.N.Y., including
its configuration, dispatcher and preset bindings. The earlier proposed A/B
editor and keyboard recovery/persistence gates are superseded.

| Route | Assessment | Evidence needed before adoption |
| --- | --- | --- |
| N30 vendor mapping alone | No supported custom four-action route established by current sources | Model-specific supported interface; R8 software evidence does not qualify N30 |
| Existing N30 outputs plus a Windows adapter | Investigation choice; four distinct browser outputs observed | Receiver-attributed native events, Codex-only suppression, pass-through elsewhere, controlled holds/repeats, recovery, configuration ownership and rollback |
| CHOMPI bridge unchanged | Inspected source offers a focus/output approach; existing MIDI bindings do not handle N30 | Separate input ownership and coexistence; no migration or new bridge bindings here |
| Keyboard A/B fast mapping | Completed personal trial and restoration | None for B.U.N.N.Y.; keyboard-owned and excluded |
| Firmware replacement, custom USB protocol or a new driver | Outside accepted scope | No implementation or experiment proposed |

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
outcome. Broader Codex dispatch, reconnect, sleep and coexistence trials below
still need separately scoped authorization.

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

## Remaining mouse qualification sequence

The local-controls owner operates the devices and observes application results.
The exact hardware, input observer and trial scope must be identified before
authorization. An observer must record only selected control IDs, down/up
transitions, relative timing and pass/fail outcomes. Do not retain arbitrary
keystrokes, window titles, clipboard contents, audio or dictated text.

1. Match the N30 to the photographed 85CA packaging. Read its receiver
   VID/PID/interfaces, firmware if available, and running Codex version without
   changing firmware or pairing. Omit serials and instance paths from shared
   evidence. Keyboard A/B inventory is excluded.
2. Read the active Codex shortcuts and mouse configuration. Identify one mapping
   owner and a reliable rollback path before any change. Do not use factory reset.
3. With dispatch disabled, observe only the selected D-pad direction: a tap,
   controlled hold and release, then repeat for each direction. Compare native
   receiver attribution with ordinary keyboard PageUp/PageDown. No arbitrary
   keystrokes, titles or typed content may be retained.
4. After a supported route is selected and its temporary setup authorized, test
   each Codex action using existing operator-selected tasks, without starting
   sessions. A hold dispatches once; outside Codex, the original mouse action
   passes through. Verify foreground identity, view and shortcut conflicts.
5. In separately approved recovery trials, check reconnect, sleep/resume,
   disabling while held and vendor/CHOMPI coexistence. No stale press may replay.
   A missing release stops dispatch and requires observed recovery.
6. Disable the trial path and restore only changed mouse configuration. Verify
   ordinary typing, clicks and CHOMPI behavior; leave keyboard A/B and Wispr
   settings untouched. Record restoration separately from transport results.

Only the tested model, firmware, connection and app versions can earn a live
pass. Keyboard USB/Bluetooth behavior is outside scope;
the N30 has no documented USB-cable or Bluetooth transport to qualify.
No source change here installs an adapter, registers startup, implements desk
presets, calls the hub/controllers or operates lights/displays.

## Acceptance mapping and handoff

Assessment refreshed against the owner's keyboard-owned A/B decision and Hub
main `bae0b27fff80498281cf45104ca57137340a121f`: medium complexity from Windows
input/focus interfaces; high uncertainty from unqualified N30 translation;
medium impact because trials can affect ordinary input and require restoration.
Documentation work is ready; native mouse qualification remains pending.

| Criterion | Evidence prepared | Remaining completion condition |
| --- | --- | --- |
| AC1 | Sourced control/connection matrix and four distinct N30 browser outputs; keyboard trial retained as history | Native receiver inventory, installed versions and applicable mouse hold/recovery observations |
| AC2 | Compared mouse routes, proposed Windows-local ownership and reversible trial sequence | A supported N30 translation route with selective suppression and ordinary-input preservation |
| AC3 | D/S/O/L evidence classes and dated trials; successful A/B trial/restoration separated from mouse results | Add remaining authorized mouse receipts as trials run |
| AC4 | Explicit unknowns and dependent gates | Final positive or evidenced negative qualification; missing evidence alone is neither support nor rejection |

The #64 coordinator owns physical-to-packaging verification, per-control evidence, final
route selection and the qualification outcome. The local-controls owner owns
permission, operation and observation for live trials. #65 remains blocked on
successful qualification of the controls it exposes. If D-pad controls cannot be distinguished or their original actions cannot be
selectively suppressed, do not enable four actions or silently replace the mapping;
return the capability gap for an owner decision. Unknown hold behavior is not a
negative hardware finding and cannot be called a completed qualification.

[Hub #66](https://github.com/jimmie-potts/agent-device-hub/issues/66) owns the
later installed local-controls acceptance, not a waiver of #64's route evidence.
[Hub #70](https://github.com/jimmie-potts/agent-device-hub/issues/70) can expose
only qualified in-scope controls; keyboard A/B and attached Super Buttons are
excluded even though their manual programming works. The later preset service/binding
work stays with [#67](https://github.com/jimmie-potts/agent-device-hub/issues/67)
and [#68](https://github.com/jimmie-potts/agent-device-hub/issues/68).

The owner photos supersede the R8 assumption and focus the mouse investigation
on N30 D-pad translation. Reassess on new firmware/app versions, a different
connection, conflicting events, persistence results, review findings or changed
scope. This documentation adds no product behavior, contract or installation;
the SDLC therefore requires no new OpenSpec capability for this candidate.

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

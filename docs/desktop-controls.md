# Desktop controls, control profiles and desk presets

Status: Accepted direction from [Hub #63](https://github.com/jimmie-potts/agent-device-hub/issues/63),
revised by the owner during [Hub #64](https://github.com/jimmie-potts/agent-device-hub/issues/64)
on September 22, 2026 UTC.
The 8BitDo input integration, profile editor and desk-preset service remain future
work. This document records decisions and qualification boundaries; it does not
establish installed mappings or device support.

The [future-work guide #35](https://github.com/jimmie-potts/agent-device-hub/issues/35)
tracks the linked backlog; each issue's blocked-by links give its required and
conditional prerequisites. Preserve the Codex-first priority in
[ADR 0004](decisions/0004-local-first-personal-assistant.md) while allowing the
independent Codex mouse path to ship earlier.

## Accepted defaults and keyboard ownership

Keyboard A/B and the attached Dual Super Buttons are programmed directly on the
keyboard. B.U.N.N.Y. does not discover, store, edit, dispatch or restore their
assignments, and cannot use them as preset bindings. This owner decision
supersedes the earlier version 1 A/B editor requirement and excludes these
controls from the later #70 editor.

The owner's preferred personal setup is **B = Wispr Ctrl+Win hold/release** and
**A = Enter on a separate press**. The authorized keyboard trial succeeded,
including dictation without automatic Enter and a separate A press. Both
temporary assignments were then cleared. These preferences describe personal
keyboard setup, not B.U.N.N.Y. defaults or current installed mappings.

The first supported mouse mapping requests next task needing attention, command
menu, previous task and next task within Codex. Preserve ordinary behavior
outside Codex and on unassigned controls. The N30's physical event identities,
selective suppression and exact installed shortcuts still require qualification.

Mouse dispatch works independently of the hub, shared monitoring, general
controls, Music and model calls. Later preset cycling uses an explicitly
selected qualified control other than keyboard A/B or the attached Super
Buttons. The initial cycle is Work → Free → Quiet → Work; Music follows its
own qualification. A preset action remains unavailable until its service exists,
and presses must not accumulate for later execution.

A manual change in a device's own app remains until the next explicit preset
request. That request applies the next preset to configured, participating,
supported devices through their ownership rules. It cannot bypass an external
owner. Starting the input app, opening a view, selecting a profile or reconnecting
does not apply a preset or replay old presses.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Control profile | A saved mapping of physical controls and gestures to actions, including application scope. Selecting it alone sends no device commands. |
| Button binding | One assignment within a control profile, such as a qualified N30 direction bound to a Codex action. |
| Desk preset | An explicit collection of supported actions on configured participating lights and displays. A binding may request it when the service is available. |

The initial preset meanings are accepted intent. Exact per-device operations,
participation defaults and restoration baselines must be refined in
[#67](https://github.com/jimmie-potts/agent-device-hub/issues/67) within the
[general-control definition #31](https://github.com/jimmie-potts/agent-device-hub/issues/31),
accepted on September 22, 2026 and recorded in
[ADR 0005](decisions/0005-general-device-controls.md). That record defines
general control, status presentation, takeover and restoration; presets reuse
those terms and its mode-independent power/brightness and explicit-restoration
rules.

| Desk preset | Intended result |
| --- | --- |
| Work | Request the configured agent-status presentation. |
| Free | Release agent-driven presentation and return to supported normal scenes or media. |
| Quiet | Retain subdued status information, with reduced brightness and minimal animation where supported. |
| Music, later | Apply qualified playback/presentation actions under the participation, interruption and restoration policy owned by [#40](https://github.com/jimmie-potts/agent-device-hub/issues/40). |

Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media retain their native meanings.
These similarly named desk presets introduce no common device-mode enum or
implicit all-device takeover. The [controller contract](controller-contract.md)
continues to govern supported native commands, request identity, revisions,
generations and result evidence. A selected preset is distinct from each device's
actual state, especially when devices have mixed modes or partial results.

## Ownership and command flow

The hub repository owns the future desktop-control source. Input handling stays
local to Windows, beside the apps receiving the actions, even when the shared
hub runs in Linux/WSL or later on another host. Source packages, runtime,
installation paths, startup behavior and profile storage belong to the owning
implementation issues; this document selects none of them.

The local path resolves a qualified physical control and gesture, checks its
profile and application scope, then dispatches its qualified navigation or
command-menu action to Codex. Keyboard A/B and the attached Super Buttons never
enter this dispatcher. The existing CHOMPI bridge and vendor mappings retain their
ownership. Reuse the bridge's approach only where suitable; its three MIDI
bindings are not an implemented 8BitDo or saved-profile system.

An explicit desk-preset action calls the hub-owned preset service. That service
routes supported operations through the existing authenticated app/controller
services and their queues. One designated writer remains responsible for each
physical device. Neither the input component nor a profile editor opens
controller databases, writes raw device protocols, accepts arbitrary device
destinations or becomes another shared agent-state owner.

Per-device failures remain independent. Report requested preset, queued/sent
commands, failed/partially applied/uncertain results and fresh observations
separately. A slow or unavailable device cannot hold up the other device queues
or make a partial preset look complete. A reconnect reads current state without
replaying input or ambiguous writes. Exact concurrent-request and restart rules
belong in #67's issue-linked specification.

## Supported documentation and remaining qualification

The official references below were checked on September 22, 2026. They describe
published capabilities. The owner's packaging photos identify the N Edition
keyboard 85HA and N30 mouse 85CA. The [qualification report](desktop-input-qualification.md)
records those observations, owner-reported basic operation, the N30's four
distinct browser outputs and the remaining input and application trials.
The operator-associated N30 receiver is `062A:4101`; the installed Codex package
is `26.917.6896.0`. Native D-pad attribution and active settings remain unverified.

| Source | Published fact | Remaining mouse qualification |
| --- | --- | --- |
| [8BitDo N30 manual](https://download.8bitdo.com/Manual/Other/N30-Mouse/N30_Mouse_Manual.pdf?20220513=) | D-pad directions are Page Up, Back, Page Down and Forward; ordinary clicks and touch scrolling remain separate. | Native D-pad events, selective translation and recovery. N30 vendor custom mapping is not established; R8 capabilities do not apply. |
| [Codex command reference](https://learn.chatgpt.com/docs/reference/commands#keyboard-shortcuts) | Lists command menu, previous/next chat or tab and next-chat-needing-attention actions. | Exact installed bindings, foreground detection and behavior outside Codex. |

[#64](https://github.com/jimmie-potts/agent-device-hub/issues/64) owns the bounded
mouse investigation. Its per-control/per-connection matrix separates supported,
unsupported and unknown results. Receiver VID/PID and installed package version
are recorded; it must settle native event attribution, active shortcuts, a
supported mapping route, one configuration owner and
reversible setup. Codex focus, controlled holds/repeats, release recovery,
reconnect, sleep/resume and coexistence need separately authorized evidence.
The completed keyboard trial remains in the report as history; further A/B
integration, configuration and acceptance are outside this backlog.

Use existing supported interfaces. Firmware replacement and custom USB protocol
research are outside the accepted approach. Negative qualification may complete
an investigation but cannot make unsupported downstream behavior ready.

## Delivery sequence

Documentation [#63](https://github.com/jimmie-potts/agent-device-hub/issues/63)
and qualification [#64](https://github.com/jimmie-potts/agent-device-hub/issues/64)
can proceed independently. Successful qualification plus these decisions feed
the local Codex mouse implementation
[#65](https://github.com/jimmie-potts/agent-device-hub/issues/65), followed by
separately authorized installation and app/input acceptance in
[#66](https://github.com/jimmie-potts/agent-device-hub/issues/66).

Shared presets [#67](https://github.com/jimmie-potts/agent-device-hub/issues/67)
wait for the [Codex-first milestone #32](https://github.com/jimmie-potts/agent-device-hub/issues/32)
and #31's general-control definition, as well as the source dependencies linked
from #67. Manual preset dispatch does not require the future automation engine.
The shared preset service and #65 then feed a user-selected preset binding and visible results
in [#68](https://github.com/jimmie-potts/agent-device-hub/issues/68).
[#69](https://github.com/jimmie-potts/agent-device-hub/issues/69) owns installed
switching, manual handoff and restoration acceptance, including the shared
producer setup for full agent-status observations.

Broader saved profiles and customization
[#70](https://github.com/jimmie-potts/agent-device-hub/issues/70) follow #65.
Cover qualified remappable controls with saved profiles, supported app/hub
actions, custom keyboard shortcuts and recoverable defaults. Keyboard A/B and
the attached Super Buttons remain excluded. Unsupported controls stay explicit.
Arbitrary scripts, shell execution,
raw device commands and multi-step macros are outside the first customization
release. Profile lifecycle, held-control changes, atomic saves, migration and
editor placement require refinement there. Optional preset or Music actions do
not gate useful local profile editing.

Music [#71](https://github.com/jimmie-potts/agent-device-hub/issues/71) follows
the initial preset binding, qualified playback and #40's policy. Selected
now-playing displays, song-change lighting or measured-audio effects bring their
own conditional dependencies. Track metadata and decorative animation do not
establish audio measurements. Music does not block the original three presets
or the independent shortcut path.

Tidbyt, LIFX and PC lighting participate only after their own capability and
acceptance work. Missing optional targets do not block a supported Nanoleaf/Pixoo
release. [PC-lighting PR #59](https://github.com/jimmie-potts/agent-device-hub/pull/59)
has merged; its [controller guide](../controllers/pc-lighting/README.md) and
lighting-only scope remain separate. It is not a desktop-control prerequisite.
Varmilo lighting support supplies no keyboard-input integration.

## Evidence and delivery boundaries

| Evidence | What it can establish | What remains separate |
| --- | --- | --- |
| Documentation/source | Accepted decisions, published references, reviewed source and fake-input/controller tests | Installed mappings, app outcomes and physical behavior |
| Installation | Named owner, exact versions/configuration, backups and reversible enable/disable setup | A correct button event or successful device action |
| Hardware/input | Observed press/hold/release events from the identified control and connection | Codex navigation or a device result |
| Application | The intended Codex action and focus behavior | Hub/controller transport or visible-device accuracy |
| Transport | Owning-service receipts, queue outcomes and confirmed transmission where available | Visible lighting/display changes or restoration |
| Visible device/restoration | Observed results and restored baseline for each named participating target | Untested devices, app versions or connection modes |

This documentation delivery adds no product behavior or wire-contract delta, so
it needs no new OpenSpec capability. Future behavior changes need refined
issue-linked specifications, proportionate executable tests and the repository's
independent review, CI and guarded delivery gates. Future product UI candidates
also require human approval under [the SDLC](sdlc.md#ui-approval-scope).

Installation, startup registration, personal mouse configuration,
agent sessions, input injection and device operations each remain subject to
their separately scoped authorization and named owner. Physical work needs the
explicit target identities/IPs and permitted sequence/display replacement.
Record restoration and missing acceptance honestly. Keep private settings,
recordings, dictated/typed content and credentials outside Git and shared
agent-state payloads; inspect only input events needed for the selected controls.

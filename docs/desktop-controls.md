# Desktop controls, control profiles and desk presets

Status: Accepted direction from [Hub #63](https://github.com/jimmie-potts/agent-device-hub/issues/63).
The 8BitDo input integration, profile editor and desk-preset service remain future
work. This document records decisions and qualification boundaries; it does not
establish installed mappings or device support.

The [future-work guide #35](https://github.com/jimmie-potts/agent-device-hub/issues/35)
tracks the linked backlog. The [roadmap](roadmap.md#desktop-controls-and-desk-presets)
lists required and conditional prerequisites. Preserve the Codex-first priority in
[ADR 0004](decisions/0004-local-first-personal-assistant.md) while allowing the
independent Wispr and mouse path to ship earlier.

## Accepted defaults

| Control | Requested behavior | Boundary |
| --- | --- | --- |
| Big A on the Dual Super Buttons | Hold to dictate through Wispr Flow; release to insert text | Message submission remains a separate user action. Genuine press/hold/release support must qualify. |
| Big B on the Dual Super Buttons | Each fresh press cycles Work → Free → Quiet → Work | Available after the shared preset service and binding qualify. Music joins later through its own integrations. |
| First Codex mouse mapping | Next task needing attention, command menu, previous task, next task | Apply within Codex. Preserve ordinary behavior outside Codex and on unassigned controls. Physical button identities and exact shortcuts await qualification. |

Wispr and basic mouse dispatch work independently of the hub, shared monitoring,
general controls, Music and model calls. Wispr retains responsibility for speech
processing and its own availability requirements. Big B remains unavailable until
its service exists; presses must not accumulate for later execution.

A manual change in a device's own app remains until the next explicit preset
request. That request applies the next preset to configured, participating,
supported devices through their ownership rules. It cannot bypass an external
owner. Starting the input app, opening a view, selecting a profile or reconnecting
does not apply a preset or replay old presses.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Control profile | A saved mapping of physical controls and gestures to actions, including application scope. Selecting it alone sends no device commands. |
| Button binding | One assignment within a control profile, such as a qualified Big A hold/release gesture bound to Wispr dictation. |
| Desk preset | An explicit collection of supported actions on configured participating lights and displays. A binding may request it when the service is available. |

The initial preset meanings are accepted intent. Exact per-device operations,
participation defaults and restoration baselines must be refined in
[#67](https://github.com/jimmie-potts/agent-device-hub/issues/67) after the
[general-control definition #31](https://github.com/jimmie-potts/agent-device-hub/issues/31).

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
profile and application scope, then dispatches to the owning app. Wispr receives
its qualified dictation binding. Codex receives its qualified navigation or
command-menu action. The existing CHOMPI bridge and vendor mappings retain their
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
records those observations, the per-control matrix and the remaining input and
application trials. Connected identities and installed settings remain unverified.

| Source | Published fact | Still unverified here |
| --- | --- | --- |
| [8BitDo Retro Mechanical Keyboard](https://www.8bitdo.com/retro-mechanical-keyboard/) | Describes programmable keyboard A/B keys, Dual Super Buttons and wired, 2.4 GHz and Bluetooth connections. | Connected receiver, firmware, attachment and hold/release event behavior. Big A/B in this plan refer to the Super Buttons, not an assumed keyboard mapping. |
| [8BitDo N30 mouse manual](https://download.8bitdo.com/Manual/Other/N30-Mouse/N30_Mouse_Manual.pdf?20220513=) | Labels D-pad directions as Page Up, Back, Page Down and Forward, alongside ordinary clicks and touch scrolling. | Actual Windows event identities, selective translation and recovery. N30 vendor custom mapping is not established; the earlier R8 lead does not describe this mouse. |
| [8BitDo Ultimate Software V2](https://app.8bitdo.com/Ultimate-Software-V2/) | Documents key mapping and device-specific support. | Installed version, exposed controls, mapping storage and whether vendor mapping alone supplies the required gesture and app scope. Macro support does not prove genuine push-to-talk. |
| [Wispr shortcut support](https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts) | Documents customizable push-to-talk shortcuts on Windows and reserved/conflicting combinations. | The installed binding, modifier requirements, collisions, release recovery and insertion behavior in the intended app. |
| [Codex command reference](https://learn.chatgpt.com/docs/reference/commands#keyboard-shortcuts) | Lists command-menu, previous/next chat or tab, and next-chat-needing-attention actions, with platform-specific shortcuts. | Availability and exact bindings in the installed Windows version, foreground detection and behavior outside Codex. |

[#64](https://github.com/jimmie-potts/agent-device-hub/issues/64) owns the bounded
investigation. Its per-control/per-connection matrix must distinguish supported,
unsupported and unknown results. It must settle:

- Hardware and USB/receiver identity, connection mode, installed versions and
  which controls are actually remappable, including keyboard A/B and mouse controls.
- The supported vendor route or smallest Windows adapter, with one mapping owner,
  reversible setup and coexistence with vendor software and CHOMPI.
- True press, hold and release behavior for Wispr, including modifier conflicts,
  cancellation and failed-release recovery. A one-shot macro is insufficient.
- The four Codex actions and app scope, including held-button repeats, focus
  changes, app exit, reconnect and sleep/resume without duplicate or delayed actions.

Use existing supported interfaces. Firmware replacement and custom USB protocol
research are outside the accepted approach. Negative qualification may complete
an investigation but cannot make unsupported downstream behavior ready.

## Delivery sequence

Documentation [#63](https://github.com/jimmie-potts/agent-device-hub/issues/63)
and qualification [#64](https://github.com/jimmie-potts/agent-device-hub/issues/64)
can proceed independently. Successful qualification plus these decisions feed
the local Wispr/Codex implementation
[#65](https://github.com/jimmie-potts/agent-device-hub/issues/65), followed by
separately authorized installation and app/input acceptance in
[#66](https://github.com/jimmie-potts/agent-device-hub/issues/66).

Shared presets [#67](https://github.com/jimmie-potts/agent-device-hub/issues/67)
wait for the [Codex-first milestone #32](https://github.com/jimmie-potts/agent-device-hub/issues/32)
and #31's general-control definition, as well as the source dependencies in the
roadmap. The shared preset service and #65 then feed Big B and visible results
in [#68](https://github.com/jimmie-potts/agent-device-hub/issues/68).
[#69](https://github.com/jimmie-potts/agent-device-hub/issues/69) owns installed
switching, manual handoff and restoration acceptance, including the shared
producer setup for full agent-status observations.

Saved profiles and customization
[#70](https://github.com/jimmie-potts/agent-device-hub/issues/70) follow #65.
Cover every remappable control exposed by the qualified hardware, with saved
profiles, supported app/hub actions, custom keyboard shortcuts and recoverable
defaults. Unsupported controls stay explicit. Arbitrary scripts, shell execution,
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
| Hardware/input | Observed press/hold/release events from the identified control and connection | Wispr insertion, Codex navigation or a device result |
| Application | Observed dictation/insertion without added send, or the intended Codex action and focus behavior | Hub/controller transport or visible-device accuracy |
| Transport | Owning-service receipts, queue outcomes and confirmed transmission where available | Visible lighting/display changes or restoration |
| Visible device/restoration | Observed results and restored baseline for each named participating target | Untested devices, app versions or connection modes |

This documentation delivery adds no product behavior or wire-contract delta, so
it needs no new OpenSpec capability. Future behavior changes need refined
issue-linked specifications, proportionate executable tests and the repository's
independent review, CI and guarded delivery gates. Future product UI candidates
also require human approval under [the SDLC](sdlc.md#ui-approval-scope).

Installation, startup registration, personal configuration, microphone use,
agent sessions, input injection and device operations each remain subject to
their separately scoped authorization and named owner. Physical work needs the
explicit target identities/IPs and permitted sequence/display replacement.
Record restoration and missing acceptance honestly. Keep private settings,
recordings, dictated/typed content and credentials outside Git and shared
agent-state payloads; inspect only input events needed for the selected controls.

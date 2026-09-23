# PC and desk lighting controller

Status: Documentation only. No package, Windows adapter, service or lighting
control is implemented or installed here. [Documentation ticket](https://github.com/jimmie-potts/agent-device-hub/issues/50) owns
this bootstrap; the issues below are skeletons to refine before implementation.

## Accepted scope

Integrate Corsair Dominator Platinum RGB DDR5 memory and supported H150i ELITE
LCD XT lighting, plus Lian Li Strimer lighting and the Varmilo VA108M-RGB keyboard
where compatible. Preserve iCUE, L-Connect 3 and the existing lighting and keyboard
setup. Strimer and keyboard support each have separate qualification and acceptance
gates; neither blocks a verified Corsair release. Keyboard support does not block
Strimer delivery either.

Start the keyboard with whole-keyboard shared agent-status lighting. Per-key
notification regions and separate agent sessions mapped to keys remain deferred.
Qualify existing supported vendor or maintained automation interfaces. If none
exists, document that result and defer integration. Custom USB protocol research,
simulated key shortcuts and firmware replacement are outside the accepted path.

Automatic agent status is the first feature. Consume the shared feed initially
hosted in Pixoo and retain its single state owner. General UI/MCP lighting
controls follow the existing deferred device-control work. Fan speeds, pump
settings, cooler LCD content and wider motherboard/GPU lighting are outside
this feature. An MSI route may be qualified specifically as a Strimer transport.

## Evidence and qualification

The user supplied the tower-lighting screenshots and keyboard model on
September 7, 2026. The table separates application evidence, user identification
and unresolved capabilities. It is not a physical acceptance record. Private
screenshots, device serials, local paths and vendor configuration remain outside Git.

| Candidate | Available evidence | Still to establish |
| --- | --- | --- |
| Dominator Platinum RGB DDR5 | iCUE dashboard names the memory. Historical 2025 logs recorded two CMT32GX5M2X6200C36 modules. | Current model/version, SDK visibility, LED groups and supported control/release. |
| H150i ELITE LCD XT | iCUE dashboard names the cooler and lists fan channels 1-6, pump and coolant temperature. | Actual attached RGB devices and exposed lighting zones. Sensor entries do not establish six connected RGB fans or an LCD API. |
| Strimer Plus Controller | L-Connect 3 v1.6.30 screenshot shows 24-pin and dual 8-pin configurations, effects, channels, speed, brightness and direction. | Exact controller/cable generation, firmware, connections and external API behavior. A preview does not establish visible output. |
| MSI motherboard route | Historical logs identify an MPG B650 EDGE WIFI; Mystic Light software files were present during inspection. | Current board identity, actual Strimer sync wiring and SDK compatibility. Available RGB headers do not prove anything is connected. |
| Varmilo VA108M-RGB | User-supplied model; official Varmilo support page lists a VA108MRGB driver. Read-only Windows inventory returned generic USB HID descriptions. | Exact model/revision and USB/interface identity, supported automation API, whole-board lighting operations, ownership and restoration. Generic HID identity does not establish Varmilo compatibility. |

Windows inventory commands failed during the initial tower investigation. A later
read-only keyboard inventory succeeded but did not identify a Varmilo model.
SDK discovery, live device control and optical output were not tested. Refresh
hardware and software evidence in [#51](https://github.com/jimmie-potts/agent-device-hub/issues/51),
[#52](https://github.com/jimmie-potts/agent-device-hub/issues/52) and
[#60](https://github.com/jimmie-potts/agent-device-hub/issues/60).

For Corsair, qualify the official [iCUE SDK](https://corsairofficial.github.io/cue-sdk/).
It operates through running iCUE and exposes device/LED enumeration and lighting
control. Confirm the installed permissions, versions and per-device release
behavior before claiming compatibility.

For Strimer, investigate an existing supported L-Connect automation interface
if available. The [controller manual](https://lian-li.com/downloads/StrimerL-Connect3-manual.pdf)
also documents synchronization through a motherboard 5V ARGB connection. In
that mode motherboard software owns lighting and L-Connect lighting controls
are unavailable. Verify wiring, supported effects and a reversible handoff;
do not assume independent cable/channel control survives that route.

[OpenRGB's 0.9 device table](https://openrgb.org/devices_0.9.html?search=Strimer)
lists Strimer L Connect and flags direct-animation limitations. This is a
versioned research lead, not a selected dependency or proof of API exposure or
coexistence with L-Connect. Compare existing Home Assistant/MQTT delegation
before custom transport work, as the architecture requires. Broader
[hub #11](https://github.com/jimmie-potts/agent-device-hub/issues/11) research remains
independent. If no qualified route preserves the setup, retain Strimer as
unsupported/pending without switching applications or blocking Corsair.

For Varmilo, the [official driver listing](https://varmilo.cn/394565-394565.html)
is evidence of vendor software, not an automation API. The
[OpenRGB pipeline compatibility data](https://openrgb.org/data/supported_devices_pipeline.csv)
inspected on September 7, 2026 had no Varmilo/VA108 entry. A candidate USB ID from
the Windows inventory also appears there as Anne Pro 2; it does not establish
protocol compatibility and must not select that device profile. Qualification
must establish an existing supported interface for this keyboard. Do not substitute
VIA/QMK support from other Varmilo models, reverse engineering or key emulation.
Keep stock firmware, normal typing, key mappings, macros and lock indicators intact;
lighting control neither captures keystrokes nor owns keyboard input.

## Capabilities and ownership

"PC lighting" is a user-facing group that includes tower lights and an optional
keyboard. The keyboard is a separate configured lighting target. This grouping
introduces no new physical device or shared wire identity. The existing controller
contract owns device identity, capabilities and zones. Bind vendor-discovered devices to configured neutral IDs;
expose cable/LED zones only where the selected interface establishes them.
The keyboard starts as one lighting target, without per-key status allocation.
Keep one designated writer per physical target, including one owner for a
Strimer controller's cable outputs. Vendor interfaces must provide an explicit
control handoff; do not create competing iCUE, MSI, L-Connect or direct USB writers.

The proposed controller lives here with a Windows-local vendor adapter. Use
TypeScript/Node 24 for hub-side services and qualify the smallest required native
helper. Keep the adapter beside the vendor applications even if hub hosting
moves later. Reuse protected, explicitly configured loopback routing. WSL
consumers use an authenticated API, never a mounted live vendor SQLite database.

Use the [common controller contract](../../docs/controller-contract.md) and
[reusable MCP services](../../packages/mcp/README.md). Its command set includes
`scene.activate`, `brightness.set` and `power.set`; expose only supported
lighting operations. Lighting off never means PC power-off, disabling cooling
or disabling the keyboard.
There is no generic color/RGB-frame command in v1. Any additional RGB/channel
operation needs explicit versioned contract or typed application-extension work.
Advanced effect editing remains in the vendor applications.

Each target retains a bounded queue, cancellation and independent failure
reporting. Strimer or keyboard loss cannot stop other targets. Keep desired, sent,
uncertain, externally controlled and fresh observed state separate. A successful
SDK call is not visible-light evidence. Status/manual-control work must settle
brightness, session selection, update limits, quiet/disabled behavior, takeover
and restoration; never overwrite newer manual changes with an old snapshot.

## Issues

GitHub issues own the delivery sequence, prerequisites and acceptance; see the
[open PC lighting issues](https://github.com/jimmie-potts/agent-device-hub/issues?q=is%3Aissue+is%3Aopen+lighting+OR+Strimer+OR+Varmilo+in%3Atitle). They start as placeholders
to refine before implementation.

## Development and evidence

Follow the root [AGENTS.md](../../AGENTS.md), [SDLC](../../docs/sdlc.md),
[development guide](../../docs/development.md) and exact selected issue. The first
behavior change introduces its own OpenSpec artifacts, executable package,
build/type/fake-adapter checks and CI. This documentation bootstrap introduces
no product specification, package, service or installation command.

Source checks use fake SDKs/transports, neutral identities and temporary state.
Installation requires a named Windows owner and explicit authorization for the
selected setup. Physical tests require configured USB/SDK identities or explicit
network targets as applicable, plus permission for the lighting sequence and
any synchronization-mode change. Firmware, wiring and application replacement
remain separately scoped changes. No bootstrap step contacts hardware.

Record source, Windows runtime, real-client, transport and visible results
separately. Verify startup, vendor-app restarts, lock/unlock, sleep/resume,
disconnects, manual override, shutdown/crash and restoration while preserving
cooling, normal typing, key mappings and lock indicators. Confirm typing behavior
with the user without recording typed content. Full live lifecycle evidence uses
[hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8). Unsupported
targets and missing optical evidence remain explicit gaps.

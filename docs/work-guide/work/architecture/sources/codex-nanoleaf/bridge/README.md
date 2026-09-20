# Nanoleaf task lights for Codex

For a fresh Linux installation, use [the Linux setup guide](../docs/linux-install.md). The [Linux runtime specification](../openspec/specs/linux-runtime/spec.md) owns installation and service behavior. Linux uses `nanoleaf mode work`, `nanoleaf mode quiet`, and `nanoleaf mode free`; `nanoleaf map --no-open` prints the map URL. The hooks, CLI, wall map, and controller share Linux state and one on-demand light writer. The task and scene rules below apply to both operating systems.

The legacy Windows tray menu provides Work, Free, and Quiet modes. It starts at Windows
sign-in and remembers the selected mode. The task animation described below is
Work mode. Task tracking continues in every mode.

| Mode | Active indicators | Idle |
| --- | --- | --- |
| Work | 2-second task pulses, status waves, and completion comets at 30% brightness | Remembered scene and original brightness |
| Free | No task lighting; use the Nanoleaf apps for scenes, music, or Screen Mirror | Leave the lights alone |
| Quiet | Steady task colors at 10%, without pulses or outward waves | Remembered scene at 10% |

Entering Free restores the remembered scene and brightness once if the bridge
controls the lights. An already-playing user scene is left playing. After release,
even blocked tasks cannot interrupt it. Free does not launch music or Screen Mirror;
start those in the Nanoleaf apps.

Returning to Work shows current tasks without replaying waves from statuses that
arose while away. Future status changes get their normal wave or completion comet. Modes do not mark
tasks read or discard task assignments. Quiet preserves the scene's original
brightness so it can return when you leave Quiet. If no saved scene is available,
the fallback is steady blue at the mode's brightness. In Project layout, steady
project signature colors can remain on their assigned halves in Free; task
pulsing stops.

A mode change normally appears within two seconds. The tray reports pending
changes and failed light updates; it retries controller failures. Connection text
describes the last update, not continuous connectivity testing. Free deliberately
sends no controller requests after its handoff. "Exit tray only" closes the menu;
the selected mode and hooks continue working. Windows may put the icon in the
hidden-icons area beside the clock. The fixed tray icon uses a green center and blue
Lines matching the wall arrangement. Live status remains in the tooltip and menu.
If the icon file is missing or invalid, the tray uses the Windows information icon.

To add the tray to an existing installation without resetting tasks, run
`install-modes.ps1` from this folder in Windows PowerShell. It backs up the installed
program files and creates Start menu and Startup shortcuts. It preserves trusted
hooks, credentials, scene preferences, and tracked tasks. The tray uses Windows
Forms and the existing bundled Windows Python runtime; no additional packages
are required.

Use the installed `bridge.py mode work`, `bridge.py mode free`, or
`bridge.py mode quiet` to switch from a terminal. `bridge.py status --json` reports
`mode`, `pending`, and a sanitized `error`. `bridge.py tray` opens the tray control.
Legacy Windows-installed WSL entry points forward these commands to Windows. Linux-installed commands use their private Linux state directly.

Preview commands are disabled in Free. Refresh and reset respect the selected
mode. Uninstall requests Free mode and removes the tray shortcuts and hooks.
To roll back, close the tray and stop this installation's worker and map server.
Restore the backed-up program files, then run `setup --refresh`. The older bridge
ignores the extra database tables. Keep the current database if you want to retain
task events received since the upgrade. The backup includes a consistent database
snapshot and copies of the credentials, layout, and scene preference for recovery.


Unused Lines stay blue while task indicators are showing. Each task keeps an assigned Line while it is active or
has an unread completion. That Line stays in the task's status color as its
brightness pulses. In Classic layout, both lighting zones of a physical Line receive the same animation.

| Task state | Its assigned Line |
| --- | --- |
| Working | Pulses between dim and bright green |
| Has an asynchronous question and continues working | Pulses between dim and bright yellow |
| Blocked on input or approval | Pulses between dim and bright red |
| Completed but unread | Queues one completion comet, then pulses blue until Codex marks it read |
| Completed and read, interrupted, or unused while other indicators remain | Steady blue |
| No active, blocked, or unread tasks remain | The remembered scene plays again |

A pulse takes 2 seconds. The first pulse after a working, question, or blocked status change radiates outward
from that task's Line, reaching nearby pieces before distant ones. Afterward,
only its assigned Line pulses. Completion uses the comet described below instead of a blue outward wave.
Every status pulses between 20% and 100% of its
color's brightness. Green, yellow, and red task Lines stay in their assigned hue
between flashes. After an outward wave passes, other Lines return to their own
status color, or steady blue if unused.

Each task has its own pulse start time. Ordinary tool activity and changes in
other tasks do not restart its outward pulse. When outward animations overlap,
red takes priority over yellow, green, and blue. Completed markers no longer stay
green. Task indicators use 30% overall brightness. The remembered brightness
returns with the scene.

## Project signatures and wall map

On Linux, run `nanoleaf map --no-open` and open its printed URL. On Windows,
choose **Open wall map** from the existing launcher. The map draws the saved
physical Lines with faceted Prism crystal tubes, separate colored zones, bright
cores, and diffuse light around the crystal. It uses local system fonts and
updates task state once a second. In Work, each Line carrying a task sends light
from both connectors toward a brief center spark on a shared two-second cycle.
Idle Lines stay steady. Quiet lowers the glow and stops travel; Free dims and
desaturates the wall. The toolbar readout names the mode, Lines, tasks, alerts,
and pending edits.

The tubes meet the flat faces of hexagonal connectors. Opening assembly ejects
tubes from the most-connected hub, rotates the hub with its structure, and then
extends outward. Arriving connectors grow from the Line tips and unfold six
permanent inner-border sections. The finished artwork uses the same components
as the moving structure. **Replay assembly** repeats the two-second sequence.
The **Playback** menu keeps opening and map-entry preferences separately in the
browser. Interaction completes assembly before performing the action. Reduced
motion skips assembly and traveling light, and a geometry change or connection
failure ends assembly immediately. A future view can call
`wallAssembly.play('entry')`, which honors the entry preference. The
[wall assembly specification](../openspec/specs/wall-assembly-animation/spec.md)
owns that behavior. The
[wall Line identification specification](../openspec/specs/wall-line-identification/spec.md)
defines numbered project/task badges, Shared pool identification, selection,
pending labels, and the explicit Locate boundary. After selecting Lines, choose
a project and click **Assign selected**. Choose Shared pool to release a reservation. Project colors
are editable in the left column and are saved immediately.

| Layout | Task placement | Display |
| --- | --- | --- |
| Classic, the upgrade default | Automatic across all Lines | Whole-Line status colors |
| Project | Its project's reserved Lines, then Shared overflow | Project identity on one half and status on the other |

Switch layouts from the map or tray. Mode, layout, colors, reservations, half
choices, map orientation, and animation coverage survive restarts. Classic keeps
your saved project settings for the next time you choose Project.

Each task uses one eligible Line. Valid placements stay in place. Tasks never
borrow another project's reserved Lines. When eligible Lines fill up, extra tasks
appear under **Waiting for a Line** and remain tracked. Reassigning a Line moves
its task to another eligible Line or the waiting list. If the edit would move an
active comet's source, the map shows the pending change and applies it when that
comet finishes. Several edits made during a comet are combined.

In Project layout, an unused reserved Line keeps its project half colored and its
status half blue while any indicators remain. Empty Shared Lines stay blue. Once
all indicators and active comets clear, the whole wall returns to the remembered
scene. The existing mode and scene brightness rules still apply.

Animation coverage has two choices. **Both halves**, the default, lets waves and
comets cover the project half before restoring its current color. **Status half
only** keeps project identity steady. Red and yellow task indicators retain their
existing priority. Changing a color does not restart pulses or replay completions.
Quiet uses steady colors at 10%. Free tracks tasks while the Nanoleaf app controls
the lights.

Use **Swap halves** on selected Lines if you prefer the project color on the other
end. Line reservations use physical panel IDs rather than map order.

The inspector shows task title, status, project, and time since the current turn
started. Older tasks with no observed start time show "Start time unavailable."
The on-screen flow indicates task status; it does not replay physical outward
waves or comets or mirror controller frames. Its clock begins at the connectors
after assembly. Polls, palette changes, selection, and layout rebuilds preserve
that clock. Physical pulse and completion epochs remain unchanged. Reduced
motion keeps static modes distinguishable.
The [wall mode presentation specification](../openspec/specs/wall-mode-presentation/spec.md)
owns that behavior and the readout. Use the inspector's
project override for unresolved tasks; it changes only the bridge's assignment.
Choose "Use Codex assignment" to remove the override.

Project matching uses Codex's explicit project assignment first, then workspace
root hints and the hook's `cwd`. Windows drive paths, `/mnt/c` paths, and WSL UNC
paths are normalized for matching. The metadata reader keeps its last valid values
if Codex is updating a file or a file is unavailable. It reads
`.codex-global-state.json` and `session_index.jsonl`, never Codex's SQLite database.
These desktop fields are implementation details and may need updating after a
future Codex release.

The map server uses bundled HTML, CSS, and JavaScript with no external assets.
It listens only on `127.0.0.1`. Linux uses the configured fixed port, defaulting
to `8765`; legacy Windows startup selects an available port. Requests must use its exact
local address; writes also require the page's origin and an unpredictable request
token. The Nanoleaf credential never reaches the browser. `/api/state` reads map
state; `/api/settings`, `/api/project`, `/api/assign`, `/api/task`, `/api/locate`, and
`/api/mode` validate and save changes. All writes run in the installation's Python runtime, using the
same operating system and private database as its hooks. Only the existing bridge worker sends light
updates. The map server starts on demand and stays available until the next
upgrade or uninstall. Exiting the tray leaves it running.

## Completion comets

In Work mode, each newly completed turn queues a 2-second comet from its assigned
Line. A white head travels outward by distance, reaching the farthest Line after
1.4 seconds. A blue tail fades over the remaining 0.6 seconds. In Classic layout, both zones of each
Line stay identical, and overall brightness stays at 30%.

Comets play one at a time in completion order. Red and yellow task Lines remain
visible, and red/yellow outward waves take precedence wherever they pass. Green
and blue indicators briefly show the comet, then return to their current state.
Queued completions keep their ordinary unread blue pulse while waiting.

Reading a queued task skips its comet. Reading one during playback lets that comet
finish before its source Line is reused or the idle scene returns. A new turn or
an interruption cancels the task's comet. Tasks without a free Line wait for an
assignment while they remain unread.

Free and Quiet clear the comet queue and never accumulate celebrations for later.
Returning to Work does not replay old completions. Worker restarts preserve the
active comet's start time; only its remaining portion can resume. Expired comets
are not restarted. Failed light requests follow the same rule.

`setup --comet` previews one comet from the middle Line, then restores live status.
It is available only in Work and creates no fake task records. Mode changes
interrupt the preview. The ordinary status demo still previews local blue pulses.

## Scene restoration

Choose a saved scene in the Nanoleaf app. Before taking control, the bridge
remembers the selected scene and its brightness. If you choose a different scene
while indicators are showing, the bridge remembers that choice, then restores
the task display within about one to two seconds. Changing scenes does not restart
the tasks' outward pulses.

Reading one completed task returns its Line to steady blue while other indicators
remain. When the last running, blocked, or unread task clears, the bridge reselects
the remembered scene for the entire setup and restores its brightness. The scene's
animation may restart. While idle, the bridge leaves your scene running, so you can
change it normally in the Nanoleaf app.

The initial target is the next scene you choose in the Nanoleaf app. Until a scene
has been remembered, blue is the fallback. Blue also remains the fallback if you
delete the remembered scene from the controller. The bridge never saves its own
temporary task animation as your scene preference.

## Questions, blocks, and read status

An explicit `request_user_input_async` call marks a question while the task keeps
working. If the response then ends without an answer, its Line changes from yellow
to red. Blocking input tools and permission requests are red immediately. Matching
tool results or a new user prompt clear the relevant wait. Unrelated tool activity
does not clear it. Concurrent permission requests for the same tool cannot be
fully distinguished when Codex provides only the tool name.

Ordinary questions written only in response text and tools that bypass lifecycle
hooks are not detected. A failed command alone does not mean that the task is
blocked; the agent may still be handling the failure.

The bridge reads Codex Desktop's saved unread-task indicator from
`.codex-global-state.json`. It does not modify that file or mark tasks read. Once
an observed unread task disappears from that indicator, its Line returns to steady
blue, or the scene returns if it was the last indicator. For a newly completed response that never becomes unread, the bridge allows
five seconds for the desktop to save its status before treating it as already viewed.
Missing, malformed, or unavailable read status leaves the notification active.

This follows the app's unread marker, not eye tracking. The saved-state field is
an implementation detail verified on this PC and may change in a future desktop
version. Only completed tasks already tracked by this bridge are considered;
historical unread tasks do not consume all the Lines.

## Operation

The controller at `192.168.1.207` exposes 30 light zones, paired into 15 physical
Lines. Their saved positions determine each outward wave. Existing task assignments
are preserved. A finished, viewed task's slot can be reused when needed. At most
15 tasks can have individual indicators at once; additional tasks remain tracked
until a slot becomes available.

A local worker sends custom Nanoleaf animations. During the initial outward pulse,
it checks for changed task states and rebuilds the animation without resetting
other tasks' pulse times. After that, the controller loops the local pulses by
itself. While any indicators remain, the worker watches scene changes and the
saved unread indicator, and redraws only when needed. Once all indicators clear,
it restores the scene and exits.

On this PC, both WSL hooks and native Windows hooks use the bundled Windows
Python runtime. This lets them share the same database locks; Windows and WSL
locks on the same mounted file did not exclude each other during testing.
A separate worker lock prevents competing animations. Hook calls do not wait
for the animation to finish. Failed light requests remain retryable on the next
task event. Missing lifecycle events or a crashed worker can still leave stale
lighting; the reset control clears it.

## Installation and controls

On this Windows PC, the installed bridge is in `%LOCALAPPDATA%\CodexNanoleaf`.
For a fresh installation, run from the repository root in Windows PowerShell:

```powershell
$bridge = (Resolve-Path .\bridge\bridge.py).Path
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" $bridge setup
```

Setup checks the token entered at its hidden prompt, discovers the layout, and
adds seven handlers to the user hooks file. It backs up an existing hooks file and
preserves unrelated handlers. Review and trust the `nanoleaf-codex-status-v1`
handlers in the hook section of Codex Desktop Settings. No separate CLI launch
is needed.

Use the installed `bridge.py` with these arguments:

| Arguments | Action |
| --- | --- |
| `map` | Open the local wall map |
| `style classic` / `style project` | Switch layout without losing project preferences |
| `map-status` | Read mode, layout, coverage, and pending changes as JSON |
| `setup --check` | Check connectivity, physical Line count, and remembered scene |
| `setup --demo` | Preview green, yellow, red, and unread blue pulses from the middle Line, then restore live status |
| `setup --comet` | Preview one completion comet in Work, then restore live status |
| `setup --notify` | Preview one outward green pulse and a local pulse, then restore live status |
| `setup --refresh` | Redraw current task states |
| `setup --reset` | Clear task records and restore the remembered scene, or blue if none is available |
| `setup --uninstall` | Remove this integration's hooks; restart Codex afterward |

The full preview takes about 18 seconds and temporarily replaces the task display.
It does not create fake tasks or modify Codex's unread flags. If you change the
physical layout, remove the installation's `layout.json` and run `setup --check`
to rediscover it. Uninstall leaves the saved light credentials in place.

## Data and verification

The bridge stores identifiers, statuses, pulse times, Line assignments, and input
request identifiers in its own SQLite files. It does not read or modify Codex's
internal SQLite database. It reads the desktop JSON state locally for unread flags,
and reads the project catalog, task project assignments, workspace hints, and task-title index.
Only those fields are copied into the bridge database; other desktop settings are discarded. Prompts, questions, transcripts,
and tool results are not stored or sent to the lights. The Nanoleaf token stays
in the installation's private `config.json`.

The installation's `scene-state.json` stores only the scene name, brightness,
whether the bridge currently controls the display, and the scene temporarily dimmed
by Quiet mode. It survives worker
restarts. No saved Nanoleaf scenes are added, edited, or deleted.

All 100 tests pass in WSL and the bundled Windows Python. They cover
one outward pulse, spatial propagation, continuing local pulses, concurrent
status changes, question/block distinctions, unread receipt handling, read-state
failures, task assignments, migration, privacy, identical paired-zone frames in Classic,
the 2-second period, and unchanged status hue throughout each local pulse.
Scene tests cover restoring only after the last indicator clears, remembering
scene changes during quiet work, preserving brightness across worker restarts,
leaving idle scenes untouched, missing scenes, retrying failed restoration, and
adopting an existing task display during an upgrade.
Controller readback confirmed outward animations across all 15 Lines and local
pulses on one Line for green, yellow, red, and unread blue. The live checks also
verified 2-second frame durations and a consistent hue at every brightness in
each local pulse. They confirmed the steady blue baseline with power on,
followed by restoration of live task status.
Live scene checks confirmed that a viewed task returns to blue while another
keeps pulsing, a new scene choice becomes the restore target, and the last cleared
indicator restores that scene and its brightness. Test scene preferences were
isolated from the installation and discarded afterward.
The desktop unread indicator is readable on this PC; automated tests verify that
removing an unread marker clears its pulse. A separate Windows/WSL check confirmed
that both entry points respect the Windows worker lock.

This firmware requires positive frame times, so the bridge uses those throughout.

References: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Nanoleaf custom animations](https://nanoleaf.atlassian.net/wiki/spaces/nlapid/pages/2789310530/Nanoleaf+Light+Panels+Open+API+Documentation).

Mode tests cover persistent selection, silent Free operation, unread reconciliation,
steady paired-zone colors, brightness restoration after restarts and failed requests,
rapid switching, skipped old waves, preview cancellation, and missing-scene fallback.
The tray is also exercised with a fake bridge to verify menu clicks and checked
selections without changing the real lights.

Live mode checks confirmed Quiet at 10%, Free handoff, and resumed Work pulses.
An isolated scene check verified Quiet brightness restoration across restarts;
test scenes did not change the installation's saved preference. The Startup
shortcut was launched directly and duplicate tray launches kept one instance.
A full Windows sign-out and sign-in was not performed.

Comet tests cover frame colors and timing, queue order, duplicate events, early reads,
source reservations, overflow, cancellation, mode changes, restart timing, failed
requests, scene restoration, and excluding historical unread tasks.

Live comet verification passed for a middle-Line preview and two queued comets.
Controller readback confirmed white heads, 2-second frame sequences, identical
paired zones, and preserved red/yellow task colors. The live task display and
saved scene preference were restored after the checks.

Project tests cover reserved capacity and Shared overflow, exhausted capacity,
reassignment, both animation-coverage choices, half swaps, stable physical IDs,
settings persistence, path matching, manual overrides, metadata failures, elapsed
turn time, deferred edits, Locate timing, early reads, scene restoration, and HTTP
host/origin/token checks. Browser checks use Windows Edge and exercise selection,
colors, assignments, orientation, Locate, modes, layouts, and safe title rendering.
The native tray test checks menu actions and selected-item marks with a fake bridge.

Live Project checks passed on the installed controller. Readback verified distinct
zones, half swapping, both coverage settings, protected red/yellow indicators,
three reserved Lines plus two Shared Lines, a sixth task waiting, deferred edits,
Quiet Locate, and scene brightness restoration. The installed map loaded all
15 Lines and the current Codex project and task-title metadata. Test tasks and
scene choices stayed in isolated state; live settings and task records were
preserved. Map geometry follows the controller's orientation. Rotate, flip, and
Locate let you adjust it to your viewing position.

## Optional native controller API

The [controller API guide](../docs/controller-api.md) describes opt-in local machine authentication, mode-only control, pure snapshots, bounded recovery and verified dependency adoption. The [protected controller specification](../openspec/specs/protected-controller-api/spec.md) owns the machine contract. Existing wall-map authentication and the animation/scene behavior above remain unchanged. Source delivery does not enable the listener or install credentials.

## Connector geometry for the wall

The [connector geometry specification](../openspec/specs/wall-connector-geometry/spec.md)
owns the graph and cache compatibility contract. The existing `lines` response
and physical numbering remain available to older wall clients.

`GET /api/state` adds `connector_layout`, either `null` or this versioned shape:

```json
{
  "version": 1,
  "nodes": [
    {"id": "1", "x": 0, "y": 0, "sourceIds": [1]},
    {"id": "2", "x": 180, "y": 0, "sourceIds": [2]}
  ],
  "lines": [{"id": "101:102", "number": 1, "a": "1", "b": "2", "zoneIds": [101, 102]}]
}
```

`a` owns zone 0 and `b` owns zone 1. Line group order supplies
numbers, and the sorted pair supplies the stable Line ID. Co-located connector
records share one housing while retaining their source IDs. The producer applies
controller orientation and inverted display Y, exactly as for existing Line
points. The browser applies its rotation and flips once afterward.

The wall backend owns the whitelisted `connector-geometry.json` drawing cache beside `layout.json`. It reads legacy embedded caches for compatibility and does not rewrite the shared layout file.
Existing complete cached positions require no controller request. Zone-only
caches can be enriched by a layout read without resetting application state.
The map-server singleton owns acquisition, and its App lock serializes state
readers. The existing atomic JSON writer publishes the complete saved cache
before the in-memory cache changes. Concurrent layout writers retain their complete updates because enrichment writes a separate file. A restart reads this cache without a device request and derives missing legacy Line points from its validated zones. The private cache envelope records the shared layout file generation; rediscovering or replacing that file invalidates the drawing cache even when panel IDs are unchanged. An open map also checks the file generation during state reads and refreshes changed geometry within its existing bounded retry budget. Failed refreshes retain the last valid drawing. That file metadata never enters the browser projection.

Supported layouts use two-zone Lines and hexagonal housing records of types 16,
19, and 20. Validation requires unique zone mappings, unambiguous reported end
positions, and six-face connections within one degree of controller rounding.
Unknown shapes, including unsupported connector systems, use the existing Line
display instead of guessed housings. `connector_error` gives a sanitized
availability message; raw controller errors and private configuration stay in
the backend.

Acquisition has at most three attempts per map-server lifetime, ten seconds
apart, including startup. A transient failure can recover on a remaining
attempt; exhaustion retains the old wall without continuous polling, including
in Free mode. Restarting the map server permits a new bounded acquisition
window. The geometry projection does not send light writes, change task epochs,
or launch Windows helpers. Linux installation and multi-device support remain
separate work.


## Prism source and packaging

`prism.js` owns scalable material factories, graph assembly, per-Line zone colors,
and renderer lifecycle. `prism-adapters.js` accepts only the sanitized connector
projection and presentation transforms. The wall keeps application operations,
status colors, selection, and polling. Invalid connector data retains the last
valid Prism shape; without one, the standard Line map remains available with a
notice. Neutral luminous numbers appear for selected, highlighted, hovered or
keyboard-focused Lines. Each reason independently keeps its number visible.
Touch selection retains its number. **Show all numbers** reveals every number;
**Hide idle numbers** restores conditional visibility. This display preference is
off by default and stays in this browser. It does not send a bridge request.

`prism-labels.js` places all numbers together against final screen geometry,
regardless of which numbers are currently visible. Measured envelopes clear
crystal bodies, selection and pending rings, connector borders and each other.
Text stays at least 11 screen pixels with a minimum 24 by 24 pixel click target.
A missing helper or unexpectedly unplaceable number shows a notice while Line
controls retain their accessible physical numbers. Rotation, flips, resize and
geometry replacement recompute placement without changing identity.

All three JavaScript files ship beside `wall.html` and `wall_server.py`. Their three
explicit `/assets/` routes retain the wall's Host and CSP checks and do not serve
arbitrary files. The asset README documents the approved source fingerprint and
reproducible SVG exports. The isolated packaged-server check copies these files
and starts the foreground entry point with device and worker calls forbidden.
This verifies source portability; installation and service setup belong to #54.

The browser suite retains identity and action journeys, checks mechanical and
flow behavior, and records desktop, compact, mobile, and high-DPI poses. Its
frame receipt names the browser and reports 120 intervals for the actual
15-Line layout and a 56-Line triangular-lattice fixture. These measurements
support only those fixtures and that runner. Current UI approval belongs in the
PR; source checks do not establish installed or physical-light acceptance.

## Shared input

The [shared input guide](../docs/shared-input.md) describes explicit legacy/shared selection,
steady stale indicators, clear-on-new-turn notices and rollback. Its
[specification](../openspec/specs/shared-session-consumer/spec.md) owns shared-mode additions;
the legacy task, mode, allocation and scene rules above remain unchanged.

# Nanoleaf task lights for Codex

For a fresh Linux installation, use [the Linux setup guide](../docs/linux-install.md). The [Linux runtime specification](../openspec/specs/linux-runtime/spec.md) owns installation and service behavior. Linux uses `nanoleaf mode work`, `nanoleaf mode quiet`, and `nanoleaf mode free`; `nanoleaf map --no-open` prints the map URL. The hooks, CLI, wall map, and controller share Linux state and one on-demand light writer. The Windows tray and installer were retired from source in [ADR 0012](../docs/decisions/0012-retire-windows-runtime.md).

Work, Free, and Quiet are selected from the wall map, the CLI, or a native client
through the controller API. The selected mode is remembered. The task animation
described below is Work mode. Task tracking continues in every mode.

| Mode | Active indicators | Idle |
| --- | --- | --- |
| Work | 2-second task pulses, status waves, and completion comets at 30% brightness | Remembered scene and original brightness |
| Free | No task lighting; use the Nanoleaf apps for scenes, music, or Screen Mirror | Leave the lights alone |
| Quiet | Steady task colors at 10%, without pulses or outward waves | Remembered scene at 10% |

Entering Free restores the remembered scene and brightness once if the bridge
controls the lights. An already-playing user scene is left playing. After release,
even blocked tasks cannot interrupt it. Free does not launch music or Screen Mirror;
start those in the Nanoleaf apps.

A native client of the [controller API](../docs/controller-api.md#general-controls)
can also set power, brightness and, in Free only, a saved scene or a
[requested animation](../docs/integration-api.md#requested-animations). Brightness and
power set that way are overrides: they govern the bridge's writes in the current
mode until the next explicit mode choice, including the same mode, from the
CLI, wall map or a native client. While power is off the bridge sends no indicator,
restoration or preview writes and keeps tracking tasks; an explicit native control,
scene or animation still sends its one write. In Work and Quiet the remembered scene brightness is never
replaced by an override; in Free the bridge does not own the lights, so a
brightness set there becomes the preference like a change made in the Nanoleaf app.

Returning to Work shows current tasks without replaying waves from statuses that
arose while away. Future status changes get their normal wave or completion comet. Modes do not mark
tasks read or discard task assignments. Quiet preserves the scene's original
brightness so it can return when you leave Quiet. If no saved scene is available,
the fallback is steady blue at the mode's brightness. In Project layout, steady
project signature colors can remain on their assigned halves in Free; task
pulsing stops.

A mode change normally appears within two seconds. The wall map's status readout
reports pending changes and failed light updates; the worker retries controller
failures. Connection text describes the last update, not continuous connectivity
testing. After its handoff, Free sends controller requests only for a native
client's explicit commands: one write each for power, brightness, a scene or an
animation.

Use the installed `nanoleaf mode work`, `nanoleaf mode free`, or
`nanoleaf mode quiet` to switch from a terminal. `nanoleaf status --json` reports
`mode`, `pending`, and a sanitized `error`. Installed commands use the
installation's private Linux state directly.

Preview commands are disabled in Free. Refresh and reset respect the selected
mode. Uninstall requests Free mode and removes the hooks.
To roll back to earlier source, stop this installation's services and worker,
replace the copied runtime under the state directory with the earlier reviewed
source, then run `setup --refresh`. Keep the current database to retain task
events received since the change; older program files ignore newer tables. Older program files do not know the
recorded native brightness level in `scene-state.json`; if a native override was
active at rollback, choose a mode once so the older worker re-observes the scene
rather than adopting that level as the remembered brightness.


The following read/Line-release policy describes legacy input; [shared input](../docs/shared-input.md#retained-idle-tasks-and-evict) retains idle tasks until owner removal or local eviction.

Each task keeps an assigned Line while it is active or has an unread completion.
That Line stays in the task's status color as its brightness pulses. Unused Lines
and Lines of read or interrupted tasks show the Base color while task indicators
are showing. In Classic layout, both lighting zones of a physical Line receive the
same animation.

| Task state | Its assigned Line, with the default palette |
| --- | --- |
| Working | Pulses in the Working color (green) |
| Has an asynchronous question and continues working | Pulses in the Question color (yellow) |
| Blocked on input or approval | Pulses in the Blocked color (red) |
| Completed but unread | Queues one completion comet, then pulses in the Unread color (violet) until Codex marks it read |
| Completed and read, interrupted, or unused while other indicators remain | Steady in the Base color (dim blue) |
| No active, blocked, or unread tasks remain | The remembered scene plays again |

Choose each color under **Options > Colors** in the wall map, from suggested
swatches or a custom color. **Reset colors** restores the defaults. One palette
covers every registered device. The map warns when two roles look alike but still
saves the choice. The [task-light colors specification](../openspec/specs/task-light-colors/spec.md)
owns the palette, its defaults and where each color applies, including pulses,
outward waves, Quiet, comets, Project halves and status priority.

A pulse takes 2 seconds. The first pulse after a working, question, or blocked status change radiates outward
from that task's Line, reaching nearby pieces before distant ones. Afterward,
only its assigned Line pulses. Completion uses the comet described below instead of an outward wave.

Each task has its own pulse start time. Ordinary tool activity and changes in
other tasks do not restart its outward pulse. Completed markers no longer stay
green. Task indicators use 30% overall brightness. The remembered brightness
returns with the scene.

## Project signatures and wall map

Run `nanoleaf map --no-open` and open its printed URL in a browser. The map draws the saved
physical Lines with faceted Prism crystal tubes, separate colored zones, bright
cores, and diffuse light around the crystal. It uses local system fonts and
updates task state once a second. In Work, each Line carrying a task sends light
from both connectors toward a brief center spark on a shared two-second cycle.
Idle Lines stay steady. Quiet lowers the glow and stops travel; Free dims and
desaturates the wall. The toolbar readout names the mode, pending edits and the
blocked and question alerts; the wall heading counts Lines and the Tasks heading
counts tasks.

The tubes meet the flat faces of hexagonal connectors. Opening assembly ejects
tubes from the most-connected hub, rotates the hub with its structure, and then
extends outward. Arriving connectors grow from the Line tips and unfold six
permanent inner-border sections. The finished artwork uses the same components
as the moving structure. **Replay assembly** repeats the two-second sequence,
and the **Play on opening** and **Play on view entry** checkboxes keep those
preferences separately in the browser. Interaction completes assembly before
performing the action. Reduced motion skips assembly and traveling light, and a geometry change or connection
failure ends assembly immediately. A future view can call
`wallAssembly.play('entry')`, which honors the entry preference. The
[wall assembly specification](../openspec/specs/wall-assembly-animation/spec.md)
owns that behavior. The
[wall Line identification specification](../openspec/specs/wall-line-identification/spec.md)
defines numbered project/task badges, Shared pool identification, selection,
pending labels, and the explicit Locate boundary. In Project layout, select Lines
and choose a project under **Reserved for**; the choice applies at once to every
selected Line, and Shared pool releases a reservation. Classic shows no
reservation controls.
The [current projects specification](../openspec/specs/wall-current-projects/spec.md)
owns project visibility, activity ordering, saved-project access, and color editing.
Use **Show saved projects** in the left column to find a project without current
tasks or change its saved color.

**Options** above the wall holds the secondary map controls in four labelled
groups: Layout (**Classic** and **Project**, with **Coverage** shown only while
Project is active), Numbers (**Show all numbers**), Orientation (**Rotate**,
**Flip H** and **Flip V**) and Assembly (**Replay assembly** and the two playback
preferences).
Enter or Space opens it, Escape closes it and returns focus to Options, and a
press elsewhere closes it. Opening the menu or toggling a browser-local
preference sends no request; Rotate and Flip keep saving through the existing
settings request, and a layout choice sends the same request. The mode,
connection state, pending edits and alerts stay visible without opening it, and
the context card carries the only selection hint. The
[wall map hierarchy specification](../openspec/specs/wall-map-hierarchy/spec.md)
owns the default screen and this menu.

The inspector initially shows up to one task per Line on the selected device,
ordered by status: blocked, question, working, then unread. Selecting a task
highlights it without moving it. The two-column desktop grid puts the current
wall's 15 tasks above the selection details so they can be seen without
scrolling. Compact titles shorten to fit; select a task or hover its title to
read it in full. The Tasks heading carries the retained total; the lines below
give the status breakdown, the waiting count and how many rows are shown. Use
**Show all tasks** to
filter by status or waiting placement, or search by title, project, or task ID.
**Show selected tasks** reveals a selection excluded by the current filter or
the compact limit. Waiting tasks share this single list; the waiting count
summarizes them. Browsing does not mark tasks read or change their placement.
The [task inspector specification](../openspec/specs/wall-task-inspector/spec.md)
owns these controls and their polling, focus, and retirement behavior.

Select a Codex Desktop task to find **Open in Codex** in its context card. Legacy
tasks get the link only when their UUID is in the configured Desktop title index;
shared tasks need a Codex Desktop root-session UUID. Folded subagents link to
their parent. CLI, Claude Code, unknown and malformed IDs have no link. The
server builds the local `codex://threads/<uuid>` URL; the browser may ask for
permission to open Codex. This internal Desktop URL format can change in a later
Codex release. Selecting a task here does not mark it read. Opening it in Codex
lets Codex mark it read, which the existing unread reader then follows. The link
sends no map action, acknowledgment, Locate or device request, and the map never
writes Codex data.

| Layout | Task placement | Display |
| --- | --- | --- |
| Classic, the upgrade default | Automatic across all Lines | Whole-Line status colors |
| Project | Its project's reserved Lines, then Shared overflow | Project identity on one half and status on the other |

Switch layouts from the map's Options menu or the `style` command. Mode, layout,
colors, reservations, half choices, map orientation, and animation coverage
survive restarts. Classic keeps
your saved project settings for the next time you choose Project.

Each task uses one eligible Line. Valid placements stay in place. Tasks never
borrow another project's reserved Lines. When eligible Lines fill up, extra tasks
remain tracked and show **Waiting for a Line** in their task rows. Reassigning a Line moves
its task to another eligible Line or the waiting list. If the edit would move an
active comet's source, the map shows the pending change and applies it when that
comet finishes. Several edits made during a comet are combined.

In Project layout, an unused reserved Line keeps its project half colored and its
status half in the Base color while any indicators remain. Empty Shared Lines use
the Base color. Once
all indicators and active comets clear, the whole wall returns to the remembered
scene. The existing mode and scene brightness rules still apply.

Animation coverage has two choices. **Both halves**, the default, lets waves and
comets cover the project half before restoring its current color. **Status half
only** keeps project identity steady. Blocked and question task indicators retain their
existing priority. Changing a color does not restart pulses or replay completions.
Quiet uses steady colors at 10%. Free tracks tasks while the Nanoleaf app controls
the lights.

In Project layout, use **Swap halves** on selected Lines if you prefer the project
color on the other end. Line reservations use physical panel IDs rather than map
order.

The context card names the selected Line, or lists several, then shows the task's
title, status, project and time since the current turn started, and offers
**Locate**. Older tasks with no observed start time show "Start time unavailable."
Escape or a click on empty wall canvas clears the selection; in Free the disabled
Locate explains that Work or Quiet is needed.
The on-screen flow indicates task status; it does not replay physical outward
waves or comets or mirror controller frames. Its clock begins at the connectors
after assembly. Polls, palette changes, selection, and layout rebuilds preserve
that clock. Physical pulse and completion epochs remain unchanged. Reduced
motion keeps static modes distinguishable.
The [wall mode presentation specification](../openspec/specs/wall-mode-presentation/spec.md)
owns that behavior and the readout. The map offers no per-task project override;
tasks without an attributed project read "No project", and the
[integration settings extension](../docs/integration-api.md) keeps the manual
override for machine clients. The status-first default screen is recorded in
[ADR 0013](../docs/decisions/0013-wall-map-status-first.md).

Shared Codex tasks use local titles and projects from the same configured metadata
reader. A hub label takes precedence over the local title. Project allocation uses
a manual override first, then the hub project, then the local Codex assignment or
workspace-root match. Other providers do not inherit Codex metadata. Lookup only
enriches tasks still present in the shared feed and never restores retired tasks.
Local metadata stays on this installation.

When a title is unavailable, both input modes show the provider and the last eight
hexadecimal characters of the raw session ID, such as **Codex 5b1e07c2** or
**Claude 4227761b**. The [task metadata specification](../openspec/specs/shared-task-metadata/spec.md)
defines these rules.

Project matching uses Codex's explicit project assignment first, then workspace
root hints and the hook's `cwd`. Windows drive paths, `/mnt/c` paths, and WSL UNC
paths are normalized for matching. The metadata reader keeps its last valid values
if Codex is updating a file or a file is unavailable. It reads
`.codex-global-state.json` and `session_index.jsonl`, never Codex's SQLite database.
These desktop fields are implementation details and may need updating after a
future Codex release.

The map shows one registered device at a time. It opens on the Lines; when a
second device is registered, a **Device** control beside the wall heading lists
the devices and switches the page, and the choice stays in the URL
(`?device=panels`) so a reload keeps it. The registry is read on every state
request, so a device enrolled while the map runs appears without a restart. The
Mode controls, the readout's pending state and last error, the reservations,
the waiting count, Locate and the orientation settings all belong to the
selected device; project colours and task project assignment stay shared. A
Light Panels device is drawn as plain triangles from the geometry that
enrollment saved, in the reported arrangement and numbered in the geometry
reader's order, each filled with its task's status colour or the Base colour
without pulse, wave or comet animation. In Project layout a reserved triangle
shows its project colour on its outline. Triangles support selection,
multi-selection, **Reserved for** and Shared release, the context card and
Locate; Coverage and Swap halves are Lines-only and hidden for triangles.
Switching devices or selecting sends nothing to the lights, and the Panels play
no assembly. The
[device selector specification](../openspec/specs/wall-device-selector/spec.md)
owns this behavior.

The map server uses bundled HTML, CSS, and JavaScript with no external assets.
It listens only on `127.0.0.1` at the configured fixed port, defaulting
to `8765`. Requests must use its exact
local address; writes also require the page's origin and an unpredictable request
token. The Nanoleaf credential never reaches the browser. `/api/state` reads map
state, including the effective palette; `/api/settings`, which also saves the palette, `/api/project`, `/api/assign`, `/api/task`, `/api/locate`, and
`/api/mode` validate and save changes. `/api/state` takes an optional `device`
query parameter, and the mode, settings, assignment, Locate and eviction actions
take an optional `device` field; a request that names no device addresses the
Lines, and an unregistered device is rejected without touching the Lines. Coverage
settings and half swaps are rejected for one-zone elements. All writes run in the installation's Python runtime, using the
same operating system and private database as its hooks. Only the existing bridge worker sends light
updates. The map server runs as a user service and also starts on demand.

## Completion comets

In Work mode, each newly completed turn queues a 2-second comet from its assigned
Line. A white head travels outward by distance, reaching the farthest Line after
1.4 seconds. A tail in the Unread color fades over the remaining 0.6 seconds. In Classic layout, both zones of each
Line stay identical, and overall brightness stays at 30%.

Comets play one at a time in completion order. Blocked and question task Lines remain
visible, and blocked and question outward waves take precedence wherever they pass. Working
and unread indicators briefly show the comet, then return to their current state.
Queued completions keep their ordinary unread pulse while waiting.

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
interrupt the preview. The ordinary status demo still previews local pulses in the current palette.

## Scene restoration

Choose a saved scene in the Nanoleaf app. Before taking control, the bridge
remembers the selected scene and its brightness. If you choose a different scene
while indicators are showing, the bridge remembers that choice, then restores
the task display within about one to two seconds. Changing scenes does not restart
the tasks' outward pulses.

Reading one completed task returns its Line to the steady Base color while other indicators
remain. When the last running, blocked, or unread task clears, the bridge reselects
the remembered scene for the entire setup and restores its brightness. The scene's
animation may restart. While idle, the bridge leaves your scene running, so you can
change it normally in the Nanoleaf app.

The initial target is the next scene you choose in the Nanoleaf app. Until a scene
has been remembered, steady blue is the fallback, whatever the Base color. Blue also remains the fallback if you
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
an observed unread task disappears from that indicator, its Line returns to the
steady Base color, or the scene returns if it was the last indicator. For a newly completed response that never becomes unread, the bridge allows
five seconds for the desktop to save its status before treating it as already viewed.
Missing, malformed, or unavailable read status leaves the notification active.
The reader accepts the version 1 `electron-thread-read-state-v1` marker and
combines its unread lists across host and identity buckets. When that marker is
absent, it accepts the older `unread-thread-ids-by-host-v1.local` field under
`electron-persisted-atom-state`. A present but invalid or unsupported current
marker is unavailable; it does not fall back to an older saved list.

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

The private configuration registers each device by id, kind, address and token
reference; the original Lines device is `wall`. Placements, reservations,
pending edits, comets, Locate, mode and the saved scene are stored per device,
and the layout file holds one entry per device with each element's physical
ID, number and zones. The
[device state specification](../openspec/specs/device-state/spec.md) owns that
contract and the in-place migration, which runs wherever this source opens a
database and is qualified on Linux; [ADR 0009](../docs/decisions/0009-device-aware-state.md)
records the decisions.

Original NL22 Light Panels can be registered beside the Lines as a `panels`
device with `nanoleaf device-enroll`. The worker runs once per registered device, each with its own lock, so
every device has one writer. Each device mirrors the same tasks with its own
placements, reservations, capacity and waiting list. It also keeps its own
mode, saved scene, comets and failure state. Each triangle is one task slot
with whole-triangle colors; Lines keep their project and status halves.
`nanoleaf mode <mode> --device panels` and `status --device panels` target the
panels, and commands without `--device` address the Lines. The wall map's
**Device** control shows and edits the Panels one device at a time. `setup --reset` and
switching the shared task source reset every device. Once
[added to the controller](../docs/controller-api.md#add-the-nl22-light-panels),
the Panels have their own controller ledger, which only the Panels' worker
executes. The feed poller, the integration settings queue and requested
animations stay on the Lines. The
[device worker](../openspec/specs/device-worker/spec.md) and
[Panels rendering](../openspec/specs/panels-rendering/spec.md) specifications
own this behavior, and [ADR 0010](../docs/decisions/0010-per-device-worker-and-nl22.md)
and [ADR 0015](../docs/decisions/0015-per-device-controller-ledgers.md)
record the decisions. Hardware verification of the NL22 payload belongs to
[#46](https://github.com/jimmie-potts/codex-nanoleaf/issues/46).

Enrollment reads the device once and requires model NL22 and a valid triangle
layout before it writes anything. It stores the credential under its own private
configuration key, saves the reported geometry and starts the device in Free, so
the Panels receive nothing until `mode work --device panels` or `mode quiet
--device panels`. It refuses the `wall` id, an address another device uses, and
an existing id at a new address. Repeating it for the same id and address
replaces only the credential. `nanoleaf device-address --device panels --ip
<new>` moves a registered Panels device to a new address after checking,
with its stored credential, that the device there reports NL22 and the saved
triangles in the same places. It changes only the registered address, sends no
light write, and a running worker uses the new address from its next pass. It
refuses `wall`, an address another device uses and a device that does not
match. `nanoleaf device-remove --device panels` removes a device after its Free
handoff has applied; `--force` removes an unreachable one.
It stops that device's worker and deletes its registration, credential, layout
entry, device-scoped rows and saved scene. Lines and shared tasks are unchanged.
Neither command changes hooks, listeners or machine credentials, and no service
restart is needed. The [device enrollment specification](../openspec/specs/device-enrollment/spec.md)
owns this behavior, and the [Linux installation guide](../docs/linux-install.md#add-nl22-light-panels)
has the commands.

A local worker sends custom Nanoleaf animations. During the initial outward pulse,
it checks for changed task states and rebuilds the animation without resetting
other tasks' pulse times. After that, the controller loops the local pulses by
itself. While any indicators remain, the worker watches scene changes and the
saved unread indicator, and redraws only when needed. Once all indicators clear,
it restores the scene and exits.

Hooks run in WSL with the installation's Python and share its Linux database
locks. A separate worker lock prevents competing animations. Hook calls do not wait
for the animation to finish. Failed light requests remain retryable on the next
task event. Missing lifecycle events or a crashed worker can still leave stale
lighting; the reset control clears it.

## Installation and controls

The installed bridge lives under `~/.local/share/codex-nanoleaf`. For a fresh
installation, follow [the Linux setup guide](../docs/linux-install.md); the
historical `setup` command below describes what registration does.

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
| `setup --demo` | Preview working, question, blocked, and unread pulses in the current palette from the middle Line, then restore live status |
| `setup --comet` | Preview one completion comet in Work, then restore live status |
| `setup --notify` | Preview one outward working pulse and a local pulse, then restore live status |
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
whether the bridge currently controls the display, and the playing scene whose
brightness the bridge changed (Quiet's 10% or a native override) with the level it
wrote. It survives worker restarts. No saved Nanoleaf scenes are added, edited, or
deleted; a native scene choice selects an existing one.

The regression suite (`python3 scripts/check.py`) passes in WSL. It covers
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
removing an unread marker clears its pulse.

This firmware requires positive frame times, so the bridge uses those throughout.

References: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Nanoleaf custom animations](https://nanoleaf.atlassian.net/wiki/spaces/nlapid/pages/2789310530/Nanoleaf+Light+Panels+Open+API+Documentation).

Mode tests cover persistent selection, silent Free operation, unread reconciliation,
steady paired-zone colors, brightness restoration after restarts and failed requests,
rapid switching, skipped old waves, preview cancellation, and missing-scene fallback.

Live mode checks confirmed Quiet at 10%, Free handoff, and resumed Work pulses.
An isolated scene check verified Quiet brightness restoration across restarts;
test scenes did not change the installation's saved preference.

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
host/origin/token checks. Browser checks exercise selection, colors, assignments,
orientation, Locate, modes, layouts, and safe title rendering.

Live Project checks passed on the installed controller. Readback verified distinct
zones, half swapping, both coverage settings, protected red/yellow indicators,
three reserved Lines plus two Shared Lines, a sixth task waiting, deferred edits,
Quiet Locate, and scene brightness restoration. The installed map loaded all
15 Lines and the current Codex project and task-title metadata. Test tasks and
scene choices stayed in isolated state; live settings and task records were
preserved. Map geometry follows the controller's orientation. Rotate, flip, and
Locate let you adjust it to your viewing position.

## Optional native controller API

The [controller API guide](../docs/controller-api.md) describes opt-in local machine authentication, mode, power, brightness and saved-scene control, pure snapshots, bounded recovery and verified dependency adoption. The [protected controller specification](../openspec/specs/protected-controller-api/spec.md) owns the machine contract. Existing wall-map authentication and the animation/scene behavior above remain unchanged. Source delivery does not enable the listener or install credentials.

## Rendering snapshot

The local map's `GET /api/rendering` reads the latest fully successful worker receipt directly from private SQLite. It returns the encoded effect payload, physical zone groups, mode, brightness, looping, and separate animation and send-acceptance timestamps. The endpoint does not refresh task metadata, acquire geometry, contact the controller, or launch a worker. A successful command is not optical verification; Free mode and unreadable external scenes do not claim mirrored frames. The map does not consume this snapshot yet; [#17](https://github.com/jimmie-potts/codex-nanoleaf/issues/17) owns its renderer. See the [rendering snapshot specification](../openspec/specs/wall-rendering-snapshot/spec.md).

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
or launch helper processes.


## Prism source and packaging

`prism.js` owns scalable material factories, graph assembly, per-Line zone colors,
and renderer lifecycle. `prism-adapters.js` accepts only the sanitized connector
projection and presentation transforms. The wall keeps application operations,
status colors, selection, and polling. Invalid connector data retains the last
valid Prism shape; without one, the standard Line map remains available with a
notice. Neutral luminous numbers appear for selected, highlighted, hovered or
keyboard-focused Lines. Each reason independently keeps its number visible.
Touch selection retains its number. **Show all numbers**, in the Options menu,
reveals every number; **Hide idle numbers** restores conditional visibility. This display preference is
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
the legacy task, mode, allocation and scene rules above remain unchanged. Shared
idle tasks retain their wall row and assigned Line, and task details offer
device-local **Evict task**; see the shared input guide for persistence and
re-admission limits.
An explicit shared-owner recovery can retire an uncertain unknown-ID approval;
the next owner revision clears its frozen red status while the map still reports
uncertain evidence. Owner read evidence or full acknowledgment likewise clears a
stale unread pulse while retaining the idle row and Line. This does not act on Codex permissions; the existing worker renders the state.
Subagent sessions count as part of their parent task rather than as separate
unread tasks. The guide lists how a retained notice clears.

## Machine integration settings

The [integration settings extension](../docs/integration-api.md) exposes existing layout, coverage,
reservations, task-project overrides and saved colors through the protected
controller. It has separate versioned requests and configuration receipts; shared
controller v1 mode commands remain unchanged. Pure reads exclude local titles and
paths. The existing worker applies edits on the installation's native database.
Its one light command, the Free-only [`animation.play`](../docs/integration-api.md#requested-animations),
is played by the same worker with transport receipts.
Source delivery does not enable the listener, switch task input or change an installation.

Desktop tasks removed by the shared owner release their local task state and Lines. Snapshot 1.1 generation changes also reset a recreated task after missed removal; see [shared input](../docs/shared-input.md#ended-desktop-tasks) for version requirements, preserved project settings and installation order. Native mode selection remains independent.

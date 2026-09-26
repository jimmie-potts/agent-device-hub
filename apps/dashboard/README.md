# B.U.N.N.Y. integration dashboard

The React/TypeScript frontend reads the shared hub and submits explicit integration
commands to its existing services. It creates no collector or device writer.
The home, component and connection pages remain useful without an active task.
Hub #151 adds Pixoo general controls and Hub #153 adds Nanoleaf general
controls to the same component view. Hub #277 turns the pages into a dense
control surface: a home of widgets, hash routes and one card per control.
Exact previews and full editor migration remain separate work.

## Pages, routes and widgets

Every page has a hash address: `#/` (also `#/home` and `#/activity`) for the
home, `#/component/<alias>` for a registered component, `#/music/<source>` for
now playing and `#/connections`. `src/routes.ts` parses a hash into a
discriminated route, so built-in pages and component aliases are distinct kinds
and an alias of `activity` or `connections` opens only that component
([#247](https://github.com/jimmie-potts/agent-device-hub/issues/247)). A
navigation link applies its route in the click event, ahead of the browser's
deferred `hashchange`, so two pages are never shown at once; the back button
walks the history. An address that names nothing shows a not-found message and
sends no command. The launcher's `#launch=` fragment is not a route; it is
stripped before the dashboard mounts.

The home is a widget grid. `src/widgets.ts` is the catalog: each widget declares
an ID, a name, a description, its sizes, its source kind (a registered
controller alias, a hub route or a read-only external source from
[#287](https://github.com/jimmie-potts/agent-device-hub/issues/287)), the reads
it needs and whether it offers command actions. `homeLayout` is the developer
placement: one `component-status` widget per registered component (health, the
status strip, and the same Mode and Power cards as the component page, with a
link to it), then `attention`, `collector` and `sessions`. Sessions are compact
rows with an inline label form and their retained notices under the row.
[#366](https://github.com/jimmie-potts/agent-device-hub/issues/366) makes
placement the owner's; graph widgets
([#283](https://github.com/jimmie-potts/agent-device-hub/issues/283)) and the
wall miniature ([#286](https://github.com/jimmie-potts/agent-device-hub/issues/286))
register in the same catalog. Every page stays mounted and hidden, so the session filter, selection and
focus survive navigation; a text field still being edited is sent when the
user leaves it, and a click on a navigation link leaves it. A control that appears on the home and on its
component page shares one lifecycle state (`useCommandLifecycle` takes a key per
component and control): a running command or an uncertain lock on either
instance is the same on the other, and one reload unlocks both.

A component page shows its identity and health, a one-line status strip (mode,
power, brightness, observation age, pending commands, and the observed color for
LIFX), the remaining facts behind a Details disclosure, and every available
control as a card in a grid that fills the width: Mode with Reapply or Start
Monitor, Power, Brightness, Media with the Media switch, Scenes with the Free
switch, and Color and Color temperature for LIFX. Each card keeps one short
visible line for its state; the longer guidance sits behind a Help disclosure.
No control has an Apply button (owner decision on the design candidate,
2026-09-25): a select sends a pointer choice at once and a keyboard step after a
short pause, on Enter or when it is left, so arrowing through options sends
only the one the user stops on; a slider sends once when the pointer releases
it or after a pause following a keyboard step, never mid-drag; a color picker
sends when it closes; a text field sends when it is left or on Enter, and only
while the browser's own constraints (pattern, range, required) hold; Power is a
button that names the one action left (Turn on or Turn off; both when power is
unknown). The shared control state is forgotten on disconnect. Choosing a
playlist starts it and choosing a scene activates it; the choice clears once
the command settles. Every send is still one guarded command from a fresh
read, and a rejected change shows the current value again with its status.
Nanoleaf's integration settings, element assignments, task mappings and project
colors sit in one Assignments panel and the Pixoo view form in one Monitor
panel. Connections is a two-card page; the login is one line and the token
disclosure. At 1,280 px wide the wall page is under 2,000 px tall, down from
3,624 px before this change.

## Visual foundation

The [application UI style guide](../../docs/application-ui-style-guide.md)
records the shared visual direction (Neon Geometry Wars), the skin template and
semantic role names, the component and state rules, the B.U.N.N.Y. spelling and
the component vocabulary. [`src/skins/neon-geometry-wars.css`](src/skins/neon-geometry-wars.css)
is the application token layer that future pages extend; `src/style.css` reads
only its role and private token names, with no raw colors of its own. Adding a
second skin follows [guide section 4.4](../../docs/application-ui-style-guide.md#44-adding-a-skin).

## Build and access

Use Node 24 at the repository root. `npm ci` and `npm run build` produce the fixed
HTML, JavaScript and CSS assets in `apps/hub/public`. `npm run package:hub` includes
these assets in the reproducible offline-installable host archive. The configured
hub serves them at its loopback origin, `127.0.0.1` or `localhost`. There is no separate frontend
server or CORS grant.

The dashboard can command only the devices registered in the hub's `controllers`
list. To wire an installed Pixoo or Nanoleaf controller in, follow
[Connect device controllers for B.U.N.N.Y.](../hub/SETUP.md#connect-device-controllers-for-bunny)
in the hub setup guide.

The normal installed opening path uses the Hub owner's `open` command. It passes
one short-lived code through a
URL fragment, removes the fragment before exchange, and returns a memory-only
browser session with read/control on configured aliases. Reload requires another
launcher invocation. A direct URL still shows the manual-token option. See
[the Hub launcher procedure](../hub/README.md#open-bunny-without-typing-a-token).

When the hub's configuration sets `browserAccess` to `trusted-loopback`, a direct
visit or bookmark signs in on load instead, with the same session and no stored
token. A reload or second tab signs in again, and a page logs its session out
as it unloads. After Disconnect the page shows **Sign in**; after an eviction or
expiry the sidebar shows **Sign in again**. Neither signs in on its own. If the
request fails, the page shows an alert with the launcher and token options.
Without the setting the hub answers 404 and the login page is unchanged. See
[Open B.U.N.N.Y. from a bookmark](../hub/README.md#open-bunny-from-a-bookmark).

For manual access, provision a dedicated hub browser credential with `read`,
optional `control`, and only the intended registered device aliases. Give the
user its token through the existing private provisioning process. Never use a
native controller token. The login holds the token in memory only;
disconnect/reload clears it. The hub continues enforcing scopes, device
permissions, Host, Origin and Fetch-Metadata before commands or replay.
Controller-native tokens remain in private server configuration. A read-only
credential sees disabled controls with explanations.

Add an existing configured monitor consumer if notice acknowledgment is needed.
The UI lists configured consumers; acknowledgment changes only that consumer's
monitor notice state. It never marks a Codex chat read or asserts task success.
No setup command changes an existing installation, starts personal services,
launches an agent or contacts devices.

An optional hub `editorLinks` object maps registered aliases to advanced editor
URLs. Only credential-free `http://127.0.0.1:<port>/<path>` links without a query
or fragment are accepted. Configure the existing wall/playlist editor's actual
address; the dashboard neither guesses destinations nor proxies these links.

## Common component view

`client.ts` defines the component identity and authenticated transport.
`lifecycle.ts` holds the one command lifecycle that draft forms (`EditForm`) and
one-click actions (`useCommand`) share: sending, blocked and failed
preparation, results, the accepted-ticket watch, locks and explicit reload.
Forms keep their drafts and configuration-revision conflicts; actions and forms
build their own device requests and apply their own availability rules.
`controls.tsx` holds those primitives and the control cards. `deviceControls`
computes one component's availability, supported modes and fresh reread from
one device read, and `ModeCard`, `PowerCard`, `BrightnessCard`, `MediaCard`,
`SceneCard`, `LightingCards`, `NanoAssignments` and `PixooMonitor` render from
it, on the component page and in the home widget alike. `ComponentView` in
`src/main.tsx` composes them with the identity, status strip and Details.
Nanoleaf and Pixoo use typed integration views over their delivered versioned
extensions. Unknown component kinds receive a read-only view, with no invented
controls.

Future frontend integrations join this registry and navigation pattern. Their
owning issues supply the production API, permissions, typed settings/controls,
specialized view if necessary, and browser/owner-contract tests. Adding a display
name does not qualify a new device. A third synthetic sensor fixture verifies
that the shell supports a component with different capabilities without adding
production hardware support.

Tidbyt and LIFX components ([#289](https://github.com/jimmie-potts/agent-device-hub/issues/289))
come from the [local controller host](../local-controllers/README.md) and have no
integration settings or advanced editor. The Tidbyt view says that the host
publishes its status and now-playing tiles. The Tidbyt controller declares no
controller v1 capability, so the view shows one line instead of general controls. A LIFX view reads one
lighting snapshot, whose controller v1 part guards the general and lighting
controls alike. It shows the last color the bulb reported with its age, or
Unknown, and adds Color (hue and saturation) and Color temperature (kelvin within
the declared range) under Lighting. Each sends one `lifx-light` 1.0.0 request
through the hub's lighting route, built from a lighting read taken just before
sending, and never changes power or brightness. Color temperature keeps hue and
saturation, so the light looks white only at 0% saturation. A bulb without
qualified model evidence declares neither and shows one line for each section.

Mode controls preserve Work/Quiet/Free and Monitor/Media. Nanoleaf settings include
layout, coverage, element/project/task mapping and project colors. Each form
appears only when the `nanoleaf.integration/1.0` snapshot marks its operation
supported. A read-only device, such as the NL22 Light Panels
([codex-nanoleaf#113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113)),
marks all four unsupported. Its view shows one line naming them, plus the mode,
power, brightness and scene controls
([#323](https://github.com/jimmie-potts/agent-device-hub/issues/323)). Pixoo controls
include monitor filters and cadence. Advanced editors remain links. The UI never
translates these into a global mode or exposes raw commands.

## Device art

[Hub #355](https://github.com/jimmie-potts/agent-device-hub/issues/355) adds
the first hub-owned shared device art under
[ADR 0007](../../docs/decisions/0007-bunny-shell.md): the Nanoleaf component
pages draw the wall above the device facts with the wall map's Prism crystal
material, ported into [`src/art/`](src/art/README.md) with its provenance. The
Lines are crystal tubes between hexagonal connectors and the NL22 Panels are
triangles in the same material. The component sends nothing and opens no device
state; it keeps its own animation clock and selection state, and every animation
derives from its inputs, never from device frames.

The page reads each Nanoleaf component's saved layout once from
`GET /api/controllers/v1/<alias>/integration/geometry`
([codex-nanoleaf#169](https://github.com/jimmie-potts/codex-nanoleaf/issues/169))
through the same per-device queue as the 5-second poll, after the component's
first successful poll, and again after the next successful poll only when that
read failed. A device without a saved layout or an owner that predates the
route answers once for the session and the page draws a schematic strip, one
cell per element, that says why; so does a layout the hub accepts but the
renderer cannot draw, naming the rule it broke. Reload the page after changing
the layout in the wall editor.

The `nanoleaf.integration/1.0` snapshot supplies mode, project colors, element
reservations and pending wall edits. Colors follow the wall map: the status
color on both zones, and in the project layout style the signature zone takes
the reservation's project color. The snapshot carries neither which Line shows
which task nor that task's status, so the page passes no status or activity, no
Line pulses, and the caption says that no task is shown. The component takes
both as inputs for consumers that have a source; `tests/art.mjs` drives them in
a harness. A stale or unavailable snapshot keeps the last art with a stale mark
rather than an empty device. Selecting an element in the art also selects it in
the element mapping form; nothing is sent. Reduced motion skips the opening
assembly and stops the flow while Work, Quiet and Free stay distinguishable.
The wall status tokens `--wall-*` and `--chip-*` now live in the application
skin as fixed-meaning tokens. Locate, reservations and other controls on the
art stay on the wall map until their integration operations exist; measured
number placement stays there too, so numerals show on hover, focus and
selection only.

## Now playing

[Hub #37](https://github.com/jimmie-potts/agent-device-hub/issues/37) adds a
text-only Music entry when the dashboard context names a playback source, which
happens only when the credential grants that source. Launcher sessions always
have the grant. `PlaybackView` in `src/main.tsx` polls
`/api/playback/v1/snapshot` every two seconds, matching the source's read
cadence, and shows the title, artist, album, status, availability and
observation age. A stale snapshot keeps its last values with a warning, an
unavailable one shows no track, and `inactive` says AirPlay is not the receiver's
input. There is no artwork ([#229](https://github.com/jimmie-potts/agent-device-hub/issues/229))
and no source selection.

`playbackControls` in `src/client.ts` decides the buttons. They are the actions
the snapshot declares now, and they appear only for a control-scoped caller
while the source is available. Otherwise the view names the one reason, then
lists the actions the source does not offer, such as Play on the Sony
([#242](https://github.com/jimmie-potts/agent-device-hub/issues/242)). While
paused, the Sony source offers Next and Previous, the Sonos source also offers
Play, and the view warns that the receiver may keep the old title until playback
resumes. Each press runs the
shared command lifecycle. `playbackRequest` builds the command from a fresh
read, bound to the displayed source ID with a new request ID, or sends nothing
and names why. `playbackEvidence` maps the hub receipt: `sent` is accepted, a
receiver refusal changes nothing, and `uncertain` locks until an explicit
reload. Playback requests use their own API channel, so a playback command never
supersedes an in-flight monitor read.

## General controls

The component view offers power, brightness, saved-playlist selection, the
declared playback actions and saved-scene activation from the controller v1
capability object. Every control submits one guarded controller v1 command
through the existing hub route with the observed request ticket, configuration
revision and generation. A declared control that is unavailable is disabled and names the read-only
scope, stale or external-control evidence, or the device mode.
Only declared capabilities get a form; one line names the undeclared ones, such
as "Not declared by this controller: media and scenes." A component that declares
none of them, such as the Tidbyt or the synthetic sensor fixture, shows only "No
general controls" ([#330](https://github.com/jimmie-potts/agent-device-hub/issues/330)).
Power is one button that names the action left: Turn off while the desired
power is on, Turn on while it is off; with desired power unknown it uses the
last observed value with its age, and with both unknown it offers both buttons
and says "Current power is unknown", so an unknown state is never presented as
On or Off and no guessed value is sent. Disabled buttons use their own skin
tokens rather than transparency.

Pixoo declares screen power, brightness 0–100 and media with pause, resume, stop,
next, previous and clear plus discovered playlist IDs, checked at Pixoo `main`
`c81bc31c59068e00bf9d15a81577863ba9446931`. Controller v1 modes are unsupported
there, so the Pixoo Monitor/Media mode control uses the delivered integration
extension's mode operation with its own ticket, revision and generation guards.
The browser fixture declares the same capabilities. Playlist selection and
playback actions are disabled while Pixoo is in Monitor or a mode change is
pending. The view names the reason and offers one explicit "Switch to Media"
command through that mode control; returning to Monitor uses the same control.
No command changes the mode as a side effect, nothing restores automatically,
and the hub stores no baseline and runs no timer. Screen off pauses playback and
screen on does not resume it. Playlists are listed by ID until
[Pixoo #67](https://github.com/jimmie-potts/divoom-app-upgrade/issues/67)
supplies user-entered names.

The brightness slider starts from desired evidence, then observed evidence,
says when the current brightness is unknown, and sends once when released.
Choosing a playlist, the playback actions and the Media switch are one-click
commands. Like every command, they read the device again just before
sending (see below) and stay busy until the refreshed snapshot arrives. Only an
accepted ticket is watched for its terminal outcome; a rejected ticket may be
consumed by another client. A typed rejection is shown and the action stays
available. An uncertain result locks the group until "Reload current values".

Pixoo can be configured for Monitor without presenting it, for example after the
app restarts or the screen turns off and on. The Pixoo mode form then offers
"Start Monitor". It sends one integration Monitor mode command with that
extension's guards and no media command. It is disabled while desired screen
power is known to be off, because Pixoo `main` `01da65d` starts presentation only
while the screen is on. Physical acceptance on the display is
[Hub #154](https://github.com/jimmie-potts/agent-device-hub/issues/154).

Nanoleaf declares power, brightness 0–100 and discovered saved scenes on
controller v1, checked at Nanoleaf `main`
`80628498136203a8f5fcb06ab5fa306e961e2def` ([Nanoleaf #64](https://github.com/jimmie-potts/codex-nanoleaf/issues/64)),
the revision the hub's Nanoleaf fixtures pin; media, zones and preview stay
unsupported and the browser fixture declares the same. Power and brightness work
in Work, Quiet and Free. A brightness command is a user override: the view shows
a known desired brightness as an override that persists until the next explicit
mode command, which reapplies that mode's brightness policy, and shows no
override as unknown rather than as a value. While power is off the wall keeps
tracking tasks and writes nothing until the next mode command. The mode form
offers "Reapply <mode>", one controller v1 mode command for the observed mode.
Nanoleaf `main` `08b6b83` ends power and brightness overrides on any mode
command, including the same mode. When there was nothing to reapply, the
controller admits and then cancels the command with no effects, and the view
says the mode is already in effect. Admission still advances the configuration
revision, so other open drafts on that device show a conflict. Only this action
reports a cancel as already in effect; any other cancel is shown as not applied.
The action is disabled while a mode change is pending.

Scene activation is disabled while the wall is in Work or Quiet, while a mode
change is pending or while the mode is unknown, with the reason and one explicit
"Switch to Free" command through the existing controller v1 mode control;
returning to Work or Quiet uses the same control. The scene list comes only from
the controller v1 `scenes` capability, labelled by the user-chosen Nanoleaf app
names the `nanoleaf.integration/1.0` snapshot supplies and by ID otherwise;
browser and hub configuration contribute no scene identities or names. Activating
a scene is one guarded command that starts no polling and changes no mode. A
scene the controller rejects because its mode changed after the browser observed
Free is a typed failure that stays available for a fresh explicit action.
Physical acceptance on the installed wall is
[Hub #155](https://github.com/jimmie-potts/agent-device-hub/issues/155).

## Intent and observation

Just before sending, every command reads the device again through the same
per-device queue. It uses that read's server-issued ticket, configuration
revision and generation, and re-checks the control's availability. A failed
read or a control that is no longer available sends nothing and names the
reason. A generation retires output work and advances without any client edit,
for example on every Pixoo playlist item or when Pixoo suspends its
presentation. The Nanoleaf integration forms keep their content revision guard.
A `stale-generation` or `revision-conflict` after the fresh read has no
effects. It is shown with an invitation to change the control again, and
nothing is resubmitted.

Refreshes preserve focus, selection and an unsent text draft. A control that
sent keeps keyboard focus: while a command runs its group is disabled, and once
the command settles focus returns to that control, or to the group's first
enabled control when the control is locked or no longer rendered. Once the
result and the refreshed snapshot arrive the control shows the current value
again, so it is ready for the next change and a rejection is visible as the
unchanged value plus its status. An uncertain or partly applied result,
including one observed later, locks the form or group and is never retried.
"Reload current values" is the separate explicit action that unlocks it. A
failed fresh device read before sending sends nothing and frees the control. A
failed refresh after a result keeps that result and resends nothing; the next
gesture reads current guards again. A second activation while a command is
running sends nothing, including from the other instance of the same control. Status text says
whether a command was queued, sent, saved, already in effect, not applied or
unknown, names the typed code, and never presents transport success or a saved
setting as physical output.

The bounded authenticated change feed requests current monitor snapshots on state
or resync events. A stream reconnect uses its last cursor and backs off up to ten
seconds. Periodic reads recover observations; reads and writes share a bounded queue per
device, with pending explicit writes ahead of polling. Devices remain independent.
Definite pre-admission rejection retains an editable draft; partial receipts retain
completed operations and known effects. Terminal integration outcomes update the
submitted form. Target selection loads that target's current mapping or color
without making an edit. Failed reads retain prior evidence with a
stale warning. Observation age grows independently of successful transport reads.
Opening, selecting, filtering, reconnecting and receiving snapshots issue no
commands.

## UI provenance and validation

The starting point is Nanoleaf `main` at
`f12ac6653a9f3267fa9ef62a2d6667072183d8b3`, including approved Prism renderer
[PR #58](https://github.com/jimmie-potts/codex-nanoleaf/pull/58) and numbering
[PR #60](https://github.com/jimmie-potts/codex-nanoleaf/pull/60). The dashboard carries
forward cyan selection, magenta pending states, compact controls, a quiet grid,
local Bahnschrift/Segoe UI typography and focus-preserving interaction. It does
not copy wall geometry, physical Locate controls or animation rendering. This new
candidate requires its own explicit human approval. The Hub #151 and Hub #153
general-control candidates require renewed approval, recorded in their PRs.

`npm run test:dashboard` checks command guards and links, every command
lifecycle transition for both the form and the action wording, the route parser
(home aliases, the `activity` and `connections` alias collision, round-trips and
missing addresses), the widget catalog and home placement, and the token
boundary of the authored styles.
`npm run test:dashboard:browser` starts disposable hub and fake-controller fixtures
and checks control, no-write inspection, heterogeneous components, reconnect,
expired cursors, slow devices, concurrent edits, terminal and uncertain outcomes,
known observations, external control, focus, keyboard, reduced motion, responsive
layout and automated accessibility. The Hub #151 matrix scenarios add guarded
general commands in Media, Monitor gating with the explicit switch and a pending
mode, concurrent edits with typed conflicts and locked uncertain actions, and
read-only or undeclared capabilities with named reasons. The Hub #153 scenarios
add Nanoleaf power and brightness in Work with the override hint, Work gating
with the explicit Free switch, one guarded scene command with a preserved
selection and focus across reconnect, keyboard focus kept through the Free
switch, a scene activation and a locked draft form, and a controller-side scene
rejection, revision conflict and uncertain result with no retry. The Hub #323
scenario adds a read-only Panels component next to the Lines. It checks the
controls that remain, the absent configuration forms and their one line, one
guarded scene and brightness command with no extension write, a configuration
operation withdrawn before sending that sends nothing, phone width and automated
accessibility. The Hub #289
scenario (`tests/local-controllers.mjs`) runs the real local controller host with
fake Tidbyt and LIFX transports behind the real hub. It checks the Tidbyt view's
no-controls line, LIFX power, brightness, color and color temperature, one
guarded lighting request per change with no power write, an unqualified bulb, a
bulb read as off, a bulb with unknown power, an unreachable bulb, a read-only
credential, phone width and automated accessibility. `tests/layout.mjs` fails
any visited view whose text blocks overlap, ignoring the content of closed
disclosures, and measures how far a view's controls reach across the main
column; the browser, Pixoo, wall and synthetic views use it too. The Hub #277
checks in `tests/browser.mjs` assert that every component widget, its quick
actions and the sessions widget start in the first screen at 1440 px, that the home, wall and
pixel controls reach at least 70% of the main column, that the Connections
cards sit side by side, that the wall and pixel pages are under 2,000 px tall at
1280 px, and that routes, the back button, the alias collision and an unknown
address behave as the README describes. One matrix scenario sends a mode and a
power change from the wall widget with fresh guards, shares an uncertain lock
and a running command between the widget and the page, sends a session label by
leaving its field while the filter survives navigation, and checks the skip
link. Another drags the brightness slider with a pause and asserts one command
carrying the released value, steps a select twice from the keyboard and asserts
one command with the option stopped on, submits a Monitor view field with Enter,
keeps an invalid Project ID unsent, and sends a project color only when the
picker closes. `DASHBOARD_RECEIPTS` selects an external
receipt/screenshot directory. Samples include event-to-rendered-snapshot latency
for Hub #30; a small synthetic sample is not full performance qualification.
Hub tests additionally check protected context, native credential exclusion,
static-asset protections, invalid links, packaged installation and that general
commands are validated and scoped before any controller request. Source/browser
checks do not establish installed-client or physical acceptance.
`tests/art.mjs` (Hub #355) draws the Lines from a 15-Line, 12-connector fake
layout with reservation colors, labels, keyboard selection and one geometry read
per session, keeps the art marked stale while the controller is offline, draws
the Panels from an 18-triangle fake, draws the schematic strip for a device
without a saved layout, for an owner that predates the route and for a layout
the renderer rejects, retries a failed geometry read after the next poll, runs
axe at 1280 px and 390 px, and drives status, activity, mode, stale, the
opening assembly and reduced motion through a component harness. `tests/art.test.mjs` covers the adapter and the
ported layout validator. The candidate needs the owner's side-by-side approval
against the wall map on the same fixture before merge.

The activity view requests snapshot 1.1 and keys each task form by identity and generation. A recreated task discards the old label and acknowledgment drafts, even after a missed removal. Ordinary reconnects retain drafts and focus. The retirement browser scenario covers parent/child removal, empty reconnect and missed-removal draft reset. This UI behavior requires human approval of the current candidate in addition to automated checks.

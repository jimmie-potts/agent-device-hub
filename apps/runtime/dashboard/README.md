# B.U.N.N.Y. dashboard on the runtime

The B.U.N.N.Y. dashboard served by the [runtime](../README.md)'s gateway
([Hub #922](https://github.com/jimmie-potts/agent-device-hub/issues/922)). It is
a copy of [`apps/dashboard`](../../dashboard/README.md), which remains in the
stopped old Hub for manual return until separately authorized retirement (#839); [PROVENANCE.md](PROVENANCE.md) lists
what was copied, from which commit, and what changed. The React/TypeScript page
reads the core's agent sessions through the SDK's sync and follows their live
changes ([ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)). It
polls nothing and replays nothing: after a lost stream it syncs again and shows
the core's current state.

The runtime copy includes:

- the Quiet glass shell, its retained hash routes and Places links inside Settings;
- browser sign-in on the runtime's gateway: a bookmark with trusted loopback
  sign-in, or the launcher's one-time code;
- the agent sessions, synced from the core, with a finished turn shown unread
  until the session record clears it;
- general device cards and guarded controls, music, declared module pages and a running build readout;
- the home that the owner-approved mockup lays out ("Recommended (d)", owner
  decision 7, 2026-10-06), with panels for the Hub mode (#924) and the inbox
  (#923).

The module-owned Wispr page and numeric home widget read selected collector files
on demand when browser exposure is enabled (#927). They do not subscribe to an
analytics event family. The Automation page manages event rules and shared weekly power schedules.
Weekly schedules select a configured power-capable device, weekdays and same-day
on/off times on the Hub clock. New schedules are disabled; enable/disable is
separate from editing. Next-switch evidence is labelled as of the last explicit
refresh, while SDK copies supply current tracked outcomes and timestamped device
observations. An accepted command never establishes an observed lamp state. A lost mutation
reply locks further edits until explicit refresh, without retry. The Hub runs the
schedule with the page closed, skips missed boundaries and never restores an
on window after an early manual or device-limit off. Schedules require a running
Hub and reachable target; device maximum-on protection is a separate feature. Device-specific
feature pages remain their own module stories.

The same dashboard can use the optional [home-Wi-Fi HTTPS entry](../WIFI.md).
It keeps the existing controls and browser sessions; its HTTPS cookie is Secure.
The forwarder's owner password prompt precedes the ordinary dashboard sign-in.
Actual phone/certificate verification is separate from desktop browser tests.

## Pages, routes and widgets

The primary rail has **Home, Habitat, Rooms, Devices and Automation**. Settings is a
separate corner link; it contains Connections (including build/operator tools),
Places and Disconnect. An ended browser session still offers **Sign in again**
globally. Home links Timeline. Devices groups catalog-derived Lighting,
Displays, Audio and Other destinations; module pages keep their sibling links
locally. The category choice survives navigation within the open page without
being saved as a new preference. Unknown modules use Other, and unavailable
catalog or observation evidence stays explicit. Browsing sends no device command.

`navigation.tsx` shares native anchor navigation and containing-destination
selection. `directory.ts` projects the existing copies without acquiring state.
`skins/quiet-glass.css` supplies light/dark semantic values over the retained
fixed attention/art tokens; `shell.css` owns shared responsive geometry. The
legacy dashboard and documentation keep their own skins. A theme picker is
separate future scope.

Every page has a hash address: `#/` (also `#/home` and `#/activity`) for the
home, `#/devices`, `#/settings`, `#/lights/<brand>` and `#/rooms` for lighting, `#/audio`, `#/connections`, `#/component/<device>`, `#/music/<source>` and
`#/module/<module>/<page>`. `src/routes.ts` parses a hash into a discriminated
route, so built-in pages and component aliases are distinct kinds and an alias
of `activity` or `connections` opens only that component
([#247](https://github.com/jimmie-potts/agent-device-hub/issues/247)). A
navigation link applies its route in the click event, ahead of the browser's
deferred `hashchange`, so two pages are never shown at once, and the back button
walks the history. An address that names nothing shows a not-found message and sends nothing. The launcher's
`#launch=` fragment is not a route: the page removes it before it exchanges the
code.

`src/widgets.ts` declares the core widgets and their default sizes. `src/home-catalog.ts`
adds the current reusable device, light/group, room and Music instances, together
with availability and supported sizes. The editor reuses the existing adapters,
shared authenticated connection and module-owned frontend entries.

The optional MicroDuck card uses the companions frontend through that same scope.
Choose one Reachy–Duck conversation on Companion knowledge, save it with **Show
selected conversation on Home**, then add MicroDuck through **Edit Home**. The
card shows one latest meaning and its original time; **View conversation** opens
bounded history separately. Selection and records remain with companions. Reads
produce no output; stale or denied content is hidden, and playback stays unknown
without qualified evidence. See the [module guide](../../../modules/companions/README.md#duck-home-widget).

### Customizable Home

Choose **Edit Home**, then **Add card** to browse by category. Move cards with the
handle or the earlier/later buttons; arrow keys on the handle provide the same
ordering. Choose a supported Small, Standard or Wide size, Hide or Remove. Hidden
cards remain in the saved arrangement and can be shown again; removal affects
only that arrangement. Desktop and Phone have independent orders and sizes.
Adding a card appends it to the other arrangement if absent. **Cancel** discards
the draft, **Reset** restores that breakpoint's built-in defaults, and **Done**
saves both through the core's revision-guarded `home-layout-set` command.

The versioned `home-layout` record lives in `modules/core.sqlite`, with IDs,
sizes and flags only. Reload, another browser and restart read the same state;
no layout is stored in localStorage. A concurrent change requires loading and
reviewing the current layout. An accepted reply is not a saved result: the page
waits for synced metadata and successful completion, and an uncertain save is
never repeated automatically. Existing light grouping/ungrouping and room Home
actions reconcile saved placement in their original core transaction.

Editing makes card controls inert. Moving, resizing, hiding, removing, Cancel
and Reset send no command; Done changes metadata only. Hidden module cards
unmount their scoped reads and subscriptions. Core-wide evidence remains synced,
so unresolved Inbox items and agent attention keep their ordinary cards visible
until cleared. There is no separate notices section. A source that disappears
stays unavailable; a retired widget definition is omitted with one report per
saved revision and no automatic repair write. Wispr appears as available only
when its existing browser exposure is enabled.

The reusable `HubModeCard` receives the synced choice, matching mode artwork,
three action callbacks and concise exception evidence from `HubMode`. Clicking
the selected mode explicitly reapplies it. Routine request text, device lists,
Latest request and a separate Reapply control are omitted. Related unhandled
mode issues appear as a corner **! Check Inbox** control, with the Hub surface
unchanged. Opening it expands and focuses a related Inbox entry without handling
it. Handling clears the indicator after shared removal; a later selection clears
it only after definitive success for the affected scope. Acceptance or a saved
choice alone cannot clear it, and historical Inbox entries remain until handled.
Stale copies retain known issues. Local refusals without an Inbox item stay
explicit. No adapter acquires another connection or changes backend ownership.
If recent operation projections retire, a retained device-mode issue stays
reviewable after reload. Its corner explanation and accessible feedback say
when the link to a Hub selection is unavailable. A known independent native
request is excluded while its evidence exists; absent evidence cannot prove
independence. Later target success must come from a successful Hub request sent
after that issue was created. This conservative fallback adds no history read
or persisted browser state.


`InboxCard` and `InboxItemCard` supply reusable presentation over `InboxPanel`'s
existing synced records and guarded actions. Concise device/action/result faces
expand for evidence, Send again and Dismiss. Native disclosure and warning
navigation send no command. Accepted handling waits for shared removal and a lost
reply stays uncertain without automatic retry. Read-only sessions inspect evidence
without write controls. Device holds, display dismissals and agent unread turns
retain their separate meanings. Reload, reconnect and restart never resend.

## Reusable Wemo card

Home and existing Wemo device routes use the same `WemoCard` presentation and
`WemoDeviceCard` adapter. A large generic desk lamp and smaller Wemo plug remain
visible while Power and Auto-off tabs switch only the controls. Both panels stay
mounted and share their layout space, preserving drafts and card dimensions.
The selected On/Off button follows plug-reported power; desired state and command
acceptance do not select it. Unknown, stale, unavailable and held evidence remain
explicit. Read-only sessions can inspect both tabs without editing.

The adapter retains the existing tracked power/hold-release commands and uses
`PowerLimitPanel` with concise presentation. Saving is explicit; changing tabs
sends nothing. Weekly schedules stay in Automation. Routine power/reporting,
Smart plug, Armed and standing warning text are omitted from the control face.
Collapsed **Device evidence** retains observation age, desired versus observed
power, outcomes, run/deadline/attempt evidence and Hub/reachability limitations.
The illustration identifies a load; it does not establish visible lamp output.
General placement and plug-to-room assignments remain separate work.

## Reusable Music card

`MusicCard` supplies the glass presentation. `PlaybackCard` adapts the existing
playback observation, capabilities, authenticated artwork and retained command
attempt. `PlaybackWorkspace` composes it on Home, Audio and selected Rooms;
`#/music/<source>` deep links remain valid. Album stays below artist, with audio
output below transport. Output is **Not reported** because the playback contract
does not identify the presented speaker. Stale observations retain last-known
text with an exclamation header; unavailable observations clear metadata.
Unsupported controls stay disabled, including Sony resume from pause.

On Audio, **Show in rooms** saves explicit card placement in existing rooms.
It can place the same shared playback card in several rooms; this does not select
a speaker, change AirPlay output or create independent room playback. The core's
private `playback-layout` metadata survives browser and runtime restart. Current
lighting-layout room IDs remain authoritative, so deleted rooms render no card.
Read-only or stale copies and unresolved saves disable editing. After a failed
or uncertain save, refresh before editing again. Refresh reads
current records without replaying any save or playback command. General Home
layout editing and audio routing remain separate work.

## Reusable Pixoo controls

Home, the Pixoo device page and Player mount the module's `PixooDisplay` through
`ModuleFrontend`. They share the shell's connection, authentication and retained
command attempts. The module owns media reads, playlist drafts and playback
controls; the shell owns the glass styles. Display/Content tabs retain artwork
and drafts, with keyboard navigation and reduced motion. The device and Player
pages retain advanced controls, and other module pages remain reachable.
All controls for one target share the shell's pending attempt, including a lost
HTTP reply without an operation record. Opening advanced controls or switching
pages preserves that lock; a completed older request cannot clear its identity.

See the [Pixoo frontend guide](../../../modules/pixoo/README.md#frontend) for
bounded animated previews, populated playlist creation, looping and explicit
restart. Source browser checks use synthetic media and simulated devices;
installation and physical-display evidence remain separate.

## Reusable lighting

Rooms also reads manually prepared private 3D models from the core. A room's
3D button opens local orbit/zoom and cutaway inspection. Fixture buttons select
the existing individual LightCard using current room membership, unique device
identity and exact owner; an unbound, missing or reassigned fixture stays visible
with its reason and cannot send a command. Stale layout/device copies retain
the ordinary lighting guards. Selection, camera changes and reconnect send no
light command. Reported power is shown schematically; neutral materials do not
mirror per-zone animations, scene colors or physical illumination. WebGL failure
retains the fixture list and existing controls.

### Prepare a private model

Under the runtime state directory, the core owns
`modules/core/room-models/catalog.json` and `<model-id>.json`. Keep the original
GLB and editing source in an unserved `source/` folder beside those files.
All real geometry, measurements, names and bindings stay outside Git, build
output, GitHub and CI. Use owner-private directories (0700) and single-link
regular files (0600), with no symlinks. Do not read the live core SQLite file
from another process. Create/assign a room using the existing Rooms interface
or its revision-guarded layout command.

The catalog is `room-model-catalog/1.0` with at most 32 distinct `{id, roomId}`
entries, one model per existing room ID. Prepared files use `room-model/1.0`
with the same `id` and `roomId`, `calibration` (`wallLengthMeters`, measured or
estimated `source`, and `otherDimensions: estimated`), `anchors` and `scene`.
Each anchor has a stable `id`, display `label`, meter `position: [x,y,z]`,
mesh `group`, and either both `deviceId`/`owner` or both `null` for unbound.
Aliases never rename routing IDs. A device may bind only once per model.

`scene` supplies positive meter `width`, `depth`, `height`, up to 64 materials
(`color: [r,g,b]` in 0–1 and `roughness` in 0–1), and up to 128 batches.
Each batch has `group`, material index, triangle index `count`, and base64
`vertices`/`indices`: little-endian interleaved Float32 position XYZ/normal XYZ
(24-byte stride), and Uint16 triangle indices. Use +Y up. Semantic wall groups
`wall-left`, `wall-right`, `wall-front`, `wall-back` support cutaway at X=0,
X=width, Z=0 and Z=depth. Fixture groups match their anchors. There are no
external URLs, scripts or textures. Prepared JSON is capped at 2 MiB and
100,000 triangles; each batch has at most 65,535 vertices. Invalid files leave
ordinary room controls available. The pure validator in `src/room-model.ts`
under the runtime owns the exact closed data contract.

Authenticated core content references are `room-model-catalog` and
`room-model-<id>`; they accept no query fields. Refresh 3D models rereads private
content explicitly, while device state follows the existing SDK connection.
The page never exposes a filesystem path. Installation and physical acceptance
use their separate existing procedures.

`LightCard` renders the same glass surface on Home, brand pages and Rooms.
It receives a resolved target, capabilities, artwork, options and an action
callback. Power, Color, Scenes and Timer tabs replace only the controls; the
artwork stays mounted. Arrow keys, Home and End select tabs, and reduced motion
removes the flip. Drag handles and the Group with selector perform the same
layout edit. Each brand has its own grouping scope; Home permits mixed brands.

`lighting.ts` resolves device, custom-group and current room membership and
prepares guarded actions only after every member passes freshness, ownership,
capability, hold and operation checks. `LightingWorkspace` owns composition and
binds each light to the existing retained-attempt hook. It never creates a
second participant or retries an uncertain action. Per-light outcomes remain
separate: a group is not an atomic device transaction. Advanced device and
module routes retain mode selection, hold recovery and wall editing.

The core owns `lighting-layout` and the tracked operator command
`lighting-layout-set`. Rooms, assignments, groups and Home selections live in
its private database, with revision-checked atomic replacement. The empty layout
uses automatic discovery; explicit Home selections can include room cards.
A room resolves its current assignments even after adding it to Home. Removing
its Home card preserves the room. Missing device references stay visible and
block group commands. A conflict requires reading the current layout before a
new explicit save; lost replies retain their request identity without replay.

Only declared module capabilities enable controls. The qualified LIFX model
supports color and temperature; temperature preserves saturation, so Use white
is a separate explicit color command. Beam remains unsupported. Scenes are
native IDs common to every member in its current mode; no sample mood is sent
to hardware. The Timer tab explains that off timers are unavailable. Nanoleaf
exports its read-only artwork component through the public frontend entry and
uses saved geometry. Other artwork and missing geometry use labelled placeholders.

## Module interfaces

The authenticated module catalog and static browser build jointly select each
React page. A missing component, unavailable module or undeclared route opens
no fallback destination. Module-owned browser entries export `frontend` from
their package's explicit `./frontend` subpath; the existing esbuild step collects
them without importing Node registrations. The SDK's type-only
`@jimmie-potts/sdk/frontend` entry defines their component context.

`src/module-page.tsx` supplies the shell's UI, connection evidence, scoped
authenticated API and tracked operation records. `DashboardConnection.openModule`
creates an inert page scope; its first read, sync or command registers it with
the connection. Unmounting or ending the session aborts reads and closes active
and late sync copies. Each copy follows that module's declared owner on the
existing participant. Opening a page creates no second connection or command.

`src/command-control.tsx` holds the existing command-attempt behavior shared by
device cards and module forms: explicit send, retained request identity,
accepted versus completed/uncertain status, and no resend after reload. Feature
forms use the context's `Command` component and still require current control
authority and operation evidence.

Pixoo's Library form uses that same command component for a bounded binary
upload. Choosing a file changes only the draft; Add media sends once, and the
catalog refreshes from the completed owner operation. Files remain in page
memory and are not restored or resent on reload. Read-only callers can browse
the catalog but have no upload controls.

Pixoo also contributes Playlists, Player, Monitor and Settings. Referenced
previews stay within the feature pages. Draft edits and page opens send no
command; explicit saves and controls use tracked outcomes. Monitor dismissal
is Pixoo-only, and session labels use the shared Sessions page. Settings exposes
the safe configuration for inspection and keeps file-based setup separate from
brightness and screen commands.

Tidbyt exports the same read-only glass card on Home, its device page and
`#/module/tidbyt/display`. Status shows the owner's cloud availability and last
known transmission, with stale evidence marked; Content explains automatic status
and optional now playing. Its labelled 64×32 illustration stays mounted across
tabs. No display control or exact/physical preview is implied. The adapter closes
active and late copies through the existing shell scope.

Passive pages keep their script-free frame. A declared trusted editor uses an
application frame under the gateway's trusted asset policy. It is reviewed
same-origin application code, not an untrusted extension sandbox. User media
remains on the separate non-executable content route.

## Reachy

`#/module/companions/reachy` opens the optional fixed-text companion page.
Reachy defaults to disabled. Enablement, category mute, social snooze and labelled
synthetic arrival/visit fixtures use the existing tracked command component.
Cards show source/session, real coding metadata or simulated scenario, evidence,
fixed text and the last decision reason. A published card is not proof it was
seen; restored cards are history. Core session attention remains available on Home.
Run `npm run test:companions:browser` after the root build for persisted controls,
priority and attribution, reconnect, keyboard, narrow-screen and axe checks.

## Agent sessions

`src/connection.ts` holds the page's one remote participant, acting as the
browser's session (`bunny/parts/dashboard`) through
`@jimmie-potts/sdk/remote`. It syncs the core's `session` family and follows its
live changes:

- **Sync.** The first sync, and every sync after a lost stream, replaces the
  page's copy with the core's records at its revision. Except when the browser
  session has ended, a refused sync or a copy that stops because a later sync
  failed is tried again after 1 s, doubling to
  30 s; the page keeps showing the last records it had, marked stale.
- **No replay.** A lost stream reconnects in the SDK, and the copy syncs again.
  Occurrences the page missed, such as a turn's end, are not played back: the
  page shows the current records, which carry each finished turn's unread state.
- **A session that ended.** When the runtime refuses the browser's session, as
  after Disconnect in another tab, an eviction, its expiry or a runtime restart,
  the SDK client reports `remote.refused`. The page then stops, keeps its last
  records, says the session ended and offers **Sign in again**. An
  `unauthenticated` or `forbidden` sync answer ends the link too. It never signs in
  by itself.

`src/sessions.ts` derives names, chip priority and evidence from each record.
`AgentStatusCard` takes a derived row, live evidence, a clock and an optional
action slot; it acquires no connection and sends no command. `AgentStatusSummary`
can render independently. `AgentSessions` composes both with search, provider
filtering and the existing guarded label editor over the shell's one session copy.
Home supplies its widget frame; other containers can reuse the components without
starting another feed.

Card faces show the label (then title or native ID), project/client and state.
Approval, input and question attention add amber highlighting and text. Native
card disclosure reveals freshness, attention lines, retained notices and their
acknowledgments, source/session/activity/read/parent/child evidence and optional
label editing. Collapse and filtering retain drafts; replacing a generation
retires them. Read-only callers see the same evidence without label controls.
Stale/disconnected cards say **Stale**, retain their last-known state in the
expanded evidence and contribute no current Working count. Needs you and Unread
counts describe retained evidence across the full copy, independent of filters.
No separate attention box is placed on Home. Inspecting a card never clears a notice.

A finished turn shows **Finished · unread** until its record carries positive
read evidence, any consumer's acknowledgment, or a later known turn. Ending the
session removes the row. Missing read evidence or an unknown turn never counts
as read. The page never clears a finished turn itself or on a timer, and has no
row acknowledge button (owner decision, 2026-10-08). Clearing a notice on every
device is the confirmed **Clear this notice on every device** override in Connections' **Operator
tools** section (#1009). Select a session and confirm its current notice. Control authority and
current synced session evidence are required; a changed notice or revision is refused. Requested
state, the accepted or uncertain reply, operation completion and the synced consumer acknowledgments
remain separate. The result comes from those records, never an accepted reply alone. The override
acknowledges all configured consumers atomically, preserves consumer self-acknowledgment, and proves
no provider readership or physical-device result. Lost replies, reload and reconnect never resend
it.

## Sign-in

Sign-in, launch exchange, logout, authority reads and Places reads each carry a
fresh W3C `traceparent` from the SDK's browser-safe trace helper. The gateway
continues it only after authentication, ownership and input checks. Missing or
invalid context starts a root; context never grants authority. The five calls
have bounded server spans, with no cookie, launch code or request body recorded.

The gateway serves the page at `/` without a session, and every route after
that needs one. A browser session is an `HttpOnly`, `SameSite=Strict` cookie that
all tabs of the origin share, so the page never holds a token. On load the page
asks whether the browser already holds a live session
(`GET /api/v2/authority?scope=read`), so a reload or a second tab opens no new
one. Without one it asks for a browser session from trusted loopback or the authenticated home-Wi-Fi entry
(`POST /api/v2/browser/session`) when the runtime's edge section sets
`browserAccess` to `trusted-loopback` or the request uses the authenticated Wi-Fi entry, and otherwise shows the launcher's page.
The launcher opens the page with `#launch=<code>`, which the page removes from
the address and exchanges once (`POST /api/v2/browser/launch`). Every change
the page makes carries `bunny-request: 1` and its own `Origin`.

**Disconnect** ends the browser's session (`POST /api/v2/browser/logout`), in
every tab of the origin; the page then offers **Sign in**. If both tabs sign in
again, they reuse the same live session, so a later Disconnect still ends both.
When the gateway creates a replacement session, it ends the old cookie's session
and streams first. The old dashboard
logged a page's own session out as it unloaded; with one shared session the
runtime copy does not, since that would sign out every other tab.

A link on another local app's page with the same host name, such as the wall's
B.U.N.N.Y. link, opens the page signed in. Another site's page, a frame and a
fetch from another local app are refused, and the page's opener policy keeps a
page that opened it from driving it again (Hub #561).

## Session labels

Each current session row offers **Edit label**, **Save label**, **Clear label**
and **Cancel**. The editor starts with the explicit label; a provider title is
only the displayed fallback. Save and clear use the authenticated generic
command route with a fresh request ID and the synced session revision. Clear
restores the provider title or native session ID and acknowledges no notice.

Requested, accepted and confirmed by the synced record are distinct. Stale
copies disable writes; a conflict keeps the draft for another explicit attempt.
The page never retries or resends a write after a lost reply, reconnect or reload.
A replaced session generation retires the old editor. Labels survive runtime
restart through the existing core owner storage.

## Places

The Places navigation inside Settings reads `docs/skins/places.json`. Public places link to the
published guide. On the installed runtime, which serves B.U.N.N.Y.'s own place
port, a Local place links to the runtime's place link for it
(`GET /api/v2/links`) or else to the manifest's address. Anywhere else, such as
a disposable verification run, the page is a preview (Hub #495): a Local place
appears only where the runtime's links name it, so a preview never leads to an
installed service.

## Visual foundation

The [application UI style guide](../../../docs/application-ui-style-guide.md)
records the shared semantic roles and fixed state meanings. The runtime's
[`Quiet glass skin`](src/skins/quiet-glass.css) supplies the accepted light/dark
shell values over its retained Neon base. Layout CSS reads role and private
token names. The session dot and chip keep fixed-meaning attention colors;
colored chips have a contrasting surface while neutral Idle uses the ordinary
inset surface. Device artwork keeps its own material and status meanings.
Control faces retain their card-flip motion without fading text below contrast;
reduced-motion appearance removes the animation.

## Build and checks

`npm run build` builds the page with `apps/runtime/dashboard/build.mjs` into
the runtime's `dist/dashboard/`, after the SDK and the event contracts. The
source follows the runtime's [strict profile](../../../docs/development.md#strict-profile-for-new-code),
tests included; `src/` type-checks for the browser and `tests/` for Node, which
runs the tests' TypeScript as it is. See
[Runtime dashboard checks](../../../docs/development.md#runtime-dashboard-checks).

The focused label/reload journey runs with
`node apps/runtime/dashboard/tests/session-label.browser.ts` after a build.
It shares its label assertions with the full `browser.ts` suite and checks
conflict drafts, explicit retry, Clear, keyboard focus and desktop/phone axe.

The focused artwork journey runs with
`node apps/runtime/dashboard/tests/playback-artwork.browser.ts` after a build.
It uses the real playback owner and decoder with synthetic speakers and PNG
bytes. Its pixel oracle and acquisition/command counters check the shared Home
and Audio card; synthetic browser evidence is separate from the installed
runtime identity and served browser build.

## Devices, music and operations

The authenticated module catalog names every device owner. `runtime-feeds.ts`
keeps one SDK copy per owner, alongside core operations and playback, using the
existing participant. Desired state, device observation, queued kinds, last
transmission and held state stay separate. A failed owner remains visible as
unavailable; a lost stream keeps records stale until their own snapshot returns.

Home, Audio and assigned Rooms share optional playback artwork above the track,
artist and album. Music deep links use the same card.
The current synced SDK owner must map to one running catalog module that serves
playback. A native same-origin image uses the existing browser session and an
opaque generation/revision reference; it reads no receiver URL or inline image
payload. Owner, record and reference changes retire the image subtree and its
callbacks. Loading or refusal leaves text, supported controls and operation
evidence usable; image events send no command or retry. Decorative artwork has
empty alternative text and adds no keyboard stop.

Home keeps the existing mode/power quick controls; the device route exposes
brightness, scenes, zones, media and manual moments only where declared. Each
explicit general command includes the current configuration revision and generation.
Playback uses its current revision. Nanoleaf content requires Free and Pixoo
content requires Media; selecting content never changes mode. Nanoleaf Lines
advertises bounded moments over supported Work rendering or a restorable named
Free scene; other devices keep their declared capability limits. The module's
existing single writer owns moment playback and safe restoration.

Automation (`#/automation`) manages fresh event rules, the Work interrupt set,
quiet hours and budgets, and shows the log beside current tracked outcomes.
Creating a rule leaves it disabled until an explicit enable action. Reads on
entry or refresh send no device command; edits require control scope and never
retry after a lost reply. Rules run in the core even when the page is closed.

The existing authenticated action route sends each attempt once. The card shows
requested, then accepted, then the operation record's completion and effect
evidence. A local refusal means nothing was sent; a core refusal means the
request was refused without changing state. Transmitted success is not physical
observation. Failed, uncertain and conflicting results remain visible.

Uncertain attempts lock ordinary controls across navigation and reload. Session
storage keeps only attempt identifiers, not payloads or credentials. **Refresh
current state** resyncs records and sends no command. Definitive operation
evidence can release the lock. A held Nanoleaf device keeps its held warning and
offers its existing explicit guarded mode command to release the hold. Nothing
automatically retries or replays. Read-only sessions have no write controls.

## Module pages, build and disposable preview

Navigation takes only exact same-origin page paths from module declarations.
React pages use the shared shell context. Passive HTML uses a sandboxed frame
with scripts and forms forbidden. Trusted editor frames run reviewed, declared
application scripts under their separate content policy; they are trusted
same-origin code. The shell itself cannot be framed. Unknown pages show not
found. No private file or installed-service fallback is used.

Connections, reached through Settings or its retained bookmark, reads `/api/v2/build`: the serving process's frozen package version,
source revision, build time and dirty flag, with unavailable identity shown as
unknown. The build step creates that identity, not a Git command per request.

Use the existing disposable adapter after a build:

```bash
npm run -s verify:runtime -- start --scenario dashboard-controls
# Open the run's own origin at /, then pendant-1, Sign preview and Connections.
npm run -s verify:runtime -- capture <run-id> scenario-dashboard-controls
npm run -s verify:runtime -- stop <run-id>
```

The run uses simulated LIFX bulbs and a synthetic sign. The adapter's existing
health screenshots remain health evidence; the focused browser journey provides
UI evidence. Run that journey with
`node apps/runtime/dashboard/tests/controls.browser.ts` after a build. It checks
accepted/completed timing, an uncertain lock after reload and explicit refresh,
no replay, declared-page navigation, keyboard operation and desktop/phone axe.
Installation and physical acceptance remain separate.

## Inbox and timeline

Home syncs the core's shared inbox and shows failed, uncertain and conflicting
operations. **Send again** explicitly sends saved operation data as a fresh
tracked command and handles the old item; **Dismiss** only handles the item.
Both use its current revision. Stale copies disable actions; read-only sessions
show the records without controls. A handling reply is separate from the synced
removal and the new operation's completion. Device holds and display dismissal
remain separate. Nothing resends on reload, reconnect or elapsed time.

**Timeline** reads retained history on entry and **Apply filters**, with inclusive
From/To, Kind, Source and qualified Session filters. Reads send no command and
use the existing authenticated gateway. Only the latest submitted read can
update the results or status, even when replies arrive out of order.
The focused synthetic journey is
`node apps/runtime/dashboard/tests/inbox-history.browser.ts` after a build;
it checks explicit resend, dashboard dismissal visible through MCP, timeline
filters, keyboard, read-only presentation and desktop/phone axe.

## Shared habitat

`#/habitat` presents ten resident bunnies in one four-room home. It uses the shell's existing session copy; it opens no second participant and sends no agent or device command. Live mode retains stable assignments, fills free places from the newest eligible sessions and leaves overflow waiting. Known children stay with the root's existing activity projection. Disconnect or resync retains assignments and marks evidence uncertain. Demo mode and music are explicitly simulated.

The canvas geometry, sprite poses, furniture masks and routes retain the reviewed private prototype. The JavaScript renderer is scoped to its mount and returns a typed cleanup API; allocation, preferences and the shell adapter are TypeScript. Each mount owns its model, event listeners and animation frame. Navigation destroys them. Pause motion and reduced motion keep text and final poses available. If artwork or canvas is unavailable, a session list remains visible.

Select a bunny once to inspect it and again to open a qualified Codex Desktop conversation on Windows. The resident buttons provide the same deliberate keyboard activation. Unsupported providers or platforms explain their limit. Opening does not acknowledge unread notices or claim read evidence.

Settings are local to the browser origin. Use **Export habitat settings** in the private preview, then **Move your habitat settings → Import habitat settings** here. The bounded JSON transfer includes only room positions, apron colors, recovery preference and assignments; it never uploads a file. Import validates before writing and retains a browser-local backup. Storage failure keeps the current visit usable; assignments cannot be promised across reload without storage.

The focused `tests/habitat.browser.ts` journey runs through the real disposable runtime with synthetic sessions. It covers ten residents plus overflow, shared connection, lifecycle updates, reconnect, demo isolation, preference import, unmount cleanup, fallback, keyboard and axe in dark/light desktop/phone views. It is included in both the local browser suite and hosted dashboard smoke entry. Unit policy and preference tests run in `test:runtime-dashboard:built`. These checks do not establish mobile app deep links or physical device behavior.

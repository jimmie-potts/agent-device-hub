# B.U.N.N.Y. dashboard on the runtime

The B.U.N.N.Y. dashboard served by the [runtime](../README.md)'s gateway
([Hub #922](https://github.com/jimmie-potts/agent-device-hub/issues/922)). It is
a copy of [`apps/dashboard`](../../dashboard/README.md), which the old Hub keeps
serving until the retirement story (#839); [PROVENANCE.md](PROVENANCE.md) lists
what was copied, from which commit, and what changed. The React/TypeScript page
reads the core's agent sessions through the SDK's sync and follows their live
changes ([ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)). It
polls nothing and replays nothing: after a lost stream it syncs again and shows
the core's current state.

The runtime copy includes:

- the shell, its hash routes, the Places navigation and the Neon skin;
- browser sign-in on the runtime's gateway: a bookmark with trusted loopback
  sign-in, or the launcher's one-time code;
- the agent sessions, synced from the core, with a finished turn shown unread
  until the session record clears it;
- general device cards and guarded controls, music, declared module pages and a running build readout;
- the home that the owner-approved mockup lays out ("Recommended (d)", owner
  decision 7, 2026-10-06), with panels for the Hub mode (#924) and the inbox
  (#923).

The Wispr page comes with #927 and the automation pages with #925. Device-specific
feature pages remain their own module stories.

## Pages, routes and widgets

Every page has a hash address: `#/` (also `#/home` and `#/activity`) for the
home, `#/connections`, `#/component/<device>`, `#/music/<source>` and
`#/module/<module>/<page>`. `src/routes.ts` parses a hash into a discriminated
route, so built-in pages and component aliases are distinct kinds and an alias
of `activity` or `connections` opens only that component
([#247](https://github.com/jimmie-potts/agent-device-hub/issues/247)). A
navigation link applies its route in the click event, ahead of the browser's
deferred `hashchange`, so two pages are never shown at once, and the back button
walks the history. An address that names nothing shows a not-found message and sends nothing. The launcher's
`#launch=` fragment is not a route: the page removes it before it exchanges the
code.

`src/widgets.ts` is the widget catalog. Each widget declares an ID, a name, a
description, its sizes, its source kind (`core`, `module` or `external`), the
families it syncs, and whether it offers commands. `homeLayout` places the Hub
mode and the agent sessions in the wide column, and the inbox and the attention
summary in the narrow one. The Hub mode and the inbox are slots: the layout
places them now and says they are not shown here yet, and they read and send
nothing until #924 and #923 fill them.

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

`src/sessions.ts` derives what each row shows from its record alone:

- the name: the label, then the title, then the native session ID;
- where it runs: the project, then the client, such as
  `agent-device-hub · Claude Code`;
- the chip: the dashboard's `chipOf` policy, naming the attention (**Waiting
  for approval**, **Waiting for input** or **Question**), **Working**,
  **Finished · unread**, or the activity;
- the attention lines, each retained turn-ended notice with who acknowledged it,
  and the rare facts behind Details: source, session ID, activity, the age of the
  last evidence, read evidence, parent and children.

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
one. Without one it asks for a trusted loopback session
(`POST /api/v2/browser/session`) when the runtime's edge section sets
`browserAccess` to `trusted-loopback`, and otherwise shows the launcher's page.
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

The Places navigation reads `docs/skins/places.json`. Public places link to the
published guide. On the installed runtime, which serves B.U.N.N.Y.'s own place
port, a Local place links to the runtime's place link for it
(`GET /api/v2/links`) or else to the manifest's address. Anywhere else, such as
a disposable verification run, the page is a preview (Hub #495): a Local place
appears only where the runtime's links name it, so a preview never leads to an
installed service.

## Visual foundation

The [application UI style guide](../../../docs/application-ui-style-guide.md)
records the shared visual direction (Neon Geometry Wars).
[`src/skins/neon-geometry-wars.css`](src/skins/neon-geometry-wars.css) is the
token layer, copied unchanged; `src/style.css` reads only its role and private
token names. The session dot and chip use the fixed-meaning chip colors.

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

## Devices, music and operations

The authenticated module catalog names every device owner. `runtime-feeds.ts`
keeps one SDK copy per owner, alongside core operations and playback, using the
existing participant. Desired state, device observation, queued kinds, last
transmission and held state stay separate. A failed owner remains visible as
unavailable; a lost stream keeps records stale until their own snapshot returns.

Home keeps the existing mode/power quick controls; the device route exposes
brightness, scenes, zones, media and manual moments only where declared. Each
explicit general command includes the current configuration revision and generation.
Playback uses its current revision. Nanoleaf content requires Free and Pixoo
content requires Media; selecting content never changes mode. The four shipped
device modules currently advertise moments unsupported. The capability-gated
manual card is retained, but this dashboard does not implement a module's moment
behavior.

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

Navigation takes only exact same-origin page paths from module declarations. A
sandboxed frame keeps the page inside the shell. The gateway permits same-origin
framing of module HTML only; scripts and forms stay forbidden, content policies
stay unchanged, and the shell itself cannot be framed. Unknown pages show not
found. No private file or installed-service fallback is used.

Connections reads `/api/v2/build`: the serving process's frozen package version,
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
use the existing authenticated gateway. The focused synthetic journey is
`node apps/runtime/dashboard/tests/inbox-history.browser.ts` after a build;
it checks explicit resend, dashboard dismissal visible through MCP, timeline
filters, keyboard, read-only presentation and desktop/phone axe.

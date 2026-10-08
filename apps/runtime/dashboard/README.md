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

What the runtime copy has now, the first of #922's three slices:

- the shell, its hash routes, the Places navigation and the Neon skin;
- browser sign-in on the runtime's gateway: a bookmark with trusted loopback
  sign-in, or the launcher's one-time code;
- the agent sessions, synced from the core, with a finished turn shown unread
  until the session record clears it;
- the home that the owner-approved mockup lays out ("Recommended (d)", owner
  decision 7, 2026-10-06), with panels for the Hub mode (#924) and the inbox
  (#923).

Device cards, their general controls and music come in the second slice, and
module pages, the run preview and the running build identity on Connections in the third. The Wispr page comes with #927
and the automation pages with #925.

## Pages, routes and widgets

Every page has a hash address: `#/` (also `#/home` and `#/activity`) for the
home and `#/connections`. `src/routes.ts` parses a hash into a discriminated
route, so built-in pages and component aliases are distinct kinds and an alias
of `activity` or `connections` opens only that component
([#247](https://github.com/jimmie-potts/agent-device-hub/issues/247)). A
navigation link applies its route in the click event, ahead of the browser's
deferred `hashchange`, so two pages are never shown at once, and the back button
walks the history. An address that names nothing, such as a component before the
device slice, shows a not-found message and sends nothing. The launcher's
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
device is the operator tool on Connections owned by #1009.

## Sign-in

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

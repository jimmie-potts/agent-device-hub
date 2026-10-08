# runtime-dashboard Specification

## Purpose

Define the B.U.N.N.Y. dashboard that the runtime serves (Hub #922), copied from the old Hub's dashboard: its shell, routes, Places and skin, browser sign-in on the runtime's gateway, the agent sessions it syncs from the core and follows live with no polling and no replay, a finished turn shown from the session record alone, and the owner-approved home with its panels. It is source behavior verified in disposable runs; installation happens at the cutover.

## Requirements

### Requirement: The dashboard on the runtime

The runtime SHALL serve a copy of the B.U.N.N.Y. dashboard (`apps/runtime/dashboard`), copied from `apps/dashboard` with provenance notes that name each copied file, its source commit and what changed, while the old Hub keeps serving `apps/dashboard` until the retirement story (#839). The copy SHALL keep the shell, its hash routes and back-button history, an address that names nothing shown as not found with nothing sent, the Places navigation and the Neon skin, whose role and private tokens are the only colors its styles use. It SHALL read only through the runtime's gateway and the SDK, and SHALL poll nothing. Approval and input attention SHALL use the fixed blocked chip token; a continuing question SHALL use the separate question token.

#### Scenario: Routes and the shell
- **WHEN** a signed-in page follows the Connections link, goes back, and opens an address that names no page
- **THEN** each page has its hash address, the back button returns to the home, the unknown address shows that nothing is there with a link home, and nothing is sent

#### Scenario: Accessible pages
- **WHEN** the home is checked at 1,440 and 390 px, and the launcher's page on its own
- **THEN** axe finds no WCAG 2.1 A or AA violation, no text overlaps on the desktop home, and the phone width has no horizontal overflow

#### Scenario: Fixed attention colors
- **WHEN** a session needs approval or input, or reports a continuing question
- **THEN** approval/input dots and chips use the fixed blocked token, and the continuing question uses the separate question token

### Requirement: Sign-in on the runtime's gateway

The dashboard SHALL sign in only through the gateway's browser routes, with `bunny-request: 1` and its own `Origin` on every change, and SHALL hold no token. On load and on a sign-in click it SHALL use the browser's live session when one exists, so a reload or a second tab opens no new session; without one it SHALL ask for a trusted loopback session, and when the runtime does not offer one it SHALL show the launcher's page. A `#launch=<code>` fragment SHALL leave the address before the page exchanges the code once. A sign-in that fails SHALL show an alert with the launcher's text. **Disconnect** SHALL end the browser's session, in every tab of the origin, and offer **Sign in**. When the runtime refuses the browser's session, as after a logout elsewhere, an eviction, its expiry or a runtime restart, the page SHALL say the session ended, keep its last records and offer **Sign in again**, and SHALL NOT sign in by itself. A link on another local app's page with the same host name SHALL open the page signed in; a frame from another local app and another host name's link SHALL be refused.

The page's sign-in, launch exchange, logout, authority and Places HTTP calls SHALL each carry valid W3C trace context without changing their authentication protections. With no parent operation, each call SHALL start its own trace.

#### Scenario: Bookmark, reload and second tab
- **WHEN** a fresh browser opens the bookmark on a runtime with trusted loopback sign-in, reloads it, opens a second tab at `#/connections`, and another browser opens it on `localhost`
- **THEN** each page shows the dashboard without a sign-in form, the second tab keeps its address, the first browser holds one session and the other its own

#### Scenario: Context on sign-in and read calls
- **WHEN** the page signs in, exchanges a launch code, signs out, checks its authority or reads Places
- **THEN** every call carries a valid W3C traceparent without a bearer token, tracestate or baggage; independent calls start their own traces and retain the existing cookie, Origin and request-header protections

#### Scenario: The launcher's code
- **WHEN** a runtime without trusted loopback sign-in is opened directly, then the launcher's code opens a tab, and the same code and a malformed one are tried in other browsers
- **THEN** the direct visit shows the launcher's page with no session, the code signs one browser in and leaves the address, and the others show that the launch expired or failed

#### Scenario: Disconnect and an ended session
- **WHEN** one tab disconnects while a second tab of the same browser is open, and later the runtime restarts under an open page
- **THEN** the first tab is signed out with a Sign in action, the second says its session ended and offers Sign in again, neither signs in by itself, and both tabs signing in again reuse one live session, and another Disconnect still ends both tabs

### Requirement: Agent sessions synced from the core

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the activity, its attention items, its retained notices with who acknowledged them, and behind Details its source, session ID, activity, the age of its last evidence, read evidence, parent and children.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears working by its title and client, then waits for approval with its attention line and the attention summary, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

### Requirement: A finished turn from the session record

The dashboard SHALL show a session's finished turn as **Finished · unread** while its record holds a turn-ended notice that no consumer has acknowledged, no later known turn has started, and no positive read evidence is present. Attention and work SHALL rank above that state. An unknown read state or turn SHALL NOT count as clearing evidence. An acknowledgment from any consumer, positive read evidence or a later known turn SHALL clear it; ending the session SHALL remove its row. The page SHALL never clear a finished turn itself or on a timer, and SHALL offer no row acknowledge button. The Connections operator tool for clearing a notice on every device belongs to #1009.

#### Scenario: Unread until the record clears it
- **WHEN** a session's turn ends and the page stays open for seconds, then another session's new turn starts after its turn ended
- **THEN** the first shows Finished · unread throughout with no command sent, and the second works again with its earlier notice acknowledged by the consumers that clear on a new turn

#### Scenario: Read evidence and a device acknowledgment
- **WHEN** positive read evidence reaches an unread Codex Desktop session, and a device consumer acknowledges another session's unread notice
- **THEN** both rows show idle, the records keep read evidence and acknowledgment distinct, no row acknowledge button is offered, and the page sends no command

#### Scenario: Tier 1 in the catalog
- **WHEN** the catalog's dashboard scenarios run in the in-memory harness over both transports
- **THEN** a browser loads the page and reads the sessions as they appear, an approval is raised and cleared, and the finished turn stays unread for two seconds, clears with a new turn, with any consumer acknowledgment and with positive read evidence, and leaves with its session, never as an inbox item

### Requirement: The approved home with its panels

The home SHALL follow the owner-approved mockup ("Recommended (d)", owner decision 7, 2026-10-06): the Hub mode panel and the agent sessions in the wide column, the inbox panel and the attention summary in the narrow one. The Hub mode (#924) and inbox (#923) panels SHALL be slots that their stories fill: each SHALL say it is not shown on the page yet, and SHALL read and send nothing. The page SHALL NOT claim the inbox is empty.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the wide column holds the Hub mode and the sessions, the narrow one the inbox and the attention summary, the Hub mode panel has no control, and the sessions say none were observed

### Requirement: Places on a run

The Places navigation SHALL link a Local place only to the runtime's place link for it (`GET /api/v2/links`), or, on the installed runtime that serves B.U.N.N.Y.'s own place port, to the manifest's address. On any other port, such as a disposable run, a Local place the runtime names no link for SHALL be left out, so a preview never leads to an installed service. Local places SHALL wait for the links.

#### Scenario: A paired run and a run with none
- **WHEN** a run names a link for the wall, and another run names none
- **THEN** the first's Wall leads to the named link in a new tab with the public places unchanged, and the second shows no Local place but B.U.N.N.Y.

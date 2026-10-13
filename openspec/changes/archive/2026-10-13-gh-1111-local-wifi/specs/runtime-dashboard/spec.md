## MODIFIED Requirements

### Requirement: Sign-in on the runtime's gateway

The dashboard SHALL sign in only through the gateway's browser routes, with `bunny-request: 1` and its own `Origin` on every change, and SHALL hold no token. On load and on a sign-in click it SHALL use the browser's live session when one exists, so a reload or a second tab opens no new session; without one it SHALL ask for a browser session from trusted loopback or the explicitly configured authenticated home-Wi-Fi entry, and when the runtime does not offer one it SHALL show the launcher's page. A `#launch=<code>` fragment SHALL leave the address before the page exchanges the code once. A sign-in that fails SHALL show an alert with the launcher's text. **Disconnect** SHALL end the browser's session, in every tab of the origin, and offer **Sign in**. When the runtime refuses the browser's session, as after a logout elsewhere, an eviction, its expiry or a runtime restart, the page SHALL say the session ended, keep its last records and offer **Sign in again**, and SHALL NOT sign in by itself. A link on another local app's page with the same host name SHALL open the page signed in; a frame from another local app and another host name's link SHALL be refused.

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

#### Scenario: Existing dashboard through home Wi-Fi
- **WHEN** the owner opens the HTTPS bookmark, navigates at phone width, uses an existing control, briefly disconnects and resumes
- **THEN** the same dashboard and SDK stream show known state, controls retain their existing authorization and tracking, disconnection is visible, recovery resyncs without replay, and no native application or separate mobile interface is required

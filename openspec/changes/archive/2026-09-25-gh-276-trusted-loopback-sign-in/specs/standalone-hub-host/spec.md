## MODIFIED Requirements

### Requirement: Private bounded browser handoff
The host SHALL issue browser launch codes only through an owner-only local channel. It SHALL accept each code once within a bounded lifetime and issue a time-limited bearer restricted to read/control on configured aliases and the configured playback source ID. The bearer MUST NOT grant ingest, admin or MCP access. Missing, invalid, replayed and expired codes, and disallowed origins MUST fail without state or device effects. Closing or replacing host authority SHALL revoke ephemeral sessions.

When, and only when, the private configuration sets `browserAccess` to `trusted-loopback`, the host SHALL also issue the same browser session, with the same grants, expiry, session limit and retirement, from `POST /api/dashboard/v1/session`. That route SHALL require an allowed loopback Host, an Origin matching that Host, a `Sec-Fetch-Site` that is absent or `same-origin`, `X-Pixoo-Request: 1` and an empty JSON object body. Without the setting the route SHALL answer 404 and issue nothing. Any other `browserAccess` value SHALL be an invalid configuration. Launcher and trusted-loopback sessions SHALL share one session limit.

Disconnect, expiry, oldest-session eviction, credential replacement and host shutdown SHALL retire a browser session through one idempotent path. Retirement SHALL refuse the session's bearer and its cached requests, close its change streams and release its command tickets and settled replay entries. A retired session MUST NOT admit new work, including a monitor, controller, integration or playback write authorized before retirement whose body arrives afterwards. Work the session already admitted SHALL NOT be cancelled or executed again. Its replay accounting SHALL remain charged, and not evictable, until that work settles, and SHALL then be released exactly once. After every browser session retires and its admitted work settles, the host SHALL retain no browser ticket ledger, stream or replay entry. Disconnecting a dashboard that used a configured credential MUST NOT revoke that credential, close its streams or reset its tickets.

#### Scenario: Scoped exchange
- **WHEN** the installed owner requests a launch and exchanges its code from the same-origin page
- **THEN** only that exchange receives a bounded browser session with read/control permission on the configured aliases and the configured playback source

#### Scenario: Unauthorized exchange
- **WHEN** a network caller lacks a current launch code or supplies a disallowed origin
- **THEN** the host rejects it without issuing a bearer or contacting a controller

#### Scenario: Trusted-loopback session
- **WHEN** the configuration sets `browserAccess` to `trusted-loopback` and the same-origin page posts `{}` to the session route with the custom header
- **THEN** it receives a browser session with read/control on the configured aliases and playback source, which cannot ingest, quiesce or authenticate MCP

#### Scenario: Trusted-loopback route off by default
- **WHEN** the configuration has no `browserAccess` field and a caller posts to the session route
- **THEN** the host answers 404 and issues no session

#### Scenario: Trusted-loopback request from elsewhere
- **WHEN** a session request has a foreign Host, a missing, foreign or mismatched Origin, a cross-site `Sec-Fetch-Site`, no `X-Pixoo-Request` header or a body other than `{}`
- **THEN** the host refuses it and issues no session

#### Scenario: Invalid browser access setting
- **WHEN** `browserAccess` is present with any value other than `trusted-loopback`
- **THEN** the host does not start and reports an invalid configuration

#### Scenario: Session revocation
- **WHEN** the user disconnects, the session expires, configured credentials are replaced or the host stops
- **THEN** subsequent requests with the old bearer are refused

#### Scenario: Repeated launches stay bounded
- **WHEN** the owner repeatedly launches or signs in through the trusted-loopback route, reads monitor sessions, submits a command and then disconnects, lets a session expire or exceeds the session limit
- **THEN** each retired session's streams close, its bearer and cached requests are refused, and ticket ledgers and replay accounting return to the configured-credential bound

#### Scenario: Admitted work outlives retirement
- **WHEN** a browser session retires while a command it submitted is still pending, and that command later succeeds or fails
- **THEN** the command runs once, is not reported as cancelled, keeps its replay accounting charged until it settles, and is released once however often retirement repeats

#### Scenario: Late request after retirement
- **WHEN** a monitor, controller or integration write's headers were authorized before its browser session retired and its body arrives afterwards
- **THEN** the host refuses it as unauthenticated, contacts no controller and creates no ticket ledger or replay entry

#### Scenario: Configured credential disconnect
- **WHEN** a dashboard opened with a configured credential disconnects while that credential and another browser session have open streams
- **THEN** both remain usable, their streams stay open, and the configured credential keeps its ticket sequence so an old request returns its retained result and never executes again

#### Scenario: Playback through a browser session
- **WHEN** a launcher-issued browser session reads the playback snapshot, sends a declared playback command or reads the dashboard context on a hub with a configured playback source
- **THEN** the snapshot and command are admitted for that source, the context names the source, and the session still cannot ingest, administer or use MCP

## ADDED Requirements

### Requirement: Loopback host names
The host SHALL accept `127.0.0.1:<port>` and `localhost:<port>` as the Host of the dashboard page, its assets and its HTTP API. When a request carries an Origin, it SHALL equal `http://` followed by that request's Host. Any other Host, or an Origin naming a different host, SHALL be refused without state or device effects. MCP SHALL keep accepting only its numeric-loopback origin.

#### Scenario: Bookmark on localhost
- **WHEN** the browser loads `http://localhost:<port>/` and its API requests carry Host `localhost:<port>` and Origin `http://localhost:<port>`
- **THEN** the page, assets and authorized API requests are served as they are for `127.0.0.1`

#### Scenario: Mixed or foreign host names
- **WHEN** a request carries Host `localhost:<port>` with Origin `http://127.0.0.1:<port>`, or a Host other than the two loopback names
- **THEN** the host refuses it

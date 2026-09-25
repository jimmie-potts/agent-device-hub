## MODIFIED Requirements

### Requirement: Private bounded browser handoff
The host SHALL issue browser launch codes only through an owner-only local channel. It SHALL accept each code once within a bounded lifetime and issue a time-limited bearer restricted to read/control on configured aliases. The bearer MUST NOT grant ingest, admin or MCP access. Missing, invalid, replayed and expired codes, and disallowed origins MUST fail without state or device effects. Closing or replacing host authority SHALL revoke ephemeral sessions.

Disconnect, expiry, oldest-session eviction, credential replacement and host shutdown SHALL retire a browser session through one idempotent path. Retirement SHALL refuse the session's bearer and its cached requests, close its change streams and release its command tickets and settled replay entries. A retired session MUST NOT admit new work, including a request authorized before retirement whose body arrives afterwards. Work the session already admitted SHALL NOT be cancelled or executed again. Its replay accounting SHALL remain charged, and not evictable, until that work settles, and SHALL then be released exactly once. After every browser session retires, the host SHALL retain no browser ticket ledger, stream or replay entry. Disconnecting a dashboard that used a configured credential MUST NOT revoke that credential, close its streams or reset its tickets.

#### Scenario: Scoped exchange
- **WHEN** the installed owner requests a launch and exchanges its code from the same-origin page
- **THEN** only that exchange receives a bounded browser session with configured alias read/control permission

#### Scenario: Unauthorized exchange
- **WHEN** a network caller lacks a current launch code or supplies a disallowed origin
- **THEN** the host rejects it without issuing a bearer or contacting a controller

#### Scenario: Session revocation
- **WHEN** the user disconnects, the session expires, configured credentials are replaced or the host stops
- **THEN** subsequent requests with the old bearer are refused

#### Scenario: Repeated launches stay bounded
- **WHEN** the owner repeatedly launches, reads monitor sessions, submits a command and then disconnects, lets a session expire or exceeds the session limit
- **THEN** each retired session's streams close, its bearer and cached requests are refused, and ticket ledgers and replay accounting return to the configured-credential bound

#### Scenario: Admitted work outlives retirement
- **WHEN** a browser session retires while a command it submitted is still pending, and that command later succeeds or fails
- **THEN** the command runs once, is not reported as cancelled, keeps its replay accounting charged until it settles, and is released once however often retirement repeats

#### Scenario: Late request after retirement
- **WHEN** a command's headers were authorized before its browser session retired and its body arrives afterwards
- **THEN** the host refuses it as unauthenticated and creates no ticket ledger or replay entry

#### Scenario: Configured credential disconnect
- **WHEN** a dashboard opened with a configured credential disconnects while that credential and another browser session have open streams
- **THEN** both remain usable, their streams stay open, and the configured credential keeps its ticket sequence so an old request returns its retained result and never executes again

## ADDED Requirements

### Requirement: Private bounded browser handoff
The host SHALL issue browser launch codes only through an owner-only local channel. It SHALL accept each code once within a bounded lifetime and issue a time-limited bearer restricted to read/control on configured aliases. The bearer MUST NOT grant ingest, admin or MCP access. Missing, invalid, replayed and expired codes, and disallowed origins MUST fail without state or device effects. Closing or replacing host authority SHALL revoke ephemeral sessions.

#### Scenario: Scoped exchange
- **WHEN** the installed owner requests a launch and exchanges its code from the same-origin page
- **THEN** only that exchange receives a bounded browser session with configured alias read/control permission

#### Scenario: Unauthorized exchange
- **WHEN** a network caller lacks a current launch code or supplies a disallowed origin
- **THEN** the host rejects it without issuing a bearer or contacting a controller

#### Scenario: Session revocation
- **WHEN** the user disconnects, the session expires, configured credentials are replaced or the host stops
- **THEN** subsequent requests with the old bearer are refused

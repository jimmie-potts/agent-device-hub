## ADDED Requirements

### Requirement: Local owner browser launch
The dashboard SHALL accept a single-use short-lived launch code from the installation owner's private launcher, remove it from browser history before exchange, and connect with a memory-only scoped bearer. A direct visit SHALL retain the manual credential path. Disconnect SHALL revoke a launcher session and clear browser memory.

#### Scenario: One-click local launch
- **WHEN** the installation owner invokes the launcher against a running Hub
- **THEN** the browser opens the Hub's loopback page, exchanges one code and shows the authorized dashboard without asking the user to type a bearer

#### Scenario: Replay, expiry and reload
- **WHEN** a code is reused, expired or absent, or the page reloads after a successful launch
- **THEN** the page has no automatic authority, provides a clear relaunch path and sends no device command

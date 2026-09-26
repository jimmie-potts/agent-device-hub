## MODIFIED Requirements

### Requirement: Local owner browser launch
The dashboard SHALL accept a single-use short-lived launch code from the installation owner's private launcher, remove it from browser history before exchange, and connect with a memory-only scoped bearer. A direct visit SHALL retain the manual credential path. Disconnect SHALL revoke a launcher session and clear browser memory.

On a visit without a launch code, the dashboard SHALL request a trusted-loopback session from the hub. When the hub issues one, the dashboard SHALL open without a login form, keeping the bearer in page memory only, with no cookie or browser storage. When the hub answers 404, the dashboard SHALL show the launcher and manual-token login page unchanged. Any other failure SHALL show that page with an alert. A trusted-loopback page SHALL log its session out on `pagehide` and SHALL request a new session when restored from the back-forward cache. After Disconnect, or when a trusted-loopback session is no longer accepted, the dashboard SHALL offer one explicit sign-in action and MUST NOT sign in again on its own.

#### Scenario: One-click local launch
- **WHEN** the installation owner invokes the launcher against a running Hub
- **THEN** the browser opens the Hub's loopback page, exchanges one code and shows the authorized dashboard without asking the user to type a bearer

#### Scenario: Replay, expiry and reload
- **WHEN** a code is reused, expired or absent, or the page reloads after a successful launch, on a hub without trusted-loopback access
- **THEN** the page has no automatic authority, provides a clear relaunch path and sends no device command

#### Scenario: Bookmark opens signed in
- **WHEN** the hub has trusted-loopback access and a fresh browser context opens `/` on `127.0.0.1` or `localhost`
- **THEN** the dashboard shows with control enabled, without a login form, and sends no device command

#### Scenario: Reload and second tab stay signed in
- **WHEN** the owner reloads a trusted-loopback page or opens a second tab
- **THEN** each page shows the dashboard signed in, and after the reload the hub holds no session for the page that was unloaded

#### Scenario: Trusted-loopback sign-in fails
- **WHEN** the hub has trusted-loopback access but the session request fails
- **THEN** the page shows an alert with the launcher text and the manual-token form

#### Scenario: Recover an ended trusted-loopback session
- **WHEN** a trusted-loopback session is evicted or expires while the dashboard is open, or the owner disconnects
- **THEN** the page offers one sign-in action, and activating it restores the dashboard with a new session

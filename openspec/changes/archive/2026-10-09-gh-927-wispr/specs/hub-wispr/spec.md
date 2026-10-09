## MODIFIED Requirements

### Requirement: Configured source authorization

The runtime SHALL read only the owner's configured aggregate and diagnostics JSON files. Every analytics response MUST require an authenticated caller with runtime read scope; no separate Wispr client allowlist or source grant SHALL be required. Browser sessions SHALL receive analytics and page discovery only when dashboard exposure is enabled. Exposure and text sharing SHALL default off independently. Source IDs SHALL be neutral and SHALL NOT collide with reserved host identities. Existing Host, Origin and Fetch-Metadata checks SHALL remain. Analytics SHALL NOT enter MCP, agent-session snapshots or general broadcasts. Released old Hub routes SHALL retain their existing authorization until cutover.

#### Scenario: Generic and wrong-source credentials
- **WHEN** two authenticated runtime clients with read scope and no extra Wispr grant request analytics
- **THEN** both receive permitted numeric analytics, including while browser exposure is disabled

#### Scenario: Refused callers and disabled browser exposure
- **WHEN** a caller is anonymous, revoked, lacks read scope, has a retired browser session, or is a browser while exposure is disabled
- **THEN** no Wispr analytics payload is delivered; disabled exposure also hides the browser page and widget

#### Scenario: Late revocation
- **WHEN** a credential, read scope or session is revoked, browser exposure is disabled for a browser, or text sharing is disabled while a read/export is pending
- **THEN** the pending response is refused before delivering data whose permission ended

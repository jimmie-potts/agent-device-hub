## ADDED Requirements

### Requirement: Inspect running Hub build on Connections

Connections SHALL show the running Hub package version and a short source revision from the authenticated dashboard context, with the full known revision copyable. Missing or invalid metadata MUST show `unknown`. Build inspection and copying MUST send no device command and remain available to read-only credentials.

#### Scenario: Known running revision
- **WHEN** the owner opens Connections with a known Hub identity
- **THEN** the page displays its version and short revision, and copying yields the full revision

#### Scenario: Unknown or older metadata
- **WHEN** the context lacks usable build metadata
- **THEN** Connections displays explicit unknown values without guessing from a version, page path or state revision

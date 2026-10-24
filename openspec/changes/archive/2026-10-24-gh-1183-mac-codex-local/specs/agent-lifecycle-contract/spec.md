## ADDED Requirements

### Requirement: Shared local Codex identity
The existing lifecycle and session contracts SHALL admit Codex client `local` for supported local Desktop and CLI sessions whose hook configuration cannot distinguish those surfaces. Existing cli, desktop and code identities SHALL retain their meanings and separate state selectors. Claude local SHALL be refused. Local SHALL NOT inherit Desktop-only read or display-metadata evidence.

#### Scenario: Shared local producer
- **WHEN** a supported local Codex hook emits a lifecycle observation with client local
- **THEN** the existing SDK, state owner, snapshots and dashboard preserve that identity without relabeling it Desktop or CLI

#### Scenario: Identity and privilege preservation
- **WHEN** local, cli and desktop sources use the same native session ID, or local submits Desktop-only read evidence
- **THEN** the three state records remain distinct across restart and the unsupported privileged observation is refused

## ADDED Requirements

### Requirement: ONN hibernation governs active availability

The system SHALL keep ONN dormant until a new owner decision and restored verification. Hibernation SHALL override the active ONN behavior described by this capability. It SHALL expose no ONN controls, observations, title-history pages, MCP tools or runtime registration. Dedicated ONN default checks SHALL be dormant. Retained source, private history, stored-command privacy and backup/upgrade compatibility SHALL remain intact without data migration or deletion. Shared dashboard authentication, keyboard accessibility and reconnect checks SHALL remain active.

#### Scenario: Start and browse after hibernation
- **WHEN** a hibernated release starts or a client opens a saved ONN page
- **THEN** no ONN writer starts or command is replayed, no ONN page/control is advertised, and the shared shell handles the unavailable route

#### Scenario: Preserve historical state
- **WHEN** an upgrade encounters retained ONN stores or historical omitted-text commands
- **THEN** those files and private identities remain preserved, without reactivating ONN or exposing text

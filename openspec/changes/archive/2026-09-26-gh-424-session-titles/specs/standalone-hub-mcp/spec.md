## ADDED Requirements

### Requirement: Shared display metadata in session tools
hub_sessions SHALL expose snapshot 1.2 title/project metadata and match its query against label, title, project and session identity. hub_label SHALL retain owner provenance and use the shared 80-scalar bound.

#### Scenario: Find a named session
- **WHEN** a caller searches by the shared title or project
- **THEN** the matching session identity and current metadata are returned without device effects

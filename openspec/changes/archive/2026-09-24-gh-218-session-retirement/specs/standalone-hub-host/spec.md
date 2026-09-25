## ADDED Requirements

### Requirement: Optional read-only archive admission evidence
The host SHALL use the configured Codex Desktop home and exact host/source namespace solely to obtain bounded read-only archive evidence for new Desktop record admission. Positive matching archive evidence SHALL prevent admission. Missing configuration, missing/unreadable folders or unavailable evidence SHALL supply no archive evidence. Retirement SHALL work without archive access. The host SHALL NOT poll archives, read transcripts, write or move Codex files, or infer archive state for other installations. An eligible new start after unarchive SHALL be admitted subject to retained delayed-event evidence.

#### Scenario: Archive evidence and unarchive
- **WHEN** an eligible start names an archived conversation in the configured installation, then archive evidence is removed and new work starts
- **THEN** the archived admission is suppressed and the later eligible work creates fresh monitoring with defaults

#### Scenario: Archive evidence unavailable
- **WHEN** configuration or readable archive evidence is absent
- **THEN** ordinary admission remains available and an accepted runtime end still retires known records

### Requirement: Explicit snapshot compatibility
The host SHALL retain its default snapshot 1.0 response and offer explicit snapshot 1.1 selection for generation-aware consumers. Unknown snapshot versions SHALL reject without silently changing consumer semantics. An unavailable feed SHALL NOT become a healthy empty snapshot.

#### Scenario: Legacy and generation-aware readers
- **WHEN** old and upgraded consumers read the same owner revision
- **THEN** default readers receive the closed 1.0 shape, upgraded readers receive native identities plus record generations in 1.1, and both observe actual session removal

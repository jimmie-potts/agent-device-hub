## ADDED Requirements

### Requirement: Bounded title and project enrichment
Producers SHALL optionally read bounded Codex session-index or Claude title records and report project basenames. Claude custom-title SHALL precede ai-title. Missing or invalid metadata SHALL NOT suppress lifecycle delivery or extend the existing hook deadline, event, queue or process bounds. Parent metadata SHALL NOT be assigned to child events.

#### Scenario: Rename on a later event
- **WHEN** a supported provider title changes before a later hook
- **THEN** the later event carries the new title from the bounded source

#### Scenario: Unreadable source
- **WHEN** a source is missing, unreadable, malformed, too large or times out
- **THEN** the hook remains silent and fail-open and attempts lifecycle reporting without that metadata

## MODIFIED Requirements

### Requirement: Qualified metadata mappings
Source adapters SHALL map documented Codex and Claude events using explicit source installation configuration. Child events MUST retain child and evidenced parent identities. Missing turn/order/correlation MUST remain unknown. Unsupported client paths MUST remain disabled until their separate installed qualification.

#### Scenario: Provider normalization
- **WHEN** a supported event supplies a valid session ID and optional qualified turn or child ID
- **THEN** the adapter creates the corresponding lifecycle observation, configured source identity and one observation timestamp; version-selected title/project enrichment allowlists its own fields without copying provider records

#### Scenario: Unknown coverage
- **WHEN** Claude interruption, unqualified continuing-input semantics or Desktop read/hook evidence is requested
- **THEN** the adapter does not invent that evidence or enable an unqualified installed path

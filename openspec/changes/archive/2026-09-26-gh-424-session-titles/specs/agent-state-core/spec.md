## ADDED Requirements

### Requirement: Durable shared display metadata
The owner SHALL persist title, project and label provenance, apply later accepted renames without changing identity, and preserve an explicit user label against agent labels and provider titles. It SHALL serve snapshot 1.2 and preserve strict 1.0/1.1 projections. Existing durable inputs SHALL remain importable with no installed migration implied.

#### Scenario: Owner precedence and restart
- **WHEN** an owner labels a titled session and later agent labels and title renames arrive
- **THEN** the owner label remains primary and the new title/project survive a synthetic restart

#### Scenario: Legacy readers
- **WHEN** a consumer asks for snapshot 1.0 or 1.1
- **THEN** new display metadata and agent-origin labels are omitted, preserving the prior closed shape

## MODIFIED Requirements

### Requirement: Privacy and bounded admission
The owner SHALL validate lifecycle and persisted inputs before using them. Transport, persistence, diagnostics and errors MUST contain only versioned allowed metadata, including title/project display fields. After session expiry, bounded capacity or invalid input MUST reject admission with fixed content-free outcomes without deleting the remaining state or blocking agents.

#### Scenario: Private canaries
- **WHEN** a payload or storage adapter error includes credentials, tokens or undeclared content
- **THEN** excluded values never appear in saved data, snapshots, diagnostics, emitted changes or returned errors

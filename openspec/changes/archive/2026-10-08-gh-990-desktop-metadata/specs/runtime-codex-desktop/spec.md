## ADDED Requirements

### Requirement: Desktop archive admission and independent titles

The module SHALL read positive archive filename evidence and validated provider titles from the existing session_index.jsonl input in its child reader, independently of marker usability. It SHALL publish metadata-observed in the existing lifecycle family. Only the configured Codex Desktop producer and top-level titles qualify. The core SHALL accept metadata observations only from the Codex Desktop module, guard new session admission and ancestor admission from scoped positive archive evidence, and preserve existing sessions. Missing, unreadable or stalled evidence SHALL fail open. Positive archive evidence SHALL refresh every 2 s, clear when no longer confirmed and expire after 7 s. Title metadata SHALL update existing sessions without changing labels, lifecycle evidence timestamps, host session IDs, activity, read, turn, ordering, notices or restart uncertainty.

#### Scenario: Late hook for an archived conversation
- **WHEN** a positive rollout filename names an archived Desktop conversation and a late root or descendant hook arrives
- **THEN** admission refuses it while other hosts and sources remain admitted

#### Scenario: Unarchive and unavailable evidence
- **WHEN** the archive entry disappears or the archive source becomes unavailable or stalls
- **THEN** positive admission evidence clears or expires, and fresh work can be admitted without blocking the core

#### Scenario: Desktop title with a missing marker
- **WHEN** a known top-level Desktop session has a valid session_index.jsonl title and the read marker is missing
- **THEN** its provider title appears, an explicit user label remains the display winner, and lifecycle freshness stays unchanged

#### Scenario: Untrusted metadata publication
- **WHEN** a remote producer sends metadata-observed or attempts to take the module source
- **THEN** it cannot establish archive evidence or overwrite a title

## ADDED Requirements

### Requirement: Optional Codex Desktop read evidence
When configured with a Codex home and a Desktop host and source ID, the host SHALL poll Codex Desktop's unread marker read-only and ingest `read.observed` for top-level sessions from that source. A listed session SHALL become unread. An unlisted session SHALL become read when it was unread, or when its read value is unknown, its activity is idle, interrupted or ended, and its last lifecycle evidence is at least five seconds old. The host SHALL emit only when the value changes, SHALL skip child sessions and sessions from other providers, clients, hosts or sources, and SHALL NOT write Codex files or expose marker contents or paths. Missing, oversized, malformed or unexpectedly shaped input SHALL produce no events.

#### Scenario: Completion read in Codex Desktop
- **WHEN** a completed Desktop session was listed as unread and a later marker omits it
- **THEN** the host records it as read without acknowledging its notice

#### Scenario: Completion viewed as it finished
- **WHEN** a Desktop session's turn ended at least five seconds ago, its read value is unknown and the marker never lists it
- **THEN** the host records it as read

#### Scenario: New unread completion
- **WHEN** a session previously recorded as read is listed in the marker again
- **THEN** the host records it as unread

#### Scenario: Unusable marker
- **WHEN** the marker is missing, unreadable, malformed or has an unexpected version or shape
- **THEN** the host emits no read evidence and existing read values are unchanged

#### Scenario: Unrelated sessions
- **WHEN** the owner holds child sessions or sessions from another client, provider, host or source
- **THEN** the host emits no read evidence for them

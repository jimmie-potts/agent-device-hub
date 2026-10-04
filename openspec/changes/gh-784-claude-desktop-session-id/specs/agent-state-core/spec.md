## ADDED Requirements

### Requirement: Memory-only host session identifier
The owner SHALL keep the latest `hostSessionId` of each session record in memory for its lifetime and serve it only through opt-in snapshot 1.3, which is snapshot 1.2 plus that optional field. A committed lifecycle 1.2 event SHALL set the value when present and clear it when absent; 1.0 and 1.1 events SHALL leave it unchanged. The value SHALL change only with a committed revision and SHALL be removed with its record on retirement, expiry or startup settlement. The owner SHALL NOT use it as an identity, for deduplication, ordering, retirement or merging. Durable format 2.1, its schemas, exports and stored bytes SHALL NOT contain the field. After a restart the field SHALL be absent until the record's next committed 1.2 event. Snapshot 1.0, 1.1 and 1.2 SHALL keep their shapes.

#### Scenario: Opt-in projection
- **WHEN** a Desktop session's 1.2 event commits
- **THEN** snapshot 1.3 shows its `hostSessionId` and snapshots 1.0, 1.1 and 1.2 are unchanged

#### Scenario: Claude clear
- **WHEN** a `/clear` end retires a Desktop hook session and a new hook session starts with the same Desktop ID
- **THEN** the old record is retired and the new record is a separate session carrying the same `hostSessionId`

#### Scenario: Durable state and restart
- **WHEN** the owner exports or restarts after Desktop events
- **THEN** the export validates as durable 2.1 without `hostSessionId`, a previous-format reader reopens the store, and the restarted owner shows the field only after the session's next committed 1.2 event

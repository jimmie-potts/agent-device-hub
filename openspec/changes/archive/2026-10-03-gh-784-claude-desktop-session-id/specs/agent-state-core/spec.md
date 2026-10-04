## ADDED Requirements

### Requirement: Memory-only host session identifier
The owner SHALL keep the latest `hostSessionId` of each session record whose parent is not known in memory for its lifetime and serve it only through opt-in snapshot 1.3, which is snapshot 1.2 plus that optional field. A committed lifecycle 1.2 event SHALL set the value when present and clear it when absent; 1.0 and 1.1 events SHALL leave it unchanged. A record whose parent is known SHALL carry no value, whichever event made the parent known. The value SHALL change only after the durable commit succeeds and before its revision is published, and SHALL be removed with its record on retirement, expiry or startup settlement. The owner SHALL NOT store the value or use it as an identity, ordering, retirement or merge key; content-kind deduplication keys hash the full envelope and therefore include it, as they include display metadata. Durable format 2.1, its schemas, exports and stored bytes SHALL NOT contain the field. After a restart the field SHALL be absent until the record's next committed lifecycle 1.2 event that changes state. Snapshot 1.0, 1.1 and 1.2 SHALL keep their shapes.

#### Scenario: Opt-in projection
- **WHEN** a Desktop session's 1.2 event commits
- **THEN** snapshot 1.3 shows its `hostSessionId` and snapshots 1.0, 1.1 and 1.2 are unchanged

#### Scenario: Claude clear
- **WHEN** a `/clear` end retires a Desktop hook session and a new hook session starts with the same Desktop ID
- **THEN** the old record is retired and the new record is a separate session carrying the same `hostSessionId`

#### Scenario: Known parent
- **WHEN** a record's parent becomes known before or after a 1.2 event carrying `hostSessionId`
- **THEN** snapshot 1.3 shows no `hostSessionId` for that record and passes its own validator

#### Scenario: Durable state and restart
- **WHEN** the owner exports or restarts after Desktop events
- **THEN** the export validates as durable 2.1 without `hostSessionId`, a previous-format reader reopens the store, and the restarted owner shows the field only after the session's next committed 1.2 event

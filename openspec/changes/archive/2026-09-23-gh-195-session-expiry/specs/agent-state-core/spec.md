## ADDED Requirements

### Requirement: Session expiry after a day without lifecycle evidence
The owner SHALL forget a session once 24 hours have passed since its last accepted lifecycle evidence, removing its label, notices and attention in one durable revision. Expiry MUST NOT acknowledge a notice, record readership, success or cancellation, or change any other session. Duplicates, labels, acknowledgments and read evidence MUST NOT renew the window, and a restart MUST NOT reset it. Expiry SHALL run from maintenance, at startup and before admitting an ingest. A `runtime.ended` or read observation for an unknown identity, or any observation 24 hours or more before the owner's wall clock, MUST NOT create or renew a record. New lifecycle evidence after expiry SHALL create a fresh record with defaults. Each record SHALL expire on its own clock.

#### Scenario: Full owner admits new work
- **WHEN** the owner holds 128 sessions whose last evidence is 24 hours old and a new identity arrives
- **THEN** the old sessions expire, the new identity is admitted, and admission continues past 128 lifetime identities

#### Scenario: Window boundary and renewal
- **WHEN** a session's last lifecycle evidence is just under 24 hours old, or a label or acknowledgment was applied since
- **THEN** it remains until 24 hours after that evidence, and new lifecycle evidence moves its expiry forward

#### Scenario: Restart
- **WHEN** the owner restarts before and after a session's 24-hour mark
- **THEN** it keeps the session before the mark and expires it at startup after the mark

#### Scenario: Late or end-only observation
- **WHEN** a runtime end arrives for an unknown identity, or an observation is 24 hours or more older than the owner clock
- **THEN** no record is created or renewed and no loss is counted

#### Scenario: Expired parent
- **WHEN** a parent expires while its child has recent evidence
- **THEN** the child remains, the snapshot validates, and no notice or attention is acknowledged or resolved

## MODIFIED Requirements

### Requirement: Evidence freshness and restart
The owner SHALL expose session observation age independently of collector health. At five minutes without accepted fresh session evidence, observations MUST become uncertain without declaring failure. Restarted previously active sessions MUST remain uncertain until fresh session evidence.

#### Scenario: Healthy collector with an old session
- **WHEN** collector health and snapshot reads continue for five minutes without new session evidence
- **THEN** session observation age continues increasing and the session becomes uncertain

#### Scenario: Restored session
- **WHEN** the owner restarts from saved active state
- **THEN** it retains unexpired sessions' state, labels and notices while reporting restart uncertainty until a fresh observation arrives

### Requirement: Atomic host storage and bounded diagnostic history
The owner SHALL persist state, chosen labels, acknowledgment and undismissed notices through an exclusively acquired host storage boundary. A revision MUST become visible only after its atomic commit succeeds. Diagnostic retention MUST keep only the newest 10,000 entries within 24 hours and MUST NOT itself delete current state, labels or notices; session expiry is governed separately.

#### Scenario: Time and volume retention
- **WHEN** entries pass 24 hours or the journal exceeds 10,000 entries
- **THEN** expired or oldest excess entries disappear while unexpired state and notices remain restorable

#### Scenario: Interrupted commit
- **WHEN** a commit fails or its outcome cannot be established
- **THEN** no speculative revision is published, errors contain no input or adapter exception, and recovery reloads a consistent committed state before further writes

#### Scenario: Ownership conflict
- **WHEN** a second owner attempts to acquire the same store
- **THEN** it cannot become a concurrent authoritative writer

### Requirement: Privacy and bounded admission
The owner SHALL validate lifecycle and persisted inputs before using them. Transport, persistence, diagnostics and errors MUST contain only allowed metadata. After session expiry, bounded capacity or invalid input MUST reject admission with fixed content-free outcomes without deleting the remaining state or blocking agents.

#### Scenario: Private canaries
- **WHEN** a payload or storage adapter error includes prompts, transcripts, tool content, automatic titles, credentials or private paths
- **THEN** excluded values never appear in saved data, snapshots, diagnostics, emitted changes or returned errors

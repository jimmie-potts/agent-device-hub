# agent-state-core Specification

## Purpose

Interpret lifecycle metadata once and supply durable, trustworthy agent-session state to independently registered consumers through an embeddable owner.

## Requirements

### Requirement: Independent lifecycle dimensions
The owner SHALL namespace sessions by the complete lifecycle selector and retain evidenced turn and parent identity. Activity, continuing questions, blocked attention, interruption, runtime end, notices, consumer acknowledgment, optional read evidence and unavailable dimensions MUST remain distinct.

#### Scenario: Activity while attention remains open
- **WHEN** a session receives a continuing question, a different approval request and later activity
- **THEN** both attention items remain and activity does not acknowledge a notice or grant approval

#### Scenario: Correlated acknowledgment
- **WHEN** one registered consumer acknowledges a durable notice
- **THEN** only that consumer's view of that notice clears, other attention/notices/read evidence remain, and restart preserves the acknowledgment

#### Scenario: Runtime ends after a turn
- **WHEN** a turn-ended notice exists and runtime-end evidence arrives
- **THEN** the notice survives without claiming success or readership

### Requirement: Conservative ordering and stable identities
The owner SHALL deduplicate unchanged retries, reject evidenced prior-turn changes, keep ordering uncertainty visible and count only attributable fresh children. Arrival time and opaque IDs MUST NOT be presented as authoritative provider order. Unknown correlation MUST NOT resolve unrelated attention.

#### Scenario: Delayed event after a newer evidenced turn
- **WHEN** an event belongs to a known retired turn or precedes a newer applicable sequence in the same ordering epoch
- **THEN** it cannot restore a dismissed notice or overwrite newer state

#### Scenario: Unordered observations
- **WHEN** order, turn or parent evidence is unavailable or contradictory
- **THEN** the snapshot retains uncertainty instead of fabricating ordering or parentage, and ambiguous transitions cannot clear unrelated state

#### Scenario: Concurrent duplicate child observations
- **WHEN** concurrent producers retry and reorder observations for the same child
- **THEN** the owner serializes commits, retains one child identity, and a child's end does not complete its parent

### Requirement: Evidence freshness and restart
The owner SHALL expose session observation age independently of collector health. At five minutes without accepted fresh session evidence, observations MUST become uncertain without declaring failure. Restarted previously active sessions MUST remain uncertain until fresh session evidence.

#### Scenario: Healthy collector with an old session
- **WHEN** collector health and snapshot reads continue for five minutes without new session evidence
- **THEN** session observation age continues increasing and the session becomes uncertain

#### Scenario: Restored session
- **WHEN** the owner restarts from saved active state
- **THEN** it retains state, label and notices while reporting restart uncertainty until a fresh observation arrives

### Requirement: Atomic host storage and bounded diagnostic history
The owner SHALL persist state, chosen labels, acknowledgment and undismissed notices through an exclusively acquired host storage boundary. A revision MUST become visible only after its atomic commit succeeds. Diagnostic retention MUST keep only the newest 10,000 entries within 24 hours and MUST NOT delete current state, labels or notices.

#### Scenario: Time and volume retention
- **WHEN** entries pass 24 hours or the journal exceeds 10,000 entries
- **THEN** expired or oldest excess entries disappear while state and notices remain restorable

#### Scenario: Interrupted commit
- **WHEN** a commit fails or its outcome cannot be established
- **THEN** no speculative revision is published, errors contain no input or adapter exception, and recovery reloads a consistent committed state before further writes

#### Scenario: Ownership conflict
- **WHEN** a second owner attempts to acquire the same store
- **THEN** it cannot become a concurrent authoritative writer

### Requirement: Bounded independent current-state consumers
The owner SHALL expose immutable revisioned state, snapshots and subscriptions for registered consumers. Each consumer MUST have at most 128 queued notifications and 256 KiB of queued bytes. Each notification MUST be at most 2 KiB. Slow consumers MUST NOT delay admission, other consumers or hook return. Expired history MUST recover from current snapshots without replaying effects.

#### Scenario: Two healthy consumers and a stalled third
- **WHEN** two consumers drain changes while a third stalls through overflow
- **THEN** the first two continue, the stalled queue stays bounded and reports resynchronization, and recovery reads the current snapshot

#### Scenario: Expired cursor
- **WHEN** a consumer reconnects with an expired or invalid cursor
- **THEN** it receives an explicit snapshot-resynchronization notification instead of old effects

### Requirement: Privacy and bounded admission
The owner SHALL validate lifecycle and persisted inputs before using them. Transport, persistence, diagnostics and errors MUST contain only allowed metadata. Bounded capacity or invalid input MUST reject admission with fixed content-free outcomes without deleting retained state or blocking agents.

#### Scenario: Private canaries
- **WHEN** a payload or storage adapter error includes prompts, transcripts, tool content, automatic titles, credentials or private paths
- **THEN** excluded values never appear in saved data, snapshots, diagnostics, emitted changes or returned errors

### Requirement: Versioned embedding and migration
The package SHALL provide ingest, snapshots, subscriptions, labels, acknowledgment, shutdown and versioned migration interfaces. Export MUST quiesce writes and preserve identities, revisions, notices and source installation identity. Import MUST validate compatibility and use one exclusive owner. TypeScript and Python consumers MUST validate the same snapshot fixtures without a second reducer.

#### Scenario: Export import and rollback
- **WHEN** an owner quiesces and exports state for an empty replacement store
- **THEN** import preserves durable state and revision lineage, rejects incompatible or malformed data, and the original store remains available for an explicit rollback after the replacement releases ownership

#### Scenario: External consumer
- **WHEN** the reproducible private archive is installed outside the checkout
- **THEN** its embedding imports, type declarations, shared fixtures, Python validator and artifact hashes work without checkout-relative imports

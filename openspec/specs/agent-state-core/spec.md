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
The owner SHALL deduplicate unchanged retries, reject evidenced prior-turn activity changes, keep ordering uncertainty visible and count only attributable fresh children. Arrival time and opaque IDs MUST NOT be presented as authoritative provider order. When qualified activity ordering is unavailable, the owner SHALL use the best-effort current-turn policy below. Unknown correlation MUST NOT resolve unrelated attention.

#### Scenario: Delayed event after a newer evidenced turn
- **WHEN** an activity event belongs to a remembered retired turn or precedes a newer applicable sequence in the same ordering epoch
- **THEN** it cannot restore a dismissed notice or overwrite newer activity

#### Scenario: Unordered observations
- **WHEN** turn or parent identity is missing, evidence conflicts, or an unordered observation cannot establish an eligible current-turn transition
- **THEN** the snapshot retains the affected uncertainty without fabricating ordering or parentage, and the observation cannot clear unrelated state

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
The package SHALL provide ingest, snapshots, subscriptions, labels, acknowledgment, shutdown and versioned migration interfaces. Export MUST quiesce writes and preserve identities, revisions, notices and source installation identity. Import MUST validate compatibility and use one exclusive owner. TypeScript and Python consumers MUST validate the same snapshot fixtures without a second reducer. The best-effort implementation MUST accept existing version 1.0 durable state without deletion or owner relocation, and MUST publish new immutable package versions with source and checksum receipts.

#### Scenario: Export import and rollback
- **WHEN** an owner quiesces and exports state for an empty replacement store
- **THEN** import preserves durable state and revision lineage, rejects incompatible or malformed data, and the original store remains available for an explicit rollback after the replacement releases ownership

#### Scenario: External consumer
- **WHEN** the reproducible private archive is installed outside the checkout
- **THEN** its embedding imports, type declarations, shared fixtures, Python validator and artifact hashes work without checkout-relative imports

#### Scenario: Existing ambiguous session
- **WHEN** an existing version 1.0 session is restored with ambiguous activity/current turn and receives an eligible fresh turn start
- **THEN** the owner selects that turn without resetting the store, preserves labels, unrelated notices and attention, applies only configured completion clearing, and retains uncertainty about unavailable provider order

### Requirement: Best-effort current-turn selection
For a session without qualified activity ordering, a valid start with known session and turn identity that has not already been selected, retired or completed within the retained evidence SHALL select that turn and set activity active. A matching stop SHALL set its activity idle and retain a stable completion notice without claiming success or readership. A new selection SHALL clear prior known-turn completion notices only for consumers whose clearOnNewTurn policy enables it. Attention, read evidence, other sessions and explicit consumer-scoped acknowledgment MUST remain independent. Provider ordering MUST remain unknown when it was unknown at ingestion.

#### Scenario: Ordinary provider lifecycle
- **WHEN** the actual provider normalizer and packaged hook deliver start A, stop A and start B with unknown ordering
- **THEN** activity progresses active, idle and active, the current turn is B, A's notice clears only for enabled consumers, and no synthetic provider sequence is needed

#### Scenario: Duplicate or delayed selected-turn start
- **WHEN** a selected turn's start repeats while active or arrives after its completion
- **THEN** it cannot refresh duplicate evidence, reactivate the completed turn, clear unrelated notices or undo acknowledgment

#### Scenario: Independent attention and sessions
- **WHEN** one session starts a new turn while it retains approval/input attention and another session has activity and notices
- **THEN** the new turn preserves that attention and the other session, and a correlated attention resolution or notice acknowledgment affects only its named item and consumer

#### Scenario: Previously unseen delayed start
- **WHEN** a valid start for an older but unremembered turn arrives after the current turn
- **THEN** receipt-based selection can choose it and clear covered notices, while ordering remains unknown and the documented limitation makes no provider-order or reliable-history claim

#### Scenario: Genuine ordering remains authoritative evidence
- **WHEN** comparable qualified ordering is available, or an unordered observation conflicts with a session's qualified activity ordering
- **THEN** existing sequence and epoch checks remain effective and the receipt fallback cannot retire a turn supported by that ordering

#### Scenario: Qualified attention arrives before its turn start
- **WHEN** a newer comparable qualified attention observation precedes the delivery of its earlier turn start
- **THEN** the attention observation establishes its turn and preserves its attention immediately, retires the old turn and clears only enabled old-turn notices, and the delayed start cannot undo that observation

### Requirement: Bounded current-status memory
Remembered retired turn identities SHALL be bounded to the most recent 256 distinct retirements per session. Adding another retirement SHALL evict the oldest remembered retirement without deleting labels, notices, attention or diagnostic history. Retained completion notices SHALL continue to prevent reactivation of their known turns. Events older than all applicable identity and sequence evidence MUST NOT be claimed to be rejectable. Diagnostic journal retention MUST remain separate from current-status memory and MUST NOT be represented as complete event history.

#### Scenario: Identity retention exhaustion
- **WHEN** more than 256 distinct turns are superseded
- **THEN** current activity continues, remembered retirements remain bounded, recent old turns cannot overwrite it, and an evicted turn without other retained evidence has the documented unseen-start limitation

#### Scenario: Restart and freshness
- **WHEN** the owner restarts or the session has no fresh evidence for five minutes
- **THEN** restart/freshness uncertainty remains visible, duplicate delivery cannot make it current, and retained stale-event protection survives restart

### Requirement: Explicit uncertain approval recovery
The owner SHALL allow an authorized host to retire exactly one unknown-ID approval for an exact session and known turn only when that session is uncertain and the request names the current owner revision. It SHALL persist a distinguishable recovery diagnostic in the compatible version 1.0 journal and preserve unrelated attention, activity, notices and uncertainty. Recovery SHALL NOT approve or deny a provider permission or infer that work succeeded. A fresh provider observation MAY create a new approval marker.

#### Scenario: Recover one old uncorrelated approval
- **WHEN** an explicit operation names a session, its current known turn and revision with exactly one unknown-ID approval and uncertain session freshness
- **THEN** only that approval is removed in a durable new revision while other state remains and a recovery journal entry is retained

#### Scenario: Reject ambiguous or changed evidence
- **WHEN** evidence is fresh, the revision or turn changed, or zero or multiple matching approvals exist
- **THEN** the owner rejects recovery without changing state

## MODIFIED Requirements

### Requirement: Independent lifecycle dimensions
The owner SHALL namespace sessions by the complete lifecycle selector and retain evidenced turn and parent identity. Activity, continuing questions, blocked attention, interruption, runtime end, notices, consumer acknowledgment, optional read evidence and unavailable dimensions MUST remain distinct.

#### Scenario: Activity while attention remains open
- **WHEN** a session receives a continuing question, a different approval request and later activity
- **THEN** both attention items remain and activity does not acknowledge a notice or grant approval

#### Scenario: Correlated acknowledgment
- **WHEN** one registered consumer acknowledges a durable notice
- **THEN** only that consumer's view of that notice clears, other attention/notices/read evidence remain, and restart preserves the acknowledgment

#### Scenario: Runtime ends after a turn
- **WHEN** a turn-ended notice exists and runtime-end evidence arrives for a provider/client other than Codex Desktop
- **THEN** the notice survives without claiming success or readership

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

Durable format 2.0 SHALL retain bounded retirement evidence and record generations. Importing format 1.0 SHALL preserve session evidence clocks and current state, assigning legacy generation zero. Snapshot 1.0 SHALL remain available unchanged; opt-in snapshot 1.1 SHALL expose the generation. Unsupported formats SHALL fail closed.

#### Scenario: Consumer misses retirement
- **WHEN** a consumer last observed a record, misses its retirement, and next observes the same native identity recreated
- **THEN** snapshot 1.1 exposes a different generation and a generation-aware consumer discards old task-specific state without replaying effects or changing global settings

## ADDED Requirements

### Requirement: Codex Desktop end retirement
A normalized `runtime.ended` for a known Codex Desktop session SHALL remove that record and every descendant connected by known parent selectors in one atomic update and one published revision. Unknown or repeated ends SHALL create nothing. Retirement SHALL free owner capacity and forget monitoring labels, project overrides, attention and notices without acknowledgment, readership, success, cancellation or agent termination. Other provider/client policies, unrelated sessions and global settings SHALL remain unchanged. Ordinary completion, waiting, read/acknowledgment and freshness uncertainty SHALL NOT retire a session; a turn exceeding thirty minutes SHALL remain until independent end or expiry evidence. Each record's existing 24-hour expiry SHALL remain the fallback.

#### Scenario: One end removes a known tree
- **WHEN** a Desktop parent with known descendants and an unrelated session receives an accepted normalized runtime end
- **THEN** parent and descendants disappear together, capacity is released in one published revision, and the unrelated session remains intact

#### Scenario: No end inferred from age or completion
- **WHEN** a turn completes, waits for input, is read or acknowledged, becomes freshness-uncertain or runs beyond thirty minutes
- **THEN** its record remains until runtime-end evidence or its own 24-hour evidence expiry

### Requirement: Bounded retirement admission memory
The owner SHALL persist retirement evidence separately from active records and diagnostic history, bounded to 128 identities for 24 hours with oldest-first eviction. It SHALL retain up to 256 known turn IDs, retry keys and ordering watermarks per identity. Recognizable delayed events and old ends SHALL NOT recreate or retire a fresh record. A retired identity SHALL require an eligible session or turn start to create a fresh record with a new generation and defaults. An event naming a retired absent parent SHALL NOT admit a new child. No relationship or provider order SHALL be guessed from receipt time or opaque IDs. Events without retained identity/order evidence, including evidence lost by eviction, SHALL have explicitly documented best-effort limits.

#### Scenario: Delayed evidence across restart and resume
- **WHEN** a record retires, the owner restarts, and an old turn event, repeated end or comparable old sequence arrives before or after an eligible new start
- **THEN** recognizable old evidence is ignored, and the eligible start creates fresh monitoring without old labels, attention or notices

#### Scenario: Child after parent retirement
- **WHEN** an event attempts to admit a child whose known parent is retired and absent
- **THEN** the child is not admitted; missing or unretained parent evidence remains an explicit limitation

#### Scenario: Bounded history
- **WHEN** retirement history reaches its count or age bound
- **THEN** pruning is durable, active session capacity is unaffected, and rejection of events beyond retained evidence is not claimed

## REMOVED Requirements

### Requirement: Codex Desktop end retirement
**Reason**: Retirement is no longer specific to Codex Desktop; the shared rule below covers every supported path.
**Migration**: No wire or durable format change. Stores from the Desktop-only owner settle stored accepted ends at startup as the migration requirement below describes.

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
- **WHEN** a turn-ended notice exists and runtime-end evidence arrives for a different identity, or the session is interrupted
- **THEN** the notice survives without claiming success or readership, and only the session's own accepted end retires its record on any supported path

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

Opening a store written while only Codex Desktop retired SHALL settle it once at startup: every record holding an accepted end as activity `ended`, with its known descendants, SHALL be retired in one durable revision with the same bounded guards, without a journal row, acknowledgment, read evidence, evidence-clock reset or old-effect replay. Records with idle, waiting, interrupted or unknown activity SHALL be retained unchanged with their own expiry; the owner MUST NOT infer an end from idle or unknown activity or from transcripts.

#### Scenario: Consumer misses retirement
- **WHEN** a consumer last observed a record, misses its retirement, and next observes the same native identity recreated
- **THEN** snapshot 1.1 exposes a different generation and a generation-aware consumer discards old task-specific state without replaying effects or changing global settings

#### Scenario: Stored accepted end settles on startup
- **WHEN** the owner opens a format 1.0 or 2.0 store holding a record with activity `ended`, its known child, and idle, waiting and unknown records
- **THEN** one new revision removes the ended record and child with retirement guards, the other records keep their evidence clocks, notices and attention, a delayed old event for the settled identity is rejected, an eligible new start creates a fresh generation, and a restart keeps the settlement

## ADDED Requirements

### Requirement: Runtime-end retirement
A normalized `runtime.ended` for a known session on any supported provider/client path (Codex Desktop, Codex CLI and Claude Code) SHALL remove that record and every descendant connected by known parent selectors in one atomic update and one published revision. Unknown or repeated ends SHALL create nothing. Retirement SHALL free owner capacity and forget monitoring labels, project overrides, attention and notices, even when notices or attention remain, without acknowledgment, readership, success, cancellation or agent termination. Unrelated sessions and global settings SHALL remain unchanged; ending one path's last session MUST NOT remove another path's session, including a session with the same native session ID under a different selector, and no ended record SHALL survive merely because of its path. Ordinary completion, child turn completion, interruption, waiting, read/acknowledgment and freshness uncertainty SHALL NOT retire a session; a turn exceeding thirty minutes SHALL remain until independent end or expiry evidence. Each record's existing 24-hour expiry SHALL remain the only fallback.

#### Scenario: One end removes a known tree on each path
- **WHEN** a Codex Desktop, Codex CLI or Claude Code parent with known descendants and unrelated sessions receives an accepted normalized runtime end
- **THEN** parent and descendants disappear together, capacity is released in one published revision, and the unrelated sessions remain intact

#### Scenario: Mixed paths keep unrelated records
- **WHEN** sessions with the same native session ID exist on several paths and one path's session receives an accepted end
- **THEN** only that path's known tree is removed, the other paths' records and notices are unchanged, and an end for an identity never seen on any path creates nothing

#### Scenario: No end inferred from age or completion
- **WHEN** a turn completes, a child's turn completes, a session is interrupted, waits for input, is read or acknowledged, becomes freshness-uncertain or runs beyond thirty minutes
- **THEN** its record remains until runtime-end evidence or its own 24-hour evidence expiry

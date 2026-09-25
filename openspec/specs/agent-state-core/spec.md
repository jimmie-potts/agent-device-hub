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
- **WHEN** a turn-ended notice exists and runtime-end evidence arrives for a different identity, or the session is interrupted
- **THEN** the notice survives without claiming success or readership, and only the session's own accepted end retires its record on any supported path

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

### Requirement: Bounded independent current-state consumers
The owner SHALL expose immutable revisioned state, snapshots and subscriptions for registered consumers. Each consumer MUST have at most 128 queued notifications and 256 KiB of queued bytes. Each notification MUST be at most 2 KiB. Slow consumers MUST NOT delay admission, other consumers or hook return. Expired history MUST recover from current snapshots without replaying effects.

#### Scenario: Two healthy consumers and a stalled third
- **WHEN** two consumers drain changes while a third stalls through overflow
- **THEN** the first two continue, the stalled queue stays bounded and reports resynchronization, and recovery reads the current snapshot

#### Scenario: Expired cursor
- **WHEN** a consumer reconnects with an expired or invalid cursor
- **THEN** it receives an explicit snapshot-resynchronization notification instead of old effects

### Requirement: Privacy and bounded admission
The owner SHALL validate lifecycle and persisted inputs before using them. Transport, persistence, diagnostics and errors MUST contain only allowed metadata. After session expiry, bounded capacity or invalid input MUST reject admission with fixed content-free outcomes without deleting the remaining state or blocking agents.

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

Durable format 2.0 SHALL retain bounded retirement evidence and record generations. Importing format 1.0 SHALL preserve session evidence clocks and current state, assigning legacy generation zero. Snapshot 1.0 SHALL remain available unchanged; opt-in snapshot 1.1 SHALL expose the generation. Unsupported formats SHALL fail closed.

Opening a store written while only Codex Desktop retired SHALL settle it once at startup: every record holding an accepted end as activity `ended`, with its known descendants, SHALL be retired in one durable revision with the same bounded guards, without a journal row, acknowledgment, read evidence, evidence-clock reset or old-effect replay. Records with idle, waiting, interrupted or unknown activity SHALL be retained unchanged with their own expiry; the owner MUST NOT infer an end from idle or unknown activity or from transcripts.

#### Scenario: Consumer misses retirement
- **WHEN** a consumer last observed a record, misses its retirement, and next observes the same native identity recreated
- **THEN** snapshot 1.1 exposes a different generation and a generation-aware consumer discards old task-specific state without replaying effects or changing global settings

#### Scenario: Stored accepted end settles on startup
- **WHEN** the owner opens a format 1.0 or 2.0 store holding a record with activity `ended`, its known child, and idle, waiting and unknown records
- **THEN** one new revision removes the ended record and child with retirement guards, the other records keep their evidence clocks, notices and attention, a delayed old event for the settled identity is rejected, an eligible new start creates a fresh generation, and a restart keeps the settlement

### Requirement: Best-effort current-turn selection
For a session without qualified activity ordering, a valid start with known session and turn identity that has not already been selected, retired or completed within the retained evidence SHALL select that turn and set activity active. A matching stop SHALL set its activity idle and retain a stable completion notice without claiming success or readership. A new selection SHALL clear prior known-turn completion notices only for consumers whose clearOnNewTurn policy enables it. Attention, read evidence, other sessions and explicit consumer-scoped acknowledgment MUST remain independent, except that retiring a turn forgets its approvals without a request ID. Provider ordering MUST remain unknown when it was unknown at ingestion.

#### Scenario: Ordinary provider lifecycle
- **WHEN** the actual provider normalizer and packaged hook deliver start A, stop A and start B with unknown ordering
- **THEN** activity progresses active, idle and active, the current turn is B, A's notice clears only for enabled consumers, and no synthetic provider sequence is needed

#### Scenario: Duplicate or delayed selected-turn start
- **WHEN** a selected turn's start repeats while active or arrives after its completion
- **THEN** it cannot refresh duplicate evidence, reactivate the completed turn, clear unrelated notices or undo acknowledgment

#### Scenario: Independent attention and sessions
- **WHEN** one session starts a new turn while it retains approval/input attention and another session has activity and notices
- **THEN** the new turn preserves that attention and the other session, except an approval without a request ID on the retired turn, and a correlated attention resolution or notice acknowledgment affects only its named item and consumer

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

### Requirement: Read evidence separate from observation freshness
The owner SHALL apply `read.observed` only to the session's read dimension. A read observation MUST NOT refresh observation age, freshness or the session's observed timestamp, MUST NOT clear restart uncertainty, and MUST NOT create a session for an unknown identity. The latest accepted read observation SHALL set `read` to `read` or `unread` without acknowledging or removing notices.

#### Scenario: Read observation on an old session
- **WHEN** a session has been without lifecycle evidence for five minutes and then receives a read observation
- **THEN** its read value changes while its observation age keeps increasing and it stays uncertain

#### Scenario: Read observation after restart
- **WHEN** the owner restarts from saved state and a read observation arrives before any lifecycle evidence
- **THEN** the session reports the new read value and remains restart-uncertain

#### Scenario: Read observation for an unknown identity
- **WHEN** a read observation names a session the owner does not hold
- **THEN** no session is created and no loss is counted

#### Scenario: Read value changes back
- **WHEN** a session observed as read is later observed as unread
- **THEN** it reports unread and its notices and acknowledgments are unchanged

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

### Requirement: Retired-turn approvals without a request ID
The owner SHALL forget an approval without a request ID once it retires that approval's known turn, and SHALL NOT retain such an approval that arrives for a turn it already retired. On startup it SHALL remove stored approvals of that kind on already-retired turns in one durable revision without a journal row. Approvals on the current turn or on turns the owner never selected, approvals with a request ID, questions and input requests MUST remain. Forgetting MUST NOT record a permission decision, acknowledgment, success or cancellation.

#### Scenario: Newer turn starts
- **WHEN** a session holds an approval without a request ID on its current turn and a newer turn is selected
- **THEN** the approval is removed and the new turn is current

#### Scenario: Current or unselected turn
- **WHEN** an approval without a request ID is on the current turn or on a turn the owner never selected
- **THEN** it remains when another turn starts

#### Scenario: Late approval for a retired turn
- **WHEN** an approval without a request ID arrives for a turn the session already retired
- **THEN** it is not retained

#### Scenario: Stored backlog
- **WHEN** the owner starts from a store holding approvals without a request ID on retired turns
- **THEN** one new revision removes them, and a restart keeps them removed

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

### Requirement: Commit notification without a registered consumer
The owner SHALL expose a listener registration that receives a notification after every committed revision, from any admission path, without a registered consumer ID, durable configuration or cursor. Registering or unregistering a listener MUST NOT change `incompatible-state` compatibility for an existing store. A listener error MUST be isolated from the commit path that raised it: it MUST NOT fault the collector, and the triggering call's outcome MUST remain successful.

#### Scenario: Every commit path notifies
- **WHEN** a session commit, a session-replacing commit (expiry, retirement, settlement or format migration) or a maintenance-only commit succeeds
- **THEN** every registered listener is called once for that revision, without requiring a consumer to have been configured at startup

#### Scenario: A throwing listener cannot fault admission
- **WHEN** a registered listener throws
- **THEN** the collector remains `running`, the triggering call's outcome is unaffected, and later commits still notify remaining and newly registered listeners

#### Scenario: Unsubscribing stops notifications
- **WHEN** a caller invokes the unsubscribe function a listener registration returned
- **THEN** that listener receives no further notifications from later commits

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

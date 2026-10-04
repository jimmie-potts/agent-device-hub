## MODIFIED Requirements

### Requirement: Privacy and bounded admission
The owner SHALL validate lifecycle and persisted inputs before using them. Transport, persistence, diagnostics and errors MUST contain only versioned allowed metadata, including title/project display fields. After session expiry, bounded capacity or invalid input MUST reject admission with fixed content-free outcomes without deleting the remaining state or blocking agents, with one exception: when the owner is full and an event would create a root session (one whose parent is not known), the owner SHALL retire one child record and its descendants through the ordinary retirement path, choosing among child records whose whole subtree is finished (activity idle, interrupted or ended) and holds no attention the one whose newest subtree evidence is oldest, count the displacement as loss, and admit the root; the displaced records' later events other than an eligible start SHALL be rejected as stale. A new child MUST NOT displace a record, a root MUST NOT be displaced, and with no eligible child the root MUST be rejected as capacity.

#### Scenario: Private canaries
- **WHEN** a payload or storage adapter error includes credentials, tokens or undeclared content
- **THEN** excluded values never appear in saved data, snapshots, diagnostics, emitted changes or returned errors

#### Scenario: Full owner admits a new root task over a subagent record
- **WHEN** the owner holds 128 sessions, some of them finished child subtrees without attention, and an event would create a new root session
- **THEN** the eligible subtree with the oldest newest evidence is retired, the loss count rises by one, the root is admitted, and the displaced records' later events other than an eligible start are rejected as stale

#### Scenario: Full owner keeps attention and roots
- **WHEN** the owner is full and the new identity is a child, or every child's subtree holds attention or a record whose activity is active or unknown
- **THEN** admission is rejected as capacity and no record is removed, so a running subagent or a pending approval never disappears to make room

### Requirement: Runtime-end retirement
A normalized `runtime.ended` for a known session on any supported provider/client path (Codex Desktop, Codex CLI and Claude Code) SHALL remove that record and every descendant connected by known parent selectors in one atomic update and one published revision. Unknown or repeated ends SHALL create nothing. Retirement SHALL free owner capacity and forget monitoring labels, project overrides, attention and notices, even when notices or attention remain, without acknowledgment, readership, success, cancellation or agent termination. Unrelated sessions and global settings SHALL remain unchanged; ending one path's last session MUST NOT remove another path's session, including a session with the same native session ID under a different selector, and no ended record SHALL survive merely because of its path. Ordinary completion, child turn completion, interruption, waiting, read/acknowledgment and freshness uncertainty SHALL NOT retire a session; a turn exceeding thirty minutes SHALL remain until independent end or expiry evidence. Each record's existing 24-hour expiry SHALL remain the only fallback, except that bounded admission MAY retire a finished child subtree without attention to admit a new root when the owner is full.

#### Scenario: One end removes a known tree on each path
- **WHEN** a Codex Desktop, Codex CLI or Claude Code parent with known descendants and unrelated sessions receives an accepted normalized runtime end
- **THEN** parent and descendants disappear together, capacity is released in one published revision, and the unrelated sessions remain intact

#### Scenario: Mixed paths keep unrelated records
- **WHEN** sessions with the same native session ID exist on several paths and one path's session receives an accepted end
- **THEN** only that path's known tree is removed, the other paths' records and notices are unchanged, and an end for an identity never seen on any path creates nothing

#### Scenario: No end inferred from age or completion
- **WHEN** a turn completes, a child's turn completes, a session is interrupted, waits for input, is read or acknowledged, becomes freshness-uncertain or runs beyond thirty minutes
- **THEN** its record remains until runtime-end evidence or its own 24-hour evidence expiry; only a finished child subtree without attention may leave earlier, displaced by a new root when the owner is full

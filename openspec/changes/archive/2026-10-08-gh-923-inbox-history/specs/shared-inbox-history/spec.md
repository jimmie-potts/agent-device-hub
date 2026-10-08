## ADDED Requirements

### Requirement: One durable shared operation inbox

The core SHALL derive one inbox item per failed (including expired), uncertain or conflicting tracked operation in the tracker transaction. Finished agent turns and gateway-only session-label-set/notice-clear metadata actions SHALL remain absent; metadata actions retain tracker/history evidence. Items SHALL survive restart until handled, without expiry or automatic clearing. Display dismissal SHALL remain separate from handling, and handling SHALL preserve device holds.

#### Scenario: Late evidence and conflict
- **WHEN** definitive evidence arrives for an open uncertain item
- **THEN** its evidence updates while the item remains open
- **WHEN** a succeeded and failed outcome conflict for an operation with no item or a handled item
- **THEN** one item opens or reopens with both outcomes above its prior removal revision
- **WHEN** a nonconflicting late outcome follows handling or a reused source/message ID is refused
- **THEN** no item opens

### Requirement: Explicit handling and send-again

The bounded core handling command, gateway, MCP and dashboard SHALL use one handling path that records its actor and publishes a deleted removal. Send-again SHALL use saved operation data and a new request ID. Its initial tracked sent row and original handling SHALL commit together before transmission. No restart, reload, reconnect or timeout SHALL resend a command automatically.

#### Scenario: Atomic explicit resend
- **WHEN** two callers handle the same revision or the initial resend commit fails
- **THEN** at most one new tracked command is sent, and a failed initial commit preserves the original item

### Requirement: Read-only filtered history surfaces

Every authorized reader SHALL see the whole inbox and history. Gateway and MCP history reads SHALL validate and combine inclusive time, kind, source and qualified-session filters without triggering actions. The dashboard SHALL present the synced inbox and a keyboard-accessible filtered timeline, hide write controls from readers and disable stale writes.

#### Scenario: Shared handling and private retained reads
- **WHEN** an operator handles an item in the dashboard
- **THEN** a subsequent MCP inbox read shows it absent
- **WHEN** a reader filters history or reloads the dashboard
- **THEN** no device command is sent

### Requirement: Existing sync message bound

A synthetic 1,000-item inbox sync SHALL record the largest encoded state or sync-completed message and total answer bytes, verifying the existing 256 KiB per-message bound without imposing an aggregate cap or timing target.

#### Scenario: One synthetic size check
- **WHEN** 1,000 synthetic open items sync
- **THEN** every encoded message fits the existing cap and both maximum and aggregate bytes are recorded

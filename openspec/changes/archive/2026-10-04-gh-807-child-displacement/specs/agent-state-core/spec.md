## MODIFIED Requirements

### Requirement: Privacy and bounded admission
The owner SHALL validate lifecycle and persisted inputs before using them. Transport, persistence, diagnostics and errors MUST contain only versioned allowed metadata, including title/project display fields. After session expiry, bounded capacity or invalid input MUST reject admission with fixed content-free outcomes without deleting the remaining state or blocking agents, with one exception: when the owner is full and an event would create a root session (one whose parent is not known), the owner SHALL retire the least recently active child record whose subtree holds no attention, with its descendants, through the ordinary retirement path, count the displacement as loss, and admit the root. A new child MUST NOT displace a record, a root MUST NOT be displaced, and with no eligible child the root MUST be rejected as capacity.

#### Scenario: Private canaries
- **WHEN** a payload or storage adapter error includes credentials, tokens or undeclared content
- **THEN** excluded values never appear in saved data, snapshots, diagnostics, emitted changes or returned errors

#### Scenario: Full owner admits a new root task over a subagent record
- **WHEN** the owner holds 128 sessions, some of them child records without attention, and an event would create a new root session
- **THEN** the least recently active such child and its descendants are retired, the loss count rises by one, the root is admitted, and the displaced child's delayed events are rejected as stale

#### Scenario: Full owner keeps attention and roots
- **WHEN** the owner is full and the new identity is a child, or every child's subtree holds attention
- **THEN** admission is rejected as capacity and no record is removed

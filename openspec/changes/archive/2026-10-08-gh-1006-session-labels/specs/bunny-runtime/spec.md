## ADDED Requirements

### Requirement: Authenticated tracked session labels

The runtime SHALL admit `session-label-set` through its authenticated gateway using existing `control` authority over HTTP and MCP. The action SHALL pass through the tracker with caller attribution. Ordinary module/core dispatch and SDK command grants SHALL NOT admit this operator action, including attempts with copied identifiers or claimed authority in JSON. Existing direct operator commands SHALL retain their behavior.

#### Scenario: HTTP and MCP control admission
- **WHEN** a current authenticated control caller requests a session label through HTTP or MCP
- **THEN** the gateway admits one tracked action attributed to that caller

#### Scenario: Unqualified admission
- **WHEN** a read/ingest caller, ordinary module dispatch or raw SDK command attempts a label, or a caller's credential is no longer current
- **THEN** the runtime refuses it without changing the label or recording a successful outcome

#### Scenario: Copied or mutated request facts
- **WHEN** a second command copies an admitted request ID or the caller mutates its original payload while admission waits
- **THEN** only the command bound to the originally admitted immutable action can change the session

### Requirement: Guarded durable label completion

The core SHALL set a label with user provenance or clear it through the existing agent-state owner, retaining explicit-user precedence and title/native neutral fallback. It SHALL refuse an unknown session with `not-found` and an unequal session-record revision with `revision-conflict`, including intervening owner maintenance. The session save, tracker completion, history, outcome and participating tracked projections SHALL commit atomically before a successful reply. A same-user-label or already-clear request SHALL complete without inventing a session revision. Metadata completion SHALL NOT claim physical-device evidence.

#### Scenario: Set, clear and restart
- **WHEN** a control caller sets and then clears a session label using its current revision and the core restarts
- **THEN** each completed change is reflected in the session record and retained history, user precedence holds when set, and the fallback is restored when cleared

#### Scenario: Revision and existence refusals
- **WHEN** the session is unknown or its revision changes before the label mutation, including maintenance queued ahead of it
- **THEN** the core returns `not-found` or `revision-conflict` respectively and leaves the current session unchanged

#### Scenario: No-op
- **WHEN** the current user label already equals the request or the session already has no label and clearing is requested
- **THEN** the tracked action completes durably and the session record retains its revision

#### Scenario: Live operation projection
- **WHEN** a label action completes, including a no-op or a result arriving after transport uncertainty
- **THEN** the real operation projection is published in the outcome's transaction and its live copy agrees with a fresh snapshot of the completed operation

#### Scenario: Transaction failure
- **WHEN** state saving, outcome validation, a tracked projection or storage capacity prevents the transaction from committing
- **THEN** the session, completion, history and outcome roll back together, no success is reported, and the core preserves its existing recovery behavior

### Requirement: Label identity and deadline recovery

The tracker SHALL preserve request deduplication and never resend an already recorded label action after retry or restart. A repeated request identity SHALL match the original caller, target, family, schema and payload and SHALL NOT replace its admission context. A request deadline SHALL retain uncertainty while admitted work can complete later. Committed outcomes pending publication SHALL be published after recovery without rerunning the label command; unrelated maintenance SHALL NOT complete that action.

#### Scenario: Concurrent and restarted duplicates
- **WHEN** the same action is dispatched concurrently or repeated after restart with the same request ID
- **THEN** it is sent at most once and the duplicate observes the durable operation without replacing the active admission

#### Scenario: Late completion
- **WHEN** an admitted label waits beyond the transport deadline before its owner save completes
- **THEN** the operation first records uncertainty and later records the durable completion without re-admission or a new command

#### Scenario: Publication failure
- **WHEN** the atomic save commits and publication fails before the core restarts
- **THEN** recovery retains the changed label and completed operation, publishes pending state/outcome through the existing duplicate-safe outbox rules, and sends no label command again

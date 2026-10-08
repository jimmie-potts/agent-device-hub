## ADDED Requirements

### Requirement: Tracked atomic operator notice override
The runtime SHALL admit `notice-clear` only through authenticated operator dispatch. It SHALL acknowledge the selected current notice for every configured consumer through the state owner and atomically commit that save with matching tracker completion, history, outcome and operation projection. Unknown sessions SHALL be `not-found`; changed session revision or notice selection SHALL be `revision-conflict`, checked again at save time. A null selection for a session with no notice SHALL complete without changing the session. The existing consumer self-acknowledgment SHALL remain unchanged. Diagnostics SHALL retain caller attribution and existing request/trace continuity. No command SHALL automatically retry or replay.

#### Scenario: Atomic completion and passive consumers
- **WHEN** the operator clears the current notice
- **THEN** all configured acknowledgments and observed metadata completion commit together, and Nanoleaf and Pixoo records reflect the acknowledged session

#### Scenario: Save-time conflict or failed projection
- **WHEN** the record changes before save or a participating completion projection fails
- **THEN** the acknowledgment and completion do not commit; the shared refusal identifies the failed action

#### Scenario: Authorization and no-op boundaries
- **WHEN** a non-operator asks, the session is unknown, or a known session has no notice
- **THEN** the non-operator is `forbidden`, the unknown session is `not-found`, and a correctly guarded null selection changes no session state

#### Scenario: Restart and duplicate
- **WHEN** an acknowledged action's request is repeated or the runtime restarts
- **THEN** stored acknowledgments and completion remain, and the command is never resent

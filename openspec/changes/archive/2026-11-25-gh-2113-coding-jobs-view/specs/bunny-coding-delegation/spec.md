## ADDED Requirements

### Requirement: Inspect coding jobs and direct individual attempts

Jobs SHALL offer a bounded authenticated listing and exact job lookup across the owner's permitted Conversations. Each entry SHALL carry the stable job and attempt identity, owning companion and conversation, repository, and reported attempt evidence. Available attempt evidence SHALL include branch and worktree reference, native session, harness and model, usage, status and updates, pending decisions, checks, changed files and limitations. Unknown values SHALL remain unknown. Private host paths SHALL remain outside the shared projection. An explicit Message job or Stop job SHALL bind to the named current attempt. An unsupported, stale or disconnected target SHALL never silently send to a different attempt.

#### Scenario: Inspect a completed or disconnected job

- **WHEN** an authorized reader opens Jobs or reloads a job's original Conversation
- **THEN** the saved job and known outcome remain readable and the job links back to the original Conversation

#### Scenario: Distinguish instruction evidence

- **WHEN** a job instruction is recorded locally, accepted by a harness, or confirmed by harness activity
- **THEN** each fact is presented at its own level of evidence, and repeating a delivery identifier cannot apply the instruction twice

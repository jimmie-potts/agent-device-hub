## ADDED Requirements

### Requirement: Assistant tasks report through the shared session model

The companions module SHALL report each assistant task as one root session of the native source, with the task ID as its session ID, each explicit activation's run ID as its turn and each saved clarification or approval as one attention item named by its question ID. It SHALL add the observations for a task change to the outbox transaction that commits that change, and only for a change of the task's reported projection: its run, work, open question and result. A conversation opening, an enable or disable, a read, a spoken reply, startup reconciliation that leaves a task's state unchanged and outbox republication SHALL add no observation. The session's work, attention and outcome SHALL follow the task's committed status: a running task works; a task waiting on a clarification or approval needs the owner; a paused task makes no running-work claim; an uncertain task's work is unknown; a succeeded, failed or cancelled task holds one notice with that result, and no finished status SHALL claim success unless the result is `succeeded`. A delegation wait SHALL raise no attention. The module SHALL publish no conversation text, prompt or answer in an observation. Native worker reporting is out of scope.

#### Scenario: Answer and resume
- **WHEN** a synthetic task's run R asks a clarification Q, the owner answers it and run R2 starts
- **THEN** the session needs the owner with detail `input` on turn R, then Q alone is resolved on turn R and the session works on turn R2

#### Scenario: Outcomes
- **WHEN** synthetic tasks end succeeded, failed and cancelled, one is paused by a shutdown and one is left uncertain by an unanswered call
- **THEN** their statuses are `finished` with details `succeeded`, `failed` and `cancelled`, `quiet` with detail `interrupted`, and `unknown` with detail `lost`

#### Scenario: Restart without replay
- **WHEN** the runtime restarts with one task waiting on its question and one running
- **THEN** the waiting task reports nothing, the running task reports its recovered state once, and no run, speech, dispatch or model call starts

#### Scenario: Tasks saved before this release
- **WHEN** this release first starts with saved tasks
- **THEN** it records their current projections and reports nothing until a task next changes

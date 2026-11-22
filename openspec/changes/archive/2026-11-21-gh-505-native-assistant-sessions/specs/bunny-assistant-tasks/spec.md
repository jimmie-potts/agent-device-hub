## ADDED Requirements

### Requirement: Assistant conversations report through the shared session model

The companions module SHALL report each profile's conversation as one root session of the native source, with the conversation ID as its session ID and ordering epoch, each task in it, one owner message and everything it causes, as one turn named by the task ID, and each saved clarification or approval as one attention item named by its question ID. An answered question, a resume and the run either starts SHALL stay in the task's turn; only a new task SHALL start a turn, once, when it starts. Each task end SHALL report exactly one `turn-ended` with the task's result, and when one transaction ends a task and starts the next in the same conversation, the earlier turn's end SHALL precede the next turn's start. The conversation's observations SHALL carry one ordering sequence that increases across its tasks. The module SHALL add the observations for a task change to the outbox transaction that commits that change, and only for a change of the reported projection of the conversation's latest task: its turn, work, open question and result. A conversation opening, an enable or disable, a read, a spoken reply, startup reconciliation that leaves a task's state unchanged and outbox republication SHALL add no observation. The session's work, attention and outcome SHALL follow the latest task's committed status: a running task works; a task waiting on a clarification or approval needs the owner; a paused task makes no running-work claim; an uncertain task's work is unknown; a succeeded, failed or cancelled task holds one notice with that result, and no finished status SHALL claim success unless the result is `succeeded`. After a task ends, the session SHALL read as a hook session does after its turn ends, and the module SHALL never end the session. A cancelled task's notice SHALL leave no reader with an unread notice; a failed task's SHALL stay unread until acknowledged. A task waiting on delegated work SHALL raise no attention and make no running-work claim. Conversations of every profile SHALL report, titled by the profile's persona name. The assistant's `read_sessions` tool and coding suggestions SHALL leave native sessions out. The module SHALL publish no conversation text, prompt or answer in an observation. Native worker reporting is out of scope.

#### Scenario: One session across tasks
- **WHEN** a synthetic profile's conversation runs two tasks one after the other
- **THEN** every observation names the conversation's one session and ordering epoch, the first task's observations are on turn T1 and the second's on turn T2, each turn starts once and ends once, and the sequence increases across both

#### Scenario: Answer and resume
- **WHEN** a synthetic task T asks a clarification Q, the owner answers it and a new run starts, and later a paused task is resumed
- **THEN** the session needs the owner with detail `input` on turn T, then Q alone is resolved on turn T and the session works on turn T with no new turn start, and the resumed task works again on its own turn with no new turn start

#### Scenario: One task ends and the next starts in one commit
- **WHEN** the conversation last reported task A waiting on its approval, and one commit records A cancelled and the next task B started
- **THEN** A's `turn-ended` with result `cancelled` is reported before B's `turn-started`

#### Scenario: Outcomes
- **WHEN** synthetic tasks end succeeded, failed and cancelled, one is recovered as paused at a start and one is left uncertain by an unanswered call
- **THEN** their statuses are `finished` with details `succeeded`, `failed` and `cancelled`, `quiet` with detail `interrupted`, and `unknown` with detail `lost`
- **AND** the dashboard names each result, the succeeded and failed tasks show unread, and the cancelled task shows unread to no reader

#### Scenario: Delegation wait
- **WHEN** a synthetic task's approved delegation is handed to a fake coding worker and the task waits for its word
- **THEN** the session is `quiet` with detail `idle` and has no attention item, while the approval before it was attention

#### Scenario: The assistant's own reads
- **WHEN** a running task calls `read_sessions` while a Claude session and the task's own native session are synced
- **THEN** the result lists the Claude session only

#### Scenario: Restart without replay
- **WHEN** the runtime restarts while a task waits on its question, and again while a task's model call is unanswered
- **THEN** the waiting task reports nothing, the other reports itself uncertain once, and no run, speech, dispatch or model call starts

#### Scenario: Tasks saved before this release
- **WHEN** this release first starts with saved tasks, one conversation's latest task ended and another's waiting on the owner's answer
- **THEN** it records each conversation's latest projection and reports nothing for the ended task, and the same start reports the waiting task's turn start, question and wait, so it shows as needing the owner

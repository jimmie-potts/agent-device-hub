## MODIFIED Requirements

### Requirement: Assistant conversations report through the shared session model

The companions module SHALL report each profile's conversation as one root session of the native source, with the conversation ID as its session ID and ordering epoch, each task in it, one owner message and everything it causes, as one turn named by the task ID, and each saved clarification or approval as one attention item named by its question ID. An answered question, a resume and the run either starts SHALL stay in the task's turn; only a new task SHALL start a turn, once, when it starts. Each task end SHALL report exactly one `turn-ended` with the task's result, and when one transaction ends a task and starts the next in the same conversation, the earlier turn's end SHALL precede the next turn's start. The conversation's observations SHALL carry one ordering sequence that increases across its tasks. The module SHALL add the observations for a task change to the outbox transaction that commits that change, and only for a change of the reported projection of the conversation's latest task: its turn, work, open question and result. A conversation opening, an enable or disable, a read, a spoken reply, startup reconciliation that leaves a task's state unchanged and outbox republication SHALL add no observation. The session's work, attention and outcome SHALL follow the latest task's committed status: a running task works; a task waiting on a clarification or approval needs the owner; a paused task makes no running-work claim; an uncertain task's work is unknown; a succeeded, failed or cancelled task holds one notice with that result, and no finished status SHALL claim success unless the result is `succeeded`. After a task ends, the session SHALL read as a hook session does after its turn ends, and the module SHALL never end the session. A cancelled task's notice SHALL leave no reader with an unread notice; a failed task's SHALL stay unread until acknowledged. A task waiting on delegated work SHALL raise no attention and make no running-work claim. Conversations of every profile SHALL report, titled by the conversation's title, or by the profile's persona name until one exists. The assistant's `read_sessions` tool and coding suggestions SHALL leave native sessions out. The module SHALL publish no conversation text, prompt or answer in an observation. Native worker reporting is out of scope.

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

## ADDED Requirements

### Requirement: Model-written conversation titles

The companions module SHALL give each conversation a title of the form `#<issue> <description>`, or `<repository>#<issue> <description>` for an issue in another repository, or the description alone when no issue appears, written by one model call through the profile's title provider ([Hub #2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)). The call SHALL run after the admission of the first task of a session appearance, the first task with no lifecycle evidence reported for a day or ever, and after the admission of the third task of that appearance; no other task SHALL start one. The call SHALL send the fixed title instruction and the conversation's last eight owner and assistant messages, escaped and bounded at 2 KiB, and no tool result, preference or knowledge entry. The `bunny` profile with the Anthropic provider SHALL use the configured `titleModel`, default `claude-haiku-5-5`, with the same key and transport as its turns; every other profile and the synthetic provider SHALL write the fixed title `Synthetic conversation`. The module SHALL keep a title only after normalization: one line, no surrounding quotes, markdown heading or emphasis, `Title:` label or trailing punctuation, this repository's issues as a bare `#<issue>`, and a description of at most 40 characters cut at a word boundary. An empty or placeholder answer, an answer that only repeats an owner message, and a title that is not session display text SHALL be refused. The module SHALL store the title on the conversation with its source, generated or owner, and publish it as the session title: at once in a `lifecycle/2.3` metadata observation while the session may be shown, and on every later lifecycle observation; until a title exists the persona name SHALL stand. A failed, refused, invalid or abandoned call SHALL leave the earlier title or the persona name, SHALL NOT fail, delay or roll back a task, and SHALL NOT be retried. Each call SHALL be recorded on its conversation, admitted before it is sent and settled with its status, its outcome and its reported input, output and cache tokens, or unknown usage; a title call SHALL count toward no task's call, unit or time limits.

#### Scenario: First message
- **WHEN** the owner starts the first task of a conversation and a fake title provider answers `"#1896 Session tracking."`
- **THEN** the module publishes one `lifecycle/2.3` metadata observation with title `#1896 Session tracking` and source `provider`, every later observation carries that title, the task's model calls and reserved units are its own, and the recorded call holds the reported usage

#### Scenario: Refresh and reappearance
- **WHEN** a conversation runs four tasks within a day and a fifth after a day without evidence
- **THEN** title calls start at the first, third and fifth tasks only, and the reappearing session carries the earlier title until the new one lands

#### Scenario: Failures fall back
- **WHEN** title calls fail with `capacity`, are refused, answer `Title`, answer a credential-shaped text, or reach the deadline
- **THEN** no title is published, every observation keeps the persona name, every task succeeds, and each call is recorded once as failed, invalid or uncertain

#### Scenario: Synthetic title
- **WHEN** the synthetic provider titles a conversation
- **THEN** the title is `Synthetic conversation`, which contains no conversation text, and its recorded usage is zero

### Requirement: Owner rename of a conversation

The owner SHALL be able to rename a profile's conversation from **Conversation details** through the `rename` action of `assistant-control/2.1`, naming the profile and a title of 1 to 80 characters of session display text. The module SHALL refuse a rename whose title is not display text after its whitespace is collapsed with `invalid-request`. An accepted rename SHALL store the title with source owner, advance the conversation's title generation, publish it at once in a `lifecycle/2.3` metadata observation with source `user` while the session may be shown, and abandon any title call in flight. A settled title call whose generation is no longer the conversation's, or whose conversation has an owner title, SHALL be dropped, and no later task SHALL start a title call for a conversation with an owner title.

#### Scenario: Rename drops a title in flight
- **WHEN** a title call is in flight and the owner renames the conversation to `  Kitchen   plans `
- **THEN** the session title becomes `Kitchen plans` with source `user` at once, the call is abandoned and recorded uncertain, its late answer publishes nothing, and later tasks start no title call and carry the owner's title

#### Scenario: Compare before write
- **WHEN** a title answer settles after a rename advanced the generation without abandoning the call
- **THEN** the call is recorded as succeeded and dropped, and the owner's title stays

#### Scenario: Bad title
- **WHEN** the owner sends a title of whitespace only, a credential-shaped title or one of 81 characters
- **THEN** the rename is refused, nothing is published, and the earlier title stays

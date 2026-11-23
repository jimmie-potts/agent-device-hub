## MODIFIED Requirements

### Requirement: Bounded execution per conversation

The system SHALL admit at most one unfinished task and one graph invocation per conversation, with no execution queue. A task in one conversation SHALL NOT block a start, answer, resume or cancel in another, and the running slot SHALL be keyed by conversation, not by a fixed list of profiles; each conversation belongs to one profile today. A start in a conversation whose own task is unfinished SHALL be refused with the capacity code. A command for a conversation, a start, answer, approval, resume, cancel, Read aloud or rename, SHALL be refused as a revision conflict only when its own conversation changed after the assistant revision it names, or when it names a revision the assistant has not reached; enable and disable SHALL keep the assistant-wide revision. A rename, and a correction or removal of one of its messages, SHALL count as a change of its conversation, and each start SHALL count every saved conversation, a companion exchange without a profile included, as changed at the assistant's current revision. Every conversation's graph SHALL run on the module's one SDK-owned SQLite connection with no transaction across an await, its own checkpoint thread and its own cancellation fence. A turn is one task: one owner message and everything it causes. Each task SHALL retain limits of 50 model calls, 40 tool calls, 10 questions, 40 minutes active time and 1,000,000 usage units; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Before each model call the task SHALL reserve the request's UTF-8 bytes plus 8,192 framing units and 16,384 output units. Model/tool deadlines SHALL be six minutes and 30 seconds, and control admission five seconds. An owner message SHALL be bounded at 32 KiB, a tool result at 8 KiB, a model reply with its provider blocks at 16 KiB, the working transcript at 1 MiB, staged input at 193 KiB and each serialized checkpoint or set of pending writes at 256 KiB. A call that would pass a limit SHALL be refused before dispatch, and the task SHALL end with the capacity code and a conversation message that names the limit. Reservations SHALL precede dispatch and survive restart; resume SHALL never replenish a turn's budget; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

#### Scenario: A limit is exhausted
- **WHEN** another operation would exceed a persisted limit
- **THEN** it is refused before dispatch, including after resume or restart
- **AND** the task ends with the capacity code and the conversation's last message names the limit, such as "This turn reached its limit of 50 model calls."

#### Scenario: Largest owner message
- **WHEN** the owner stages a message of 32,768 control characters, each escaped to six JSON bytes
- **THEN** staging accepts it, and a message of 32,769 bytes is refused as an invalid request

#### Scenario: Cancellation and late result
- **WHEN** cancellation is durably saved while a call is pending
- **THEN** later steps remain fenced, abort is best effort, and a late result can update evidence but cannot reactivate the task

#### Scenario: Three conversations at once
- **WHEN** B.U.N.N.Y., Reachy and MicroDuck each start a task and their model replies arrive in mixed order
- **THEN** the three tasks run at the same time and each finishes in its own conversation with its own transcript, per-turn counts and checkpoint thread
- **AND** a second start in a conversation whose own task is unfinished is refused with the capacity code while the others keep running

#### Scenario: A step in another conversation
- **WHEN** the owner reads the page, another conversation's turn then takes a step, and the owner sends a start, answer, rename, Read aloud or cancel for a conversation that did not change, naming the revision read
- **THEN** each command is accepted, while a command for a conversation that changed after that revision, a revision not yet reached, or a disable naming it is refused as a revision conflict

#### Scenario: Two renames bound to one revision
- **WHEN** two renames of one conversation name the same revision
- **THEN** the first is accepted and the second is refused as a revision conflict, while a rename of another conversation naming that revision is accepted

#### Scenario: A correction changes its conversation
- **WHEN** the owner corrects or removes a message of a finished conversation, naming the revision the page read
- **THEN** a rename or other command for that conversation naming the same revision is refused as a revision conflict, while one for another conversation is accepted

#### Scenario: A command from before a restart
- **WHEN** the runtime restarts after the owner read the page and another conversation changed, and a command for a finished conversation names the revision the owner read
- **THEN** it is refused as a revision conflict, because that revision is older than the assistant's revision when it started, and the same command naming the current revision is accepted
- **AND** a command naming the revision at start is refused only when its conversation changed at startup, as a reconciled unfinished task does

#### Scenario: Cancel one conversation
- **WHEN** the owner cancels one conversation's task while all three have model calls in flight
- **THEN** only that task's call is aborted and fenced, its late answer is not saved, and the other two finish

#### Scenario: Spend reservations from several running turns
- **WHEN** several running turns reserve their next paid model calls and only some fit under the daily limit
- **THEN** each reservation is admitted atomically against the day's limit and the month's guard, together they never pass either, the turns that fit proceed, and a refused turn ends with the capacity code and its own message naming the limit, with nothing sent for it

#### Scenario: Anthropic spend limit in several turns
- **WHEN** Anthropic's monthly spend limit refuses the model calls of two running turns
- **THEN** each affected turn ends with the capacity code and its own closing reply, nothing retries, and a third conversation's turn keeps running

#### Scenario: Approvals from two conversations
- **WHEN** two conversations each wait on an approval bound to the same Hub-mode revision and the owner approves one and then the other
- **THEN** the commands reach the single writer in arrival order, each with its own guard, and the stale one is refused there and explained in its own conversation

#### Scenario: Crash and restart with three conversations
- **WHEN** the process exits abruptly while one conversation's model call is in flight, another waits on its question and a third has finished, and the runtime starts again
- **THEN** each conversation is recovered on its own and no call is sent, the lost call leaves its task uncertain and refuses a resume, and the waiting task can be answered and finished
- **AND** checkpoints, per-turn counts, spend reservations, cancellation fences, titles and session reports each stay with their own conversation

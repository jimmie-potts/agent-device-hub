## MODIFIED Requirements

### Requirement: Bounded execution per conversation

The system SHALL admit at most one unfinished task and one graph invocation per conversation, with no execution queue; a conversation's queued messages are the owner's saved messages, each started as a new task only as "Conversation message queue" specifies ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)). A task in one conversation SHALL NOT block a start, answer, resume or cancel in another, and the running slot SHALL be keyed by conversation, not by a fixed list of profiles; each conversation belongs to one profile today. A start in a conversation whose own task is unfinished SHALL be refused with the capacity code. A command for a conversation, a start, answer, approval, resume, cancel, Read aloud or rename, SHALL be refused as a revision conflict only when its own conversation changed after the assistant revision it names, or when it names a revision the assistant has not reached; enable and disable SHALL keep the assistant-wide revision, and a queue command SHALL be checked against its conversation's queue revision instead. A rename, and a correction or removal of one of its messages, SHALL count as a change of its conversation, and each start SHALL count every saved conversation, a companion exchange without a profile included, as changed at the assistant's current revision. Every conversation's graph SHALL run on the module's one SDK-owned SQLite connection with no transaction across an await, its own checkpoint thread and its own cancellation fence. A turn is one task: one owner message and everything it causes. Each task SHALL retain limits of 50 model calls, 40 tool calls, 10 questions, 40 minutes active time and 1,000,000 usage units; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Before each model call the task SHALL reserve the request's UTF-8 bytes plus 8,192 framing units and 16,384 output units. Model/tool deadlines SHALL be six minutes and 30 seconds, and control admission five seconds. An owner message SHALL be bounded at 32 KiB, a tool result at 8 KiB, a model reply with its provider blocks at 16 KiB, the working transcript at 1 MiB, staged input at 193 KiB and each serialized checkpoint or set of pending writes at 256 KiB. A call that would pass a limit SHALL be refused before dispatch, and the task SHALL end with the capacity code and a conversation message that names the limit. Reservations SHALL precede dispatch and survive restart; resume SHALL never replenish a turn's budget; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

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

### Requirement: New conversation

The owner SHALL be able to start a new conversation for a profile from the Conversation page ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)). The module SHALL take it as a staged `new-conversation` input naming the profile and the assistant revision read, checked against the profile's current conversation as any conversation command is, and admitted while conversation is off. It SHALL be refused with `invalid-state` while the profile's current conversation has an unfinished task: running, waiting on a clarification, an approval or the coding worker, paused or uncertain (owner decision 2026-11-24); a profile SHALL have at most one unfinished task. It SHALL also be refused with `invalid-state` while the current conversation's queue holds a message ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)), and the page disables the button with the note "Start or withdraw the queued messages first." It SHALL also be refused with `invalid-state` while the profile has no conversation or its current one holds no message, so repeated requests cannot add empty conversations; the page disables the button with the note "This conversation is empty. Send a message first." Otherwise the profile's current conversation SHALL become a new one with its own identity, so its own session on the devices, title, running slot and change revision, and both conversations SHALL count as changed. The new conversation's recent context SHALL start empty. Public assistant state SHALL list each profile's latest task in its current conversation only. The earlier conversation SHALL keep its messages, title and last session report, and SHALL stay readable by its identity in the recent view, without a current task; a read for a conversation that is not one of the profile's SHALL be not found. An authorized reader SHALL be able to list a profile's conversations, 16 a page with a keyset cursor, so a conversation that changes between page reads never repeats or skips an unchanged one: the current one first, then the others by their last message, newest first, and those without messages last, each with whether it is current, its message count, first and last message times and published title; Details SHALL offer the older pages. The page SHALL offer New conversation beside Details, disabled while the conversation's task is unfinished with the note "Finish or cancel this conversation's task first.", and SHALL list the profile's conversations in Details, where an earlier one opens read only with no composer and a way back to the current one. An archive export SHALL list each profile's current conversation after its earlier ones, with no change to the archive format, and an archive import SHALL accept a profile's earlier conversations, SHALL NOT move a current one, and SHALL make a profile without one take the archive's last conversation of that profile, so a round trip restores the current conversation.

#### Scenario: Refused while a task is unfinished
- **WHEN** the owner asks for New conversation while B.U.N.N.Y.'s task runs, waits on a question, and after a restart is uncertain
- **THEN** each request is refused with `invalid-state` and nothing changes, while Reachy's New conversation is accepted, and after the owner cancels the task the request is accepted

#### Scenario: A fresh conversation
- **WHEN** the owner starts a new conversation and sends a message
- **THEN** the message runs in the new conversation with an empty recent section, its session reports a turn start on the new conversation's identity with the companion and persona title, assistant state shows no task of the earlier conversation, a command naming the revision read before the change is refused as a revision conflict, and both conversations' change revisions are the change's revision

#### Scenario: Earlier conversations stay readable
- **WHEN** the owner opens the earlier conversation from Details
- **THEN** its messages are shown read only with no composer, the list shows the current and the earlier conversation, and Back to current conversation shows the new one

#### Scenario: The Duck widget across conversations
- **WHEN** the owner has selected a Reachy and MicroDuck exchange for the Duck widget and both companions start new conversations
- **THEN** the widget still reads the selected exchange, and the selection can still be cleared and set again

#### Scenario: Empty conversations
- **WHEN** the owner asks for New conversation for a profile without a conversation, and again on the new, empty conversation
- **THEN** both are refused with `invalid-state`, nothing changes, and the page disables the button with the empty-conversation note

#### Scenario: Older conversations in pages
- **WHEN** a profile has 18 conversations and an earlier one received the newest message after the current one was created
- **THEN** the first page lists 16, the current one first and that earlier one second, and the next page lists the remaining two
- **AND** when a second-page conversation gets a message before the next page is read, that page repeats no first-page conversation and still lists the other remaining one

#### Scenario: Archive round trip
- **WHEN** a store whose current conversation is C imports another store's earlier and current conversations, exports, and a fresh store imports that export
- **THEN** C stays current in the first store, is listed first there, and is current in the fresh store

#### Scenario: Archive with earlier conversations
- **WHEN** an archive holding a profile's earlier and current conversations is imported into an empty store and into its own store
- **THEN** both imports are accepted, the empty store's current conversation is the archive's latest, the earlier one is readable, and the source store's current conversation does not move

#### Scenario: Refused while messages are queued
- **WHEN** the owner asks for New conversation while the conversation's held queue holds a message and no task is unfinished
- **THEN** it is refused with `invalid-state` and nothing changes, and after the owner withdraws the queued messages it is accepted

## ADDED Requirements

### Requirement: Conversation message queue

The owner SHALL be able to queue messages for a conversation while its task works or waits ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030), owner decisions 1, 5 and 6 of [#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201)). The Conversation page SHALL offer **Queue** as its own control beside **Send**, and the composer SHALL stay available while the task works, waits on a clarification, an approval or the coding worker; while the task works Send SHALL wait for it and Enter SHALL queue, and during an approval or a hand-off only Queue SHALL show. The module SHALL take Queue as a staged `queue` input naming the profile, the text and the revision read; the input command SHALL complete once the message is saved in the conversation's queue, as domain state and never as a stored command (ADR 0012). A queued message's identity SHALL be the request ID of the command that queued it, so a repeated command queues nothing more, before or after the message starts. A queue SHALL hold at most 8 messages; one more SHALL be refused with `capacity` and a message naming the limit. Queued messages SHALL show above the composer in the order they start, and the owner SHALL be able to edit one, through a staged `edit-queued` input, and withdraw or reorder one, through the `withdraw` and `reorder` actions of `assistant-control/2.2`; editing, withdrawing and reordering run no work and SHALL be admitted while conversation is off. A message that is not in the profile's current conversation's queue SHALL be `not-found`. Every queue command SHALL be refused as a revision conflict only when the conversation's queue changed after the revision it names, or when it names a revision the assistant has not reached, so the running task's own steps never make it stale. New conversation SHALL count both conversations' queues as changed, and each start SHALL count every saved conversation's queue as changed at the start's revision and again wherever the start changed its conversation, so a Queue naming a revision read before either is refused exactly when a Send is. A transaction that rolls back SHALL record no queue change. The queue read SHALL name the assistant revision it was read at, and the page's withdraw, reorder and Resume queue SHALL name the revision of the queue it shows, so a move never acts on an order the page no longer shows; an open edit SHALL name the revision of the latest read in which its message still had the text the edit opened with, so another message queued, moved or started never refuses it and it never overwrites a change made to its message since; a refused edit SHALL keep its text and allow Save again, and an edit whose message is changed elsewhere, starts or is withdrawn first SHALL close and offer its text back to the owner. Messages that a release before this one left in a conversation New conversation replaced SHALL never start, SHALL stay out of public state, SHALL be held at each start, and SHALL show on that conversation's read-only view, where the owner can only withdraw them. When a task ends succeeded or failed and its conversation's queue is not held, the first queued message SHALL start as a new task and turn of the same conversation, and its removal from the queue, the new task with its prompt message and its run's activation SHALL commit in the transaction that ended the earlier task, so its start is reported after the earlier turn's end and a crash never leaves it both started and queued; it SHALL start at most once. Its recent context SHALL hold the finished task. A queued start SHALL run no title check of its own. A message SHALL stay queued while the task waits on an answer, an approval or the coding worker, or is paused or uncertain. With no unfinished task and a free queue, a queued message SHALL start at once. Cancel task, the Stop of the owner's decisions, SHALL end the task and hold the queue while it holds messages, until **Resume queue**. A start of the module SHALL start no work and SHALL hold every queue that still holds messages until **Start**, publishing that change at a new revision. A queued message that cannot start, because conversation is off or unavailable, the conversation is unrecovered or a paid profile's spend limits leave too little for its first call, SHALL be refused at its start with that code, such as `capacity` with the limit's message, SHALL stay queued and SHALL hold the queue, with no retry. Resume queue and Start, the `resume-queue` action, SHALL release a held queue and start its next message when the conversation has no unfinished task; a start the module still refuses SHALL refuse the command and leave the queue held; with nothing held it SHALL be refused with `invalid-state`. Withdrawing the last message SHALL release a hold. Send SHALL still start a task beside a held queue, which stays held. Public `assistant-state/2.2` SHALL list each profile's current conversation whose queue holds messages, with the count, the hold (`stop`, `restart`, `refused` or none) and a refusal's code, and no text; an authorized reader SHALL read the queue's messages and hold through the private conversation route's `view=queue`.

#### Scenario: Queue while a task works
- **WHEN** the owner queues two messages while a task's model call is in flight
- **THEN** both are saved in order without touching the running task, the composer stays available, and when the task ends the first starts as a new task whose transcript is its own message and whose context holds the finished task, then the second after it

#### Scenario: Edit, withdraw and reorder
- **WHEN** the owner edits, moves and withdraws queued messages while the task takes steps
- **THEN** each change is saved, a command naming a revision from before a queue change is refused as a revision conflict, and a conversation command naming a revision from before the task's step is refused while a queue command naming it is accepted

#### Scenario: Waits through a question and an approval
- **WHEN** a message is queued while the task waits on a clarification and later on an approval
- **THEN** it stays queued, the answered and approved task continues first, and the message starts only when that task ends

#### Scenario: Stop and Resume queue
- **WHEN** the owner cancels a working task while a message is queued
- **THEN** nothing starts, the queue is held with `stop`, a direct Send still runs, and Resume queue starts the first queued message

#### Scenario: Restart and Start
- **WHEN** the runtime restarts while a task waits on a question and a message is queued
- **THEN** no work starts, the queue is held with `restart`, a queue command naming the revision read before the restart is refused, the answered task finishes without starting the queued message, and Start starts it once

#### Scenario: Crash after the start
- **WHEN** the process exits right after the commit that ended a task and started a queued message, and the runtime starts again and the owner resumes that task
- **THEN** the store held one task for the message and nothing queued, the start sent nothing, and the resumed task ran its message once

#### Scenario: Spend limits at the start
- **WHEN** a paid profile's finished task leaves too little of the day's limit for another model call and a message is queued
- **THEN** its start is refused with `capacity` and the limit's message, nothing is sent, the message stays queued, the queue is held with `refused`, and Resume queue is refused with `capacity` while the limit stands

#### Scenario: Turn reports
- **WHEN** a task ends and the next queued message starts in one commit
- **THEN** the conversation's session reports the earlier turn's end and then the next turn's start, at consecutive ordering sequences

#### Scenario: Titles
- **WHEN** a queued message starts after a task in an untitled conversation
- **THEN** the title model checks the title for the finished task only, while a message the owner sends directly is checked

#### Scenario: Queue after New conversation or a restart
- **WHEN** a page that read the revision before another page's New conversation, or before a restart that reconciled the conversation or left it without a queue, sends Queue naming it
- **THEN** it is refused as a revision conflict and nothing starts, as a Send naming it is, and the same Queue naming the current revision is accepted

#### Scenario: An edit left open
- **WHEN** the owner queues another message while an edit is open and then saves it, and later another page edits a queued message after this page opened its edit
- **THEN** the first save is accepted, while the second edit is never written over the other page's change: it closes and offers its text back, and a refused Resume queue leaves a later queue command naming the revision after it accepted

#### Scenario: Messages left behind by an earlier release
- **WHEN** a store holds queued messages in a conversation that an earlier release's New conversation replaced
- **THEN** they never start and are not in public state, the earlier conversation's queue read shows them held with `restart`, edit and reorder are `not-found`, and the profile's Withdraw removes them

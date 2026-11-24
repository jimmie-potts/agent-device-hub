## MODIFIED Requirements

### Requirement: Conversation message queue

The owner SHALL be able to queue messages for a conversation while its task works or waits ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030), owner decisions 1, 5 and 6 of [#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201)). The Conversation page SHALL offer **Queue** as its own control beside **Send**, and the composer SHALL stay available while the task works, waits on a clarification, an approval or the coding worker; while the task works or waits on the coding worker Send and Enter SHALL steer it as "Steering a running task" specifies, during a clarification Enter SHALL answer it, and during an approval only Queue and Decline with message SHALL show ([Hub #2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031)). The module SHALL take Queue as a staged `queue` input naming the profile, the text and the revision read; the input command SHALL complete once the message is saved in the conversation's queue, as domain state and never as a stored command (ADR 0012). A queued message's identity SHALL be the request ID of the command that queued it, so a repeated command queues nothing more, before or after the message starts. Queue SHALL be refused with `capacity` and a message naming the limit while the queue holds 8 messages or more. Steers that a closed or stopped turn returns to the queue, and a steer that reaches its turn after the turn ended, SHALL be saved even past 8, up to 16, so nothing the owner wrote is dropped (owner decision of 2026-11-24 on [#2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031#issuecomment-7142267166)); a new Queue SHALL stay refused until the queue holds fewer than 8. Queued messages SHALL show above the composer in the order they start, and the owner SHALL be able to edit one, through a staged `edit-queued` input, and withdraw or reorder one, through the `withdraw` and `reorder` actions of `assistant-control/2.2`; editing, withdrawing and reordering run no work and SHALL be admitted while conversation is off. A message that is not in the profile's current conversation's queue SHALL be `not-found`. Every queue command SHALL be refused as a revision conflict only when the conversation's queue changed after the revision it names, or when it names a revision the assistant has not reached, so the running task's own steps never make it stale. New conversation SHALL count both conversations' queues as changed, and each start SHALL count every saved conversation's queue as changed at the start's revision and again wherever the start changed its conversation, so a Queue naming a revision read before either is refused exactly when a Send is. A transaction that rolls back SHALL record no queue change. The queue read SHALL name the assistant revision it was read at, and the page's withdraw, reorder and Resume queue SHALL name the revision of the queue it shows, so a move never acts on an order the page no longer shows; an open edit SHALL name the revision of the latest read in which its message still had the text the edit opened with, so another message queued, moved or started never refuses it and it never overwrites a change made to its message since; a refused edit SHALL keep its text and allow Save again, and an edit whose message is changed elsewhere, starts or is withdrawn first SHALL close and offer its text back to the owner. Messages that a release before this one left in a conversation New conversation replaced SHALL never start, SHALL stay out of public state, SHALL be held at each start, and SHALL show on that conversation's read-only view, where the owner can only withdraw them. When a task ends succeeded or failed and its conversation's queue is not held, the first queued message SHALL start as a new task and turn of the same conversation, and its removal from the queue, the new task with its prompt message and its run's activation SHALL commit in the transaction that ended the earlier task, so its start is reported after the earlier turn's end and a crash never leaves it both started and queued; it SHALL start at most once. Its recent context SHALL hold the finished task. A queued start SHALL run no title check of its own. A message SHALL stay queued while the task waits on an answer, an approval or the coding worker, or is paused or uncertain. With no unfinished task and a free queue, a queued message SHALL start at once. Cancel task, the Stop of the owner's decisions, SHALL end the task and hold the queue while it holds messages, until **Resume queue**. A start of the module SHALL start no work and SHALL hold every queue that still holds messages until **Start**, publishing that change at a new revision. A queued message that cannot start, because conversation is off or unavailable, the conversation is unrecovered or a paid profile's spend limits leave too little for its first call, SHALL be refused at its start with that code, such as `capacity` with the limit's message, SHALL stay queued and SHALL hold the queue, with no retry. Resume queue and Start, the `resume-queue` action, SHALL release a held queue and start its next message when the conversation has no unfinished task; a start the module still refuses SHALL refuse the command and leave the queue held; with nothing held it SHALL be refused with `invalid-state`. Withdrawing the last message SHALL release a hold. Send SHALL still start a task beside a held queue, which stays held. Public `assistant-state/2.2` SHALL list each profile's current conversation whose queue holds messages, with the count, the hold (`stop`, `restart`, `refused` or none) and a refusal's code, and no text, and the module SHALL publish `assistant-state/2.3`, which allows a count up to 16, only while a queue holds more than 8; an authorized reader SHALL read the queue's messages and hold, and the running task's unread steers, through the private conversation route's `view=queue`.

#### Scenario: Queue while a task works
- **WHEN** the owner queues two messages while a task's model call is in flight
- **THEN** both are saved in order without touching the running task, the composer stays available, and when the task ends the first starts as a new task whose transcript is its own message and whose context holds the finished task, then the second after it

#### Scenario: Edit, withdraw and reorder
- **WHEN** the owner edits, moves and withdraws queued messages while the task takes steps
- **THEN** each change is saved, a command naming a revision from before a queue change is refused as a revision conflict, and a conversation command naming a revision from before the task's step is refused while a queue command naming it is accepted

#### Scenario: Returned steers past the limit
- **WHEN** the owner stops a task that holds two unread steers while 8 messages are queued
- **THEN** the queue holds 10 with the steers first and is held with `stop`, the state is published as `assistant-state/2.3`, and Queue is refused with `capacity` until fewer than 8 messages wait

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

## ADDED Requirements

### Requirement: Steering a running task

The owner SHALL be able to steer a conversation's unfinished task with a new message ([Hub #2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031), owner decisions 1, 3, 4 and 5 of [#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201)). On the Conversation page **Send**, and Enter, SHALL steer a task that works or waits on the coding worker. The module SHALL take a steer as a staged `steer` input naming the profile, the text, the revision read and the `taskId` of the turn the page expects, and with `questionId` the question it sets aside. A steer SHALL be saved at once in the module's queue store, keyed by the request ID of its input command, without bumping the task's generation, so the running call goes on; a repeated command SHALL save nothing more. The task's unread steers SHALL show above the composer and in the private queue read. Each SHALL be taken into the task's own transcript, oldest first, in the admission transaction of the task's next model call, after any tool results of the last call, so the Messages API reads the `tool_result` blocks first and the steer's text after them, and SHALL be saved in the conversation there, in the task's turn; a call the turn's limits refuse SHALL leave them unread, and a replayed model node whose call was admitted SHALL take none again. The recent conversation section SHALL stay as fixed when the task started. A steer that is unread when a model call's answer is saved SHALL make a final answer superseded: that answer SHALL be saved and never spoken, and the task SHALL make one more model call, admitted, reserved and counted as any other, to read it; only the turn's final reply SHALL be spoken. A steer the task never read SHALL go back to the head of its conversation's queue, in order and before the messages already queued, in the commit that closes the turn, succeeded or failed, so one that arrived after the last model call starts as the next queued message, and in the commit of Cancel task, which then holds the queue; none SHALL be dropped. A steer that reaches its turn after the turn ended, while that turn is still the conversation's latest, SHALL become the next queued message the same way, even past 8 up to the queue's bound of 16 as a returned steer may, and start at once unless the queue is held; after Cancel task it SHALL hold the queue, as the steers Cancel task returned do. A steer aimed at a turn a newer turn followed, at another conversation's or an unknown turn, or setting aside a question of an ended turn, SHALL be refused with `invalid-state` and never retried (ADR 0012); a steer naming a revision the assistant has not reached SHALL be refused as a revision conflict, while the running task's own steps never make a steer stale. A paused or uncertain task SHALL refuse a steer with `invalid-state`. During an approval a steer SHALL be queued, and **Decline with message** SHALL decline the approval and steer the task in one commit; during a clarification the composer SHALL answer it, and **Skip question and send** SHALL answer the clarification with a fixed tool result saying the owner skipped it and steer the task in one commit; a delegation SHALL refuse either with `invalid-state`. A steer during a delegation wait, a hand-off that waits for its companion's busy slot included, SHALL be kept until the worker's result arrives and read after it. When fewer than two model calls remain in the turn's limits, by its count of model calls, its active time at a model call's deadline or its usage units at the least a call reserves, a steer SHALL be queued instead. A task SHALL hold at most 8 unread steers, and its steers and its conversation's queue together at most 16; a steer past either SHALL be refused with `capacity` and a fixed message. A steer SHALL run no title check of its own, while a declined approval stays the title's major event, and SHALL report no turn of its own to the shared session model. A restart SHALL start no work: a waiting or paused task keeps its unread steers, and steers a start's reconciliation returns, and unread steers a start finds on a task that already finished, SHALL go back to the head of their queue and wait there, held with `restart`. The graph version SHALL be `conversation-2`, whose model node has an edge back to itself; each start SHALL upgrade an unfinished task saved under `conversation-1`, whose nodes, state and checkpoints are the same, before reconciling it, while a task of any other version stays recovered unavailable. An unread steer's text SHALL reach only its own task's model calls and SHALL be stored only in the queue store; once the task reads it, it SHALL be a saved owner message of the conversation like any other, and a superseded reply a saved assistant message, which later turns' recent context and the conversation's title checks read. Steer text SHALL never appear in logs, published state or session reports.

#### Scenario: A steer during tool use
- **WHEN** the owner steers a task while its model call that asks for a read is in flight
- **THEN** the steer is saved at once without cutting off the call, shows above the composer, and the next call's transcript holds the tool result and then the steer in one user turn of the same task, with no new session turn and no title check

#### Scenario: A steer forces one more call
- **WHEN** a steer reaches the task while its model call is in flight and the call answers with a final reply
- **THEN** that reply is saved and not spoken, one more model call is admitted and counted with the steer in its transcript, and only its reply is spoken

#### Scenario: A late steer becomes the next queued message
- **WHEN** a steer reaches the task after its last model call's answer was saved, before the turn closes, or after the turn ended while it is still the conversation's latest
- **THEN** no model call reads it in that turn, and it starts as the next message's own task, before the messages already queued, unless the queue is held

#### Scenario: Skip question and send
- **WHEN** the owner uses Skip question and send on a pending clarification
- **THEN** the task resumes in the same commit and its next call reads the skipped answer and then the steer, and no answer of the owner is saved for the question

#### Scenario: Decline with message
- **WHEN** the owner sends free text during an approval, then uses Decline with message
- **THEN** the free text is queued, the approval is declined with nothing dispatched, and the next call reads the declined result and then the steer

#### Scenario: Delegation wait
- **WHEN** the owner steers a task whose hand-off runs, and another whose hand-off waits for its companion's busy slot
- **THEN** neither makes a model call until its worker's result arrives, and each next call reads the result and then the steer

#### Scenario: Few calls left
- **WHEN** the owner steers a task with one model call or less than two model deadlines of active time left
- **THEN** the steer is queued, while with two calls left it waits for the next call

#### Scenario: Stop returns steers
- **WHEN** the owner cancels a task that holds unread steers, or a forced call is refused by the turn's limits
- **THEN** the steers go back to the head of the queue, held after Stop and started next after the failed turn

#### Scenario: Stale turn
- **WHEN** a steer names a turn a newer turn followed, another conversation's turn, an unknown turn, or an uncertain task
- **THEN** it is refused with `invalid-state` and nothing retries, while one naming a revision from before the task's own steps is accepted

#### Scenario: Restart and graph upgrade
- **WHEN** the runtime restarts while a task with an unread steer waits on a question, or while a task saved under `conversation-1` waits
- **THEN** no work starts, the steer is read after the owner's answer, and the earlier task is upgraded to `conversation-2` and continues, while a `synthetic-1` task is recovered unavailable

#### Scenario: A process exit during the call that read a steer
- **WHEN** the process exits during the model call whose admission took a steer into the transcript, and the owner cancels the uncertain task after the restart
- **THEN** the steer is in the transcript and the conversation once, no steer is unread, and nothing is returned to the queue

## ADDED Requirements

### Requirement: Background coding jobs in Conversation

An approved coding delegation SHALL return a stable job ID and let its Conversation turn finish without waiting for dispatch, worker admission or a result. The approved job SHALL remain independent of subsequent turns and chat selection. The result SHALL reach the original conversation and exchange by the saved attempt identity. Conversation SHALL offer an authenticated stop control on a queued or running job reference. It SHALL name the exact job and attempt, including when opened in an earlier chat.

#### Scenario: Worker still running

- **WHEN** an approved job has a delayed worker result
- **THEN** Conversation can answer a Hub question and accept a second delegation before the result arrives

#### Scenario: Results in a different order

- **WHEN** two jobs finish in reverse order after the owner starts another chat
- **THEN** each result appears once on its originating exchange

## MODIFIED Requirements

### Requirement: Owner approval of proposed commands

Every state-changing command SHALL go through the existing question interrupt as an approval proposal bound to the exact family, target, value and the revision it was proposed against: the synced Hub-mode revision for `mode-set`, the coding worker's endpoint revision for a delegation, which moves only when a worker endpoint is selected, disabled or lost and never when a run starts or ends, and the configuration revision and generation for each LIFX write. A delegation SHALL be proposed while a coding worker is connected, even when the asking companion's slot is busy. The owner SHALL answer an approval only with the literal decisions approve or decline. An approved command SHALL be dispatched once through the core's tracked dispatcher; a dispatch whose bound revision has moved SHALL be refused and reported to the model as refused; a decline SHALL send nothing and say so. An approved coding delegation SHALL record a background job and return its stable Hub job ID. Only a delegation checkpoint saved by an earlier version MAY resume through the worker-result interrupt.

#### Scenario: Approved mode change
- **WHEN** the owner approves a proposed `set_mode` and the Hub mode has not changed since the proposal
- **THEN** one tracked `mode-set` operation is sent with the recorded expected revision, the saved mode changes, and the task's final text reports the accepted result without claiming device effects

#### Scenario: Declined or stale proposal
- **WHEN** the owner declines, or approves after the Hub mode changed or the coding worker's endpoint changed
- **THEN** no command is sent for a decline; a stale approval is refused with `revision-conflict` and the conversation reports it; neither path starts a duplicate command

#### Scenario: Another companion's run
- **WHEN** a delegation is proposed in one conversation and another companion's hand-off starts or ends before the owner approves it
- **THEN** the approval is not refused and the hand-off is sent or waits by its own companion's slot

#### Scenario: Approval after restart
- **WHEN** the runtime restarts while an approval question is waiting
- **THEN** the same question, proposal and recorded revision remain readable, and the explicit answer applies once to that proposal only

#### Scenario: Delegation answered by the worker
- **WHEN** an approved delegation is accepted and the worker later reports its result
- **THEN** the task resumes with that result as the tool's result, the next turn reports it, and an owner answer sent meanwhile is refused as invalid state

#### Scenario: Delegation that waits for a busy slot
- **WHEN** the owner approves a delegation while the companion's slot is busy
- **THEN** the tool result says the coding worker is busy and the hand-off waits for that slot, the conversation says it waits to delegate and then that it delegated once the hand-off is sent, the title check for an accepted hand-off runs once, and no reply says no coding worker is connected

### Requirement: Conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability with how many of its slots are busy and how many hand-offs wait, the conversation companion's own slot, the shared plan usage windows the worker's readiness reported with their use, reset and when they were observed, or why there are none, reported usage in hosted tokens or synthetic units, and unknown when usage is unreported, today's shared spend against the daily limit and this month's local estimate, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Read aloud control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision and, while the companion's slot is busy, that an approved hand-off waits for it; an approved background job SHALL show a saved job reference and updates in the original exchange. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

#### Scenario: Approval by keyboard
- **WHEN** a task waits for approval and the owner reloads the page and operates it by keyboard
- **THEN** the proposal, its target and value are readable, approve and decline are labelled, and a successful answer receipt does not assert that the command completed

#### Scenario: Read-only and disconnected states
- **WHEN** the browser lacks control authority or loses its connection
- **THEN** saved history stays readable, every mutating control is disabled, and the page says why

#### Scenario: Spoken replies by keyboard
- **WHEN** the owner enables spoken replies in the Conversation tab by keyboard, sends a request and activates Read aloud on the saved answer
- **THEN** the question, result and replay are spoken through that tab and the Read aloud receipt is shown apart from the playback report

#### Scenario: Delegation on the page
- **WHEN** the model proposes a delegation and the owner approves it by keyboard
- **THEN** the proposal shows the repository, brief and bound revision, the page shows the job reference while the worker runs and links its result to that reference

#### Scenario: Busy slot on the page
- **WHEN** a companion's slot is busy and its conversation proposes a delegation that the owner approves
- **THEN** the proposal says the hand-off will wait, Conversation shows a background job reference, and details show the busy slots and waiting hand-off until it is sent

#### Scenario: Plan usage
- **WHEN** the selected worker's readiness carries limit windows from its latest run
- **THEN** the details list each window with its use, status and reset and when they were observed, and say "Not reported yet" before any run reported one

#### Scenario: Open, refresh and page through recent history
- **WHEN** a dashboard consumer opens a profile with the recent reader, refreshes it as new messages arrive, or explicitly loads an earlier page
- **THEN** it opens at the newest window, displays loaded messages in chronological order without duplication or dropping previously loaded rows, and preserves the latest saved clarification, approval or delegation separately from pagination
- **AND** a successful refresh does not fetch earlier pages automatically, and an explicit gap separates disjoint windows until the reader joins them
- **AND** an obsolete or wrong-profile response cannot replace the selected profile's history, and a failed read may retain prior visible history while explicit retry repeats only the read

#### Scenario: Read at a stable scroll position
- **WHEN** the owner loads earlier saved messages or new saved messages arrive while they are reading above the latest exchange
- **THEN** the viewed saved row stays in position and new arrivals offer a New messages action
- **AND** a live state revision preserves a Load earlier request already in flight for that profile

#### Scenario: Draft and task decisions in the composer
- **WHEN** the owner changes profiles, opens Details, resizes the page or reconnects in the same mounted page
- **THEN** the profile and question drafts remain in page memory, including text retained after submission
- **AND** the composer blocks a start only while the open conversation's own task is unfinished, never for another conversation's task, and allows browsing saved history
- **AND** Enter submits eligible text outside IME composition, and Shift+Enter inserts a newline
- **AND** full approval scope and active questions and waits remain visible outside collapsed routine facts

#### Scenario: Compact composer and UTF-8 guidance
- **WHEN** the owner composes a message or answers a saved clarification
- **THEN** one input surface gives the text a Message or Answer identity and places the input action beside Voice
- **AND** keyboard guidance and a short private-saving and model disclosure stay visible, while Conversation settings explains submitted and unsent text
- **AND** the exact UTF-8 byte count appears at 80% of the 32,768-byte limit or above, and an over-limit draft shows a refusal and cannot submit

#### Scenario: Retain a draft after a refused or lost reply
- **WHEN** a submission is refused or its reply is lost
- **THEN** the draft and tracked receipt remain visible and the page sends no retry

#### Scenario: Guard an unavailable task decision
- **WHEN** the assistant copy is removed or the current saved question is missing or refers to another question
- **THEN** loaded messages remain readable and answer and approval actions remain unavailable
- **AND** Refresh history makes one deliberate latest read when the current saved question or proposal is unavailable

#### Scenario: Inspect labelled Details
- **WHEN** a reader opens Details from the Conversation header
- **THEN** Conversation details shows the selected profile and an explicit close action, with an independently scrolling panel beside the conversation at wide widths and an overlay at narrow widths
- **AND** Capabilities, Task activity, Usage and Conversation settings start collapsed and expand independently, with the full saved values readable inside the panel
- **AND** Close, Escape and tapping outside the narrow overlay return focus to Details, keep the draft and transcript position, and send no commands
- **AND** closing Details gives the wide conversation its space back, and resizing preserves the open sections and viewed saved row
- **AND** opening Details or Voice dismisses the other panel while keeping the original speech endpoint, and Stop speaking remains available during local playback with narrow Details open
- **AND** provider and tool facts, worker availability, task identifiers and bounds, saved question and answer, diagnostic codes, successful control receipts and usage retain their meaning
- **AND** retained assistant facts read as Last known, a missing worker copy reads as unknown, usage distinguishes unknown, zero, synthetic units and hosted tokens without estimating a task's billed cost, and spend today and this month's estimate read as dollars of their limit and guard, naming reservations still counted for calls without reported usage, or as unknown when the spend cannot be read
- **AND** active decisions, task result cues, blockers, and unresolved or negative control outcomes remain visible by the relevant controls

#### Scenario: Use existing conversation settings
- **WHEN** the owner opens Conversation settings
- **THEN** the section explains saved input and offers the current enable or disable action through the same guarded command
- **AND** a reader or stale copy cannot mutate, and while any conversation has an unfinished task, Disable is unavailable, the command is refused with the invalid-state code, and the section names each such conversation with a link to it; Enable is unchanged

#### Scenario: Read saved conversation messages

- **WHEN** the reader opens a saved exchange at desktop or narrow widths
- **THEN** assistant replies use open text and owner messages use modest bubbles in a reading column aligned with the composer
- **AND** paragraphs, long URLs and markup remain literal, wrap to fit and retain the complete saved text
- **AND** each eligible assistant reply has a quiet labelled Read aloud action, and tool messages have a labelled Tool result disclosure

#### Scenario: Start with empty history

- **WHEN** the selected profile has a fresh, successful empty history read and can accept a new message
- **THEN** the transcript offers a short invitation to send a message
- **AND** while a read or a new message is unavailable, the page shows the applicable history state or blocker instead of the invitation

#### Scenario: See ordinary completion and required decisions

- **WHEN** a live task succeeds
- **THEN** a compact completion cue appears by the composer, with task facts in Details
- **AND** unresolved or unsuccessful outcomes, stale state, waits and decisions remain visible when they affect the next action

#### Scenario: Expand saved tool text
- **WHEN** the owner or reader opens a tool result on a saved transcript row
- **THEN** the full inert text can be read without horizontal page overflow, and the row retains its original task association and message order
- **AND** opening or closing the result does not fetch, send a command, or replay text or audio
- **AND** loading earlier saved messages keeps the result open and preserves the current reading position within it

#### Scenario: Compact spoken reply controls
- **WHEN** the owner opens Voice on the Conversation page
- **THEN** the titled Spoken replies panel explains browser output, shows the current blocker or Quiet suppression beside the existing Enable, Mute and eligible recovery actions, and keeps detailed requirements and playback evidence available in a disclosure
- **AND** explicit close and Escape return keyboard focus to Voice, and clicking outside dismisses the panel without taking focus from the clicked control
- **AND** opening or dismissing the panel preserves the draft and current speech endpoint without sending a command
- **AND** an unresolved playback reservation disables Enable until it is cleared, and historical uncertainty remains in the playback disclosure without overriding a later successful Enable
- **AND** Stop speaking remains available outside the panel during local playback and leaves the task and question unchanged
- **AND** Read aloud uses the tracked command for the same saved assistant message within the speech limit, presents the command receipt separately from playback, and explains why a longer message stays written only

### Requirement: New conversation

The owner SHALL be able to start a new conversation for a profile from the Conversation page ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)). The module SHALL take it as a staged `new-conversation` input naming the profile and the assistant revision read, checked against the profile's current conversation as any conversation command is, and admitted while conversation is off. It SHALL be refused with `invalid-state` while the profile's current conversation has an unfinished task: running, waiting on a clarification, an approval, paused or uncertain, including an earlier saved worker-result interrupt (owner decision 2026-11-24); a profile SHALL have at most one unfinished task. It SHALL also be refused with `invalid-state` while the current conversation's queue holds a message ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)), and the page disables the button with the note "Start or withdraw the queued messages first." It SHALL also be refused with `invalid-state` while the profile has no conversation or its current one holds no message, so repeated requests cannot add empty conversations; the page disables the button with the note "This conversation is empty. Send a message first." Otherwise the profile's current conversation SHALL become a new one with its own identity, so its own session on the devices, title, running slot and change revision, and both conversations SHALL count as changed. The new conversation's recent context SHALL start empty. Public assistant state SHALL list each profile's latest task in its current conversation only. The earlier conversation SHALL keep its messages, title and last session report, and SHALL stay readable by its identity in the recent view, without a current task; a read for a conversation that is not one of the profile's SHALL be not found. An authorized reader SHALL be able to list a profile's conversations, 16 a page with a keyset cursor, so a conversation that changes between page reads never repeats or skips an unchanged one: the current one first, then the others by their last message, newest first, and those without messages last, each with whether it is current, its message count, first and last message times and published title; Details SHALL offer the older pages. The page SHALL offer New conversation beside Details, disabled while the conversation's task is unfinished with the note "Finish or cancel this conversation's task first.", and SHALL list the profile's conversations in Details, where an earlier one opens read only with no composer and a way back to the current one. An archive export SHALL list each profile's current conversation after its earlier ones, with no change to the archive format, and an archive import SHALL accept a profile's earlier conversations, SHALL NOT move a current one, and SHALL make a profile without one take the archive's last conversation of that profile, so a round trip restores the current conversation.

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

### Requirement: Conversation message queue

The owner SHALL be able to queue messages for a conversation while its task works or waits ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030), owner decisions 1, 5 and 6 of [#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201)). The Conversation page SHALL offer **Queue** as its own control beside **Send**, and the composer SHALL stay available while the task works, waits on a clarification, an approval or the coding worker; while the task works or has an earlier saved worker-result interrupt Send and Enter SHALL steer it as "Steering a running task" specifies, during a clarification Enter SHALL answer it, and during an approval only Queue and Decline with message SHALL show ([Hub #2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031)). The module SHALL take Queue as a staged `queue` input naming the profile, the text and the revision read; the input command SHALL complete once the message is saved in the conversation's queue, as domain state and never as a stored command (ADR 0012). A queued message's identity SHALL be the request ID of the command that queued it, so a repeated command queues nothing more, before or after the message starts. Queue SHALL be refused with `capacity` and a message naming the limit while the queue holds 8 messages or more. Steers that a closed or stopped turn returns to the queue, and a steer that reaches its turn after the turn ended, SHALL be saved even past 8, up to 16, so nothing the owner wrote is dropped (owner decision of 2026-11-24 on [#2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031#issuecomment-7142267166)); a new Queue SHALL stay refused until the queue holds fewer than 8. Queued messages SHALL show above the composer in the order they start, and the owner SHALL be able to edit one, through a staged `edit-queued` input, and withdraw or reorder one, through the `withdraw` and `reorder` actions of `assistant-control/2.2`; editing, withdrawing and reordering run no work and SHALL be admitted while conversation is off. A message that is not in the profile's current conversation's queue SHALL be `not-found`. Every queue command SHALL be refused as a revision conflict only when the conversation's queue changed after the revision it names, or when it names a revision the assistant has not reached, so the running task's own steps never make it stale. New conversation SHALL count both conversations' queues as changed, and each start SHALL count every saved conversation's queue as changed at the start's revision and again wherever the start changed its conversation, so a Queue naming a revision read before either is refused exactly when a Send is. A transaction that rolls back SHALL record no queue change. The queue read SHALL name the assistant revision it was read at, and the page's withdraw, reorder and Resume queue SHALL name the revision of the queue it shows, so a move never acts on an order the page no longer shows; an open edit SHALL name the revision of the latest read in which its message still had the text the edit opened with, so another message queued, moved or started never refuses it and it never overwrites a change made to its message since; a refused edit SHALL keep its text and allow Save again, and an edit whose message is changed elsewhere, starts or is withdrawn first SHALL close and offer its text back to the owner. Messages that a release before this one left in a conversation New conversation replaced SHALL never start, SHALL stay out of public state, SHALL be held at each start, and SHALL show on that conversation's read-only view, where the owner can only withdraw them. When a task ends succeeded or failed and its conversation's queue is not held, the first queued message SHALL start as a new task and turn of the same conversation, and its removal from the queue, the new task with its prompt message and its run's activation SHALL commit in the transaction that ended the earlier task, so its start is reported after the earlier turn's end and a crash never leaves it both started and queued; it SHALL start at most once. Its recent context SHALL hold the finished task. A queued start SHALL run no title check of its own. A message SHALL stay queued while the task waits on an answer, an approval or an earlier saved worker-result interrupt, or is paused or uncertain. With no unfinished task and a free queue, a queued message SHALL start at once. Cancel task, the Stop of the owner's decisions, SHALL end the task and hold the queue while it holds messages, until **Resume queue**. A start of the module SHALL start no work and SHALL hold every queue that still holds messages until **Start**, publishing that change at a new revision. A queued message that cannot start, because conversation is off or unavailable, the conversation is unrecovered or a paid profile's spend limits leave too little for its first call, SHALL be refused at its start with that code, such as `capacity` with the limit's message, SHALL stay queued and SHALL hold the queue, with no retry. Resume queue and Start, the `resume-queue` action, SHALL release a held queue and start its next message when the conversation has no unfinished task; a start the module still refuses SHALL refuse the command and leave the queue held; with nothing held it SHALL be refused with `invalid-state`. Withdrawing the last message SHALL release a hold. Send SHALL still start a task beside a held queue, which stays held. Public `assistant-state/2.2` SHALL list each profile's current conversation whose queue holds messages, with the count, the hold (`stop`, `restart`, `refused` or none) and a refusal's code, and no text, and the module SHALL publish `assistant-state/2.3`, which allows a count up to 16, only while a queue holds more than 8; an authorized reader SHALL read the queue's messages and hold, and the running task's unread steers, through the private conversation route's `view=queue`.

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

### Requirement: Steering a running task

The owner SHALL be able to steer a conversation's unfinished task with a new message ([Hub #2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031), owner decisions 1, 3, 4 and 5 of [#505 round 2](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7079875201)). On the Conversation page **Send**, and Enter, SHALL steer a task that works or has an earlier saved worker-result interrupt. The module SHALL take a steer as a staged `steer` input naming the profile, the text, the revision read and the `taskId` of the turn the page expects, and with `questionId` the question it sets aside. A steer SHALL be saved at once in the module's queue store, keyed by the request ID of its input command, without bumping the task's generation, so the running call goes on; a repeated command SHALL save nothing more. The task's unread steers SHALL show above the composer and in the private queue read. Each SHALL be taken into the task's own transcript, oldest first, in the admission transaction of the task's next model call, after any tool results of the last call, so the Messages API reads the `tool_result` blocks first and the steer's text after them, and SHALL be saved in the conversation there, in the task's turn; a call the turn's limits refuse SHALL leave them unread, and a replayed model node whose call was admitted SHALL take none again. The recent conversation section SHALL stay as fixed when the task started. A steer that is unread when a model call's answer is saved SHALL make a final answer superseded: that answer SHALL be saved and never spoken, and the task SHALL make one more model call, admitted, reserved and counted as any other, to read it; only the turn's final reply SHALL be spoken. A steer the task never read SHALL go back to the head of its conversation's queue, in order and before the messages already queued, in the commit that closes the turn, succeeded or failed, so one that arrived after the last model call starts as the next queued message, and in the commit of Cancel task, which then holds the queue; none SHALL be dropped. A steer that reaches its turn after the turn ended, while that turn is still the conversation's latest, SHALL become the next queued message the same way, even past 8 up to the queue's bound of 16 as a returned steer may, and start at once unless the queue is held; after Cancel task it SHALL hold the queue, as the steers Cancel task returned do. A steer aimed at a turn a newer turn followed, at another conversation's or an unknown turn, or setting aside a question of an ended turn, SHALL be refused with `invalid-state` and never retried (ADR 0012); a steer naming a revision the assistant has not reached SHALL be refused as a revision conflict, while the running task's own steps never make a steer stale. A paused or uncertain task SHALL refuse a steer with `invalid-state`. During an approval a steer SHALL be queued, and **Decline with message** SHALL decline the approval and steer the task in one commit; during a clarification the composer SHALL answer it, and **Skip question and send** SHALL answer the clarification with a fixed tool result saying the owner skipped it and steer the task in one commit; a delegation SHALL refuse either with `invalid-state`. A steer on an earlier saved worker-result interrupt SHALL stay with that task until it resumes. A background job SHALL NOT hold a steer or prevent a new Conversation turn. When fewer than two model calls remain in the turn's limits, by its count of model calls, its active time at a model call's deadline or its usage units at the least a call reserves, a steer SHALL be queued instead. A task SHALL hold at most 8 unread steers, and its steers and its conversation's queue together at most 16; a steer past either SHALL be refused with `capacity` and a fixed message. A steer SHALL run no title check of its own, while a declined approval stays the title's major event, and SHALL report no turn of its own to the shared session model. A restart SHALL start no work: a waiting or paused task keeps its unread steers, and steers a start's reconciliation returns, and unread steers a start finds on a task that already finished, SHALL go back to the head of their queue and wait there, held with `restart`. The graph version SHALL be `conversation-2`, whose model node has an edge back to itself; each start SHALL upgrade an unfinished task saved under `conversation-1`, whose nodes, state and checkpoints are the same, before reconciling it, while a task of any other version stays recovered unavailable. An unread steer's text SHALL reach only its own task's model calls and SHALL be stored only in the queue store; once the task reads it, it SHALL be a saved owner message of the conversation like any other, and a superseded reply a saved assistant message, which later turns' recent context and the conversation's title checks read. Steer text SHALL never appear in logs, published state or session reports.

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
- **WHEN** the owner writes a new message while a background job is running or waiting for worker capacity
- **THEN** the message follows ordinary Conversation admission and neither worker state delays a model call

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

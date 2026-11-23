## RENAMED Requirements

- FROM: `### Requirement: Bounded single execution`
- TO: `### Requirement: Bounded execution per conversation`

## MODIFIED Requirements

### Requirement: Durable explicit task activation

The system SHALL preserve inspectable, versioned conversations, messages, tasks, questions, answers, runs and logical call receipts in the companions-owned database. Conversation/task/question identity SHALL survive restart; each activation SHALL use a new run identity. Profile threads for B.U.N.N.Y., Reachy and MicroDuck SHALL remain distinct. Startup SHALL reconcile each conversation's saved state separately without executing work.

#### Scenario: Question survives restart
- **WHEN** a task pauses for clarification and the process stops
- **THEN** the same task/question and admitted messages remain readable after restart, and an explicit resume uses a new run without repeating completed calls

#### Scenario: Answer was saved before interruption
- **WHEN** the process stops after saving an answer but before graph continuation
- **THEN** the saved answer remains readable and explicit resume consumes it once

#### Scenario: Unknown admitted call or incompatible graph
- **WHEN** recovery finds an admitted call without a result or an unsupported graph version
- **THEN** it preserves readable evidence, reports uncertainty or unavailability and refuses automatic retry or an empty replacement thread

#### Scenario: Each conversation recovers separately
- **WHEN** the runtime restarts with unfinished tasks in several conversations
- **THEN** startup reconciles each one on its own, reports only each conversation's own change, and starts no run, model call, speech or dispatch

### Requirement: Bounded execution per conversation

The system SHALL admit at most one unfinished task and one graph invocation per conversation, with no execution queue. A task in one conversation SHALL NOT block a start, answer, resume or cancel in another, and the running slot SHALL be keyed by conversation, not by a fixed list of profiles; each conversation belongs to one profile today. A start in a conversation whose own task is unfinished SHALL be refused with the capacity code. Every conversation's graph SHALL run on the module's one SDK-owned SQLite connection with no transaction across an await, its own checkpoint thread and its own cancellation fence. A turn is one task: one owner message and everything it causes. Each task SHALL retain limits of 50 model calls, 40 tool calls, 10 questions, 40 minutes active time and 1,000,000 usage units; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Before each model call the task SHALL reserve the request's UTF-8 bytes plus 8,192 framing units and 16,384 output units. Model/tool deadlines SHALL be six minutes and 30 seconds, and control admission five seconds. An owner message SHALL be bounded at 32 KiB, a tool result at 8 KiB, a model reply with its provider blocks at 16 KiB, the working transcript at 1 MiB, staged input at 193 KiB and each serialized checkpoint or set of pending writes at 256 KiB. A call that would pass a limit SHALL be refused before dispatch, and the task SHALL end with the capacity code and a conversation message that names the limit. Reservations SHALL precede dispatch and survive restart; resume SHALL never replenish a turn's budget; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

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

### Requirement: Conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability, reported usage in hosted tokens or synthetic units, and unknown when usage is unreported, today's shared spend against the daily limit and this month's local estimate, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Read aloud control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision; a waiting delegation SHALL say it waits for the worker and offer cancel, not an answer box. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

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
- **THEN** the proposal shows the repository, brief and bound revision, the page then shows the delegated work waiting for the worker with cancel available, and the worker's result appears as a tool message

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

### Requirement: Viewport-filling Conversation workspace

The Conversation page SHALL use remaining viewport height for the transcript and keep the composer in view when the controls fit. The page SHALL show one header row with the open profile's name, a Demo label when that profile is the Reachy or MicroDuck demo, and Details; the page's own title SHALL remain its heading without being drawn. The transcript's reading column and the composer SHALL share one measure of at most 920px. The chat profiles SHALL be chosen in the dashboard's rail, which labels both demos before selection, and the page SHALL carry no profile list or selector of its own. The page SHALL retain the Hub navigation, and the other companion pages SHALL be reached from the Devices menu.

#### Scenario: Read and compose in the available viewport
- **WHEN** the owner opens an empty or short conversation on desktop or a narrow phone viewport
- **THEN** the open profile's name, the transcript and the composer fit without scrolling the document, and additional viewport height increases the transcript height
- **AND** a long decision or constrained viewport still allows scrolling to read its full text and reach every action

#### Scenario: Browse profiles and companion pages
- **WHEN** the owner inspects the conversations in the rail and chooses one, or opens the Devices menu
- **THEN** both demos are labelled before selection, the header row names the chosen profile with its Demo label, and the device-management links remain distinct from the chat choices
- **AND** the Devices menu lists the other companion pages and marks the open page
- **AND** switching to a demo while another profile has unfinished work shows the demo's separate history and lets the owner start the demo's own task

#### Scenario: Resize or open local navigation while reading
- **WHEN** the owner resizes the viewport, chooses another profile in the rail or opens and closes the Devices menu without leaving Conversation
- **THEN** the mounted conversation keeps each profile's draft and sends no command or additional speech endpoint registration
- **AND** resizing and the Devices menu keep the reading position

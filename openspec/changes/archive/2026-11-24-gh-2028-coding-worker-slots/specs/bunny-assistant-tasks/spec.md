## MODIFIED Requirements

### Requirement: Owner approval of proposed commands

Every state-changing command SHALL go through the existing question interrupt as an approval proposal bound to the exact family, target, value and the revision it was proposed against: the synced Hub-mode revision for `mode-set`, the coding worker's endpoint revision for a delegation, which moves only when a worker endpoint is selected, disabled or lost and never when a run starts or ends, and the configuration revision and generation for each LIFX write. A delegation SHALL be proposed while a coding worker is connected, even when the asking companion's slot is busy. The owner SHALL answer an approval only with the literal decisions approve or decline. An approved command SHALL be dispatched once through the core's tracked dispatcher; a dispatch whose bound revision has moved SHALL be refused and reported to the model as refused; a decline SHALL send nothing and say so. An approved delegation SHALL leave the task waiting on a delegation that only the worker's result answers, whether it was sent at once or waits for its companion's busy slot, in which case the tool result SHALL say the coding worker is busy and the hand-off waits for that companion's slot; the owner's input SHALL be refused for it, it SHALL count no owner question, and cancelling the task SHALL ask the worker to stop or, for a hand-off still waiting, remove it unsent.

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
- **THEN** the tool result says the coding worker is busy and the hand-off waits for that slot, the title check for an accepted hand-off runs once, and no reply says no coding worker is connected

### Requirement: Conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability with how many of its slots are busy and how many hand-offs wait, the conversation companion's own slot, the shared plan usage windows the worker's readiness reported with their use, reset and when they were observed, or why there are none, reported usage in hosted tokens or synthetic units, and unknown when usage is unreported, today's shared spend against the daily limit and this month's local estimate, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Read aloud control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision and, while the companion's slot is busy, that an approved hand-off waits for it; a waiting delegation SHALL say it waits for the worker, worded as busy and unsent while its hand-off waits for a slot, and offer cancel, not an answer box. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

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

#### Scenario: Busy slot on the page
- **WHEN** a companion's slot is busy and its conversation proposes a delegation that the owner approves
- **THEN** the proposal says the hand-off will wait, the delegated work says the coding worker is busy and nothing has been sent, the details show the busy slots and the waiting hand-off, and the card changes to the ordinary wait once the hand-off is sent

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

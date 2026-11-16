## MODIFIED Requirements

### Requirement: Conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability, reported usage in hosted tokens or synthetic units, and unknown when usage is unreported, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Read aloud control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision; a waiting delegation SHALL say it waits for the worker and offer cancel, not an answer box. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

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
- **AND** the composer blocks conflicting starts but allows browsing saved history and returning to the unfinished task
- **AND** Enter submits eligible text outside IME composition, and Shift+Enter inserts a newline
- **AND** full approval scope and active questions and waits remain visible outside collapsed routine facts

#### Scenario: Retain a draft after a refused or lost reply
- **WHEN** a submission is refused or its reply is lost
- **THEN** the draft and tracked receipt remain visible and the page sends no retry

#### Scenario: Guard an unavailable task decision
- **WHEN** the assistant copy is removed or the current saved question is missing or refers to another question
- **THEN** loaded messages remain readable and answer and approval actions remain unavailable
- **AND** Refresh history makes one deliberate latest read when the current saved question or proposal is unavailable

#### Scenario: Inspect labelled Details
- **WHEN** a reader opens Details in Conversation
- **THEN** Capabilities, Task activity, Usage and Conversation settings start collapsed, and each can expand independently without changing the selected profile, draft or transcript position
- **AND** closing Details gives the wide transcript its space back and resizing preserves the viewed saved row
- **AND** provider and tool facts, worker availability, task identifiers and bounds, saved question and answer, diagnostic codes, successful control receipts and usage retain their meaning
- **AND** retained assistant facts read as Last known, a missing worker copy reads as unknown, and usage distinguishes unknown, zero, synthetic units and hosted tokens without estimating billed cost
- **AND** active decisions, task result cues, blockers, and unresolved or negative control outcomes remain visible by the relevant controls

#### Scenario: Use existing conversation settings
- **WHEN** the owner opens Conversation settings
- **THEN** the section explains saved input and offers the current enable or disable action through the same guarded command
- **AND** a reader or stale copy cannot mutate, and an unfinished task prevents disabling the conversation

#### Scenario: Expand saved tool text
- **WHEN** the owner or reader opens a tool result on a saved transcript row
- **THEN** the full inert text can be read without horizontal page overflow, and the row retains its original task association and message order
- **AND** opening or closing the result does not fetch, send a command, or replay text or audio
- **AND** loading earlier saved messages keeps the result open and preserves the current reading position within it

#### Scenario: Compact spoken reply controls
- **WHEN** the owner opens Voice on the Conversation page
- **THEN** the panel shows current readiness and the existing Enable, Mute and eligible recovery actions
- **AND** an unresolved playback reservation disables Enable until it is cleared, and historical uncertainty remains in the playback disclosure without overriding a later successful Enable
- **AND** Stop speaking remains available outside the panel during local playback and leaves the task and question unchanged
- **AND** Read aloud uses the tracked command for the same saved assistant message within the speech limit, presents the command receipt separately from playback, and explains why a longer message stays written only

### Requirement: Spoken replies to typed requests

When a task turn ends with a result, a question for the owner or a refusal, the companions module SHALL offer that saved message once to its speech coordinator, after the message is durable, under the message's own identity. A `speak` control naming a task and a saved assistant message SHALL offer that message again under the request's identity; it SHALL refuse owner or tool text and an unknown message, SHALL work for finished tasks, and SHALL be idempotent per request. A message longer than 512 characters SHALL stay written only. Startup reconciliation SHALL offer nothing, and a failed offer SHALL NOT change the task's outcome. The spoken voice SHALL be the installation's qualified local voice regardless of the model provider, and stopping speech SHALL NOT answer a question or cancel the task.

#### Scenario: Turn-ending messages are spoken once
- **WHEN** spoken replies are enabled and a typed request produces a question, then an answer produces a result
- **THEN** the question and the result are each spoken once through the reserved endpoint with the saved text, and a restart between them speaks nothing

#### Scenario: Speak replays a saved answer
- **WHEN** the owner activates Read aloud beside a saved assistant message
- **THEN** one accepted control receipt is recorded, the message is spoken again as its own utterance, a repeated request id speaks nothing more, and a direct speak request for owner text or an unknown message is refused

#### Scenario: Stop without cancellation
- **WHEN** the owner stops speech while a question is being spoken
- **THEN** the audio stops, the task stays waiting for its answer, and Quiet mode keeps the next reply written only

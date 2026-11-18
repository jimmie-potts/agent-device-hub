## MODIFIED Requirements

### Requirement: Conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability, usage in tokens or unknown, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Speak control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision; a waiting delegation SHALL say it waits for the worker and offer cancel, not an answer box. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

#### Scenario: Approval by keyboard
- **WHEN** a task waits for approval and the owner reloads the page and operates it by keyboard
- **THEN** the proposal, its target and value are readable, approve and decline are labelled, and a successful answer receipt does not assert that the command completed

#### Scenario: Read-only and disconnected states
- **WHEN** the browser lacks control authority or loses its connection
- **THEN** saved history stays readable, every mutating control is disabled, and the page says why

#### Scenario: Spoken replies by keyboard
- **WHEN** the owner enables spoken replies in the Conversation tab by keyboard, sends a request and activates Speak on the saved answer
- **THEN** the question, result and replay are spoken through that tab and the Speak receipt is shown apart from the playback report

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

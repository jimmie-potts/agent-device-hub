## MODIFIED Requirements

### Requirement: Private authorized controls and truthful outcomes

Inputs SHALL use bounded authenticated upload staging with references bound to request, profile, task, question and expected revision. Controls SHALL enter through core authorization. Public summaries, core operations and diagnostics SHALL omit conversation text. Conversation reads SHALL use the existing authenticated read scope and pagination with responses at most 64 KiB. Domain changes and command outcomes SHALL commit together through the SDK outbox. A successful control SHALL describe its durable local transition separately from task completion.

#### Scenario: Duplicate or stale control
- **WHEN** a start, answer or resume is duplicated, stale, or addresses the wrong question
- **THEN** it cannot duplicate work or consume an answer again, even with a new request ID

#### Scenario: Refused admission
- **WHEN** authorization, input validation or durable admission fails, including full disk
- **THEN** no graph starts and the existing error registry describes the refusal without private content

#### Scenario: Outbox recovery
- **WHEN** committed outcomes are republished after restart
- **THEN** their original identity and trace survive and no task is activated by republishing

#### Scenario: Recent and earlier private pages
- **WHEN** an authorized reader requests the opt-in recent view of a saved conversation
- **THEN** version 2 identifies the profile and conversation, returns the newest window of up to 16 complete messages in chronological order and at most 65,536 UTF-8 bytes including metadata, and supplies the latest task and saved question independently of the messages
- **AND** an exclusive earlier cursor stays bound to that profile and conversation, advances below the oldest returned message, and terminates with a null cursor when no older message remains
- **AND** an earlier page cannot supply a different current question, and the ordinary version 1 profile/after read retains its forward behavior

#### Scenario: Invalid or oversized history read
- **WHEN** a reader mixes history modes or supplies an invalid, unsafe or mismatched earlier cursor
- **THEN** the existing invalid-request result refuses the read
- **AND** denied reads keep the shared authorization refusal and owner read failures use unavailable
- **AND** if even the first complete row and metadata cannot fit, the read returns capacity without skipping the row or returning a nonadvancing cursor
- **AND** reads change no stored data and emit no lifecycle observations

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

## MODIFIED Requirements

### Requirement: Permitted tools from the runtime

The companions module SHALL discover the tools a turn may call from its own static catalog and filter them by the private section's allowlist, checking membership again when a call executes, so a changed section cannot widen an effect. The built-in owner question is always available; the synthetic fixture read exists only for the synthetic provider. Slice one's catalog is `read_sessions`, `set_mode` and `delegate_coding`; discovery from runtime module manifests and core command families is deferred to the first device-command tool. The dashboard SHALL show allowed and unavailable tools and grant nothing. `delegate_coding` SHALL propose handing one bounded coding task, named by an allowlisted repository and a brief, to the coding worker; without a connected worker, or with an unusable repository name or brief, the call SHALL be refused as a tool result and nothing proposed.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, activity, attention and freshness from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

#### Scenario: Delegation without a worker
- **WHEN** the model calls `delegate_coding` while no coding worker endpoint is available
- **THEN** the call ends as a tool result saying no worker is connected, no proposal is made and the owner is not asked

### Requirement: Owner approval of proposed commands

Every state-changing command SHALL go through the existing question interrupt as an approval proposal bound to the exact family, target, value and the revision it was proposed against: the synced Hub-mode revision for `mode-set`, the coding state revision for a delegation. The owner SHALL answer an approval only with the literal decisions approve or decline. An approved command SHALL be dispatched once through the core's tracked dispatcher; a dispatch whose bound revision has moved SHALL be refused and reported to the model as refused; a decline SHALL send nothing and say so. An approved delegation SHALL leave the task waiting on a delegation that only the worker's result answers; the owner's input SHALL be refused for it, it SHALL count no owner question, and cancelling the task SHALL ask the worker to stop.

#### Scenario: Approved mode change
- **WHEN** the owner approves a proposed `set_mode` and the Hub mode has not changed since the proposal
- **THEN** one tracked `mode-set` operation is sent with the recorded expected revision, the saved mode changes, and the task's final text reports the accepted result without claiming device effects

#### Scenario: Declined or stale proposal
- **WHEN** the owner declines, or approves after the Hub mode or the coding worker's state changed
- **THEN** no command is sent for a decline; a stale approval is refused with `revision-conflict` and the conversation reports it; neither path starts a duplicate command

#### Scenario: Approval after restart
- **WHEN** the runtime restarts while an approval question is waiting
- **THEN** the same question, proposal and recorded revision remain readable, and the explicit answer applies once to that proposal only

#### Scenario: Delegation answered by the worker
- **WHEN** an approved delegation is accepted and the worker later reports its result
- **THEN** the task resumes with that result as the tool's result, the next turn reports it, and an owner answer sent meanwhile is refused as invalid state

### Requirement: Accessible conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability, usage in tokens or unknown, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Speak control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision; a waiting delegation SHALL say it waits for the worker and offer cancel, not an answer box. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

#### Scenario: Approval by keyboard
- **WHEN** a task waits for approval and the owner reloads the page and operates it by keyboard
- **THEN** the proposal, its target and value are readable, approve and decline have accessible names, and a successful answer receipt does not assert that the command completed

#### Scenario: Read-only and disconnected states
- **WHEN** the browser lacks control authority or loses its connection
- **THEN** saved history stays readable, every mutating control is disabled, and the page says why

#### Scenario: Spoken replies by keyboard
- **WHEN** the owner enables spoken replies in the Conversation tab by keyboard, sends a request and activates Speak on the saved answer
- **THEN** the question, result and replay are spoken through that tab, the Speak receipt is shown apart from the playback report, and the page passes the accessibility checks

#### Scenario: Delegation on the page
- **WHEN** the model proposes a delegation and the owner approves it by keyboard
- **THEN** the proposal shows the repository, brief and bound revision, the page then shows the delegated work waiting for the worker with cancel available, and the worker's result appears as a tool message

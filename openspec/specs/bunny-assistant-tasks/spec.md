# Bunny assistant tasks specification

## Purpose

Let one local owner converse with B.U.N.N.Y. through a configured model provider or the labelled synthetic one, with permitted read tools, owner-approved commands sent through the core's tracked dispatcher, and bounded tasks that can be explicitly resumed after restart, without a second runtime or any unapproved device effect.

## Requirements

### Requirement: Durable explicit task activation

The system SHALL preserve inspectable, versioned conversations, messages, tasks, questions, answers, runs and logical call receipts in the companions-owned database. Conversation/task/question identity SHALL survive restart; each activation SHALL use a new run identity. Profile threads for B.U.N.N.Y., Reachy and MicroDuck SHALL remain distinct. Startup SHALL reconcile saved state without executing work.

#### Scenario: Question survives restart
- **WHEN** a task pauses for clarification and the process stops
- **THEN** the same task/question and admitted messages remain readable after restart, and an explicit resume uses a new run without repeating completed calls

#### Scenario: Answer was saved before interruption
- **WHEN** the process stops after saving an answer but before graph continuation
- **THEN** the saved answer remains readable and explicit resume consumes it once

#### Scenario: Unknown admitted call or incompatible graph
- **WHEN** recovery finds an admitted call without a result or an unsupported graph version
- **THEN** it preserves readable evidence, reports uncertainty or unavailability and refuses automatic retry or an empty replacement thread

### Requirement: Bounded single execution

The system SHALL admit at most one unfinished task across profiles and one invocation, with no execution queue. Each task SHALL retain limits of six model calls, four tool calls, two questions, 300 seconds active time and 65,536 usage units, with 16,384 units reserved before each model call; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Model/tool deadlines SHALL be 60/8 seconds and control admission five seconds. Inputs, tool results, a model reply with its provider blocks, and serialized working state SHALL be bounded at 4/8/16/32 KiB. Reservations SHALL precede dispatch and survive restart; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

#### Scenario: A limit is exhausted
- **WHEN** another operation would exceed a persisted limit
- **THEN** it is refused before dispatch, including after resume or restart

#### Scenario: Cancellation and late result
- **WHEN** cancellation is durably saved while a call is pending
- **THEN** later steps remain fenced, abort is best effort, and a late result can update evidence but cannot reactivate the task

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

### Requirement: Configured model provider

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret or with an unsupported provider. The `bunny` profile alone SHALL use the configured provider; other profiles SHALL keep the synthetic provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results, the fixed instructions, the current Hub mode and the prompt context: the task profile's curated persona and the owner's currently active explicit preferences, read from the module's own records at each model call and rendered as owner data that grants no tool, permission or device authority. No knowledge entry, conversation history, other task, inactive or historical preference or private context document SHALL enter the prompt. When the rendered prompt context exceeds 16 KiB the model call SHALL be refused before dispatch with a capacity outcome whose transcript message names the cause; nothing SHALL be truncated silently. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Public state SHALL carry the provider, model and allowed tool names.

#### Scenario: Synthetic default
- **WHEN** the module starts with an empty companions section or with one that names no provider
- **THEN** public state shows the synthetic provider, no outbound request is made, and a task completes through the same question, tool and approval path

#### Scenario: Configured hosted provider
- **WHEN** the section names the Anthropic provider, its model and its key secret
- **THEN** a `bunny` task sends one request per model call to the Messages API with that model, the fixed instructions, the prompt context, the transcript and the permitted tools; usage tokens are recorded on the call; and the key appears in no record, state, log or page

#### Scenario: Persona and active preferences enter the prompt
- **WHEN** the owner has active and inactive explicit preferences and starts a `bunny` task, then edits a preference and stops using another before the next model call
- **THEN** the first call's prompt carries the `bunny` persona and only the then-active preferences by title and text, the next call reflects the edit and omits the stopped entry, no knowledge entry or earlier conversation appears, and the prompt text reaches no public state, outcome, log or span

#### Scenario: Prompt context over its bound
- **WHEN** the owner's active preferences render larger than 16 KiB
- **THEN** the model call is refused before dispatch, the task ends with the capacity code and a transcript message naming the preference bound, and no request is sent

#### Scenario: Provider failure
- **WHEN** the provider answers with a refusal, an authentication or rate-limit error, is unreachable or exceeds its deadline
- **THEN** the task ends failed or unavailable with the registry code, or uncertain after a lost answer, no second model is tried, and the dashboard's mode controls keep working

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

### Requirement: Core admission of assistant commands

The core SHALL answer an `assistant-dispatch` command only from `bunny/modules/companions`, forward only an allowlisted family and target to its tracked dispatcher as one operation requested by that module, and refuse any other source, family or target before anything is recorded. The operation SHALL follow the dispatcher's ordinary reply, outcome, inbox and history rules.

#### Scenario: Forwarded mode-set
- **WHEN** the companions module dispatches an approved `mode-set` for the Hub
- **THEN** the core records one tracked operation requested by the module, the mode owner answers it, and its outcome reaches history and the inbox like an operator's command

#### Scenario: Refused dispatch
- **WHEN** another source sends `assistant-dispatch`, or the module names a family or target outside the core's allowlist
- **THEN** the core refuses with `forbidden` for another source, or `invalid-message` for a family, target or value its closed schema rejects, records no operation and sends nothing

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
- **THEN** the panel shows current readiness and the existing Enable, Mute and eligible recovery actions
- **AND** an unresolved playback reservation disables Enable until it is cleared, and historical uncertainty remains in the playback disclosure without overriding a later successful Enable
- **AND** Stop speaking remains available outside the panel during local playback and leaves the task and question unchanged
- **AND** Read aloud uses the tracked command for the same saved assistant message within the speech limit, presents the command receipt separately from playback, and explains why a longer message stays written only

### Requirement: Viewport-filling Conversation workspace

The Conversation page SHALL use remaining viewport height for the transcript and keep the composer in view when the controls fit. The page SHALL retain the Hub navigation and existing companion page links, and distinguish the everyday B.U.N.N.Y. profile from the Reachy and MicroDuck demo chat profiles before selection.

#### Scenario: Read and compose in the available viewport
- **WHEN** the owner opens an empty or short conversation on desktop or a narrow phone viewport
- **THEN** the selected profile, transcript and composer fit without scrolling the document, and additional viewport height increases the transcript height
- **AND** a long decision or constrained viewport still allows scrolling to read its full text and reach every action

#### Scenario: Browse profiles and companion pages
- **WHEN** the owner inspects the chat choices or opens Companion pages
- **THEN** both demos are labelled before selection and the device-management links remain distinct from the chat choices
- **AND** the companion navigation retains its existing links and current page indication
- **AND** switching to a demo while another profile has unfinished work allows inspection of its separate history without a conflicting start

#### Scenario: Resize or open local navigation while reading
- **WHEN** the owner resizes the viewport or opens and closes Companion pages without leaving Conversation
- **THEN** the mounted conversation keeps the reading position and draft, and sends no command or additional speech endpoint registration

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

### Requirement: Registered safe diagnostics

Assistant run/model/tool spans and decision records SHALL use the SDK diagnostic contract and registered identifiers. Spans SHALL finish at human waits and shutdown; subsequent runs SHALL link prior context. Logs SHALL contain only fixed codes, identifiers and bounded numeric evidence. A failed diagnostic sink SHALL not change execution outcomes.

#### Scenario: Correlated private task
- **WHEN** a synthetic request starts a run and a model/tool call
- **THEN** registered records correlate request, task, run and logical effect without prompts, tool bodies, credentials or exception text

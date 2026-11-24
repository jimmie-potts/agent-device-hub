# Bunny assistant tasks specification

## Purpose

Let one local owner converse with B.U.N.N.Y. through a configured model provider or the labelled synthetic one, with permitted read tools, owner-approved commands sent through the core's tracked dispatcher, and bounded tasks that can be explicitly resumed after restart, without a second runtime or any unapproved device effect.

## Requirements

### Requirement: Durable explicit task activation

The system SHALL preserve inspectable, versioned conversations, messages, tasks, questions, answers, runs and logical call receipts in the companions-owned database. Conversation/task/question identity SHALL survive restart; each activation SHALL use a new run identity. Profile threads for B.U.N.N.Y., Reachy and MicroDuck SHALL remain distinct. Startup SHALL reconcile each conversation's saved state separately without executing work. A recovery that fails SHALL leave only its own conversation unavailable, refusing its answers, resumes and new tasks until the next start, while the others keep working, and SHALL save one assistant message in that conversation for each failed start saying that its saved progress could not be restored, that the task can be cancelled but new messages there can't be sent until B.U.N.N.Y. restarts, and that the restart tries the recovery again.

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

#### Scenario: A recovery fails in one conversation
- **WHEN** one conversation's saved graph state cannot be read at startup while two others wait on their questions
- **THEN** that conversation's task is recovered unavailable, its conversation shows one message naming the cause, that the task can be cancelled and that new messages can't be sent until a restart, and it refuses an answer and, after a cancel, a new task until the next start, while the assistant stays available and the other two are answered and finish
- **AND** a later start whose recovery succeeds writes no such message

### Requirement: Bounded execution per conversation

The system SHALL admit at most one unfinished task and one graph invocation per conversation, with no execution queue. A task in one conversation SHALL NOT block a start, answer, resume or cancel in another, and the running slot SHALL be keyed by conversation, not by a fixed list of profiles; each conversation belongs to one profile today. A start in a conversation whose own task is unfinished SHALL be refused with the capacity code. A command for a conversation, a start, answer, approval, resume, cancel, Read aloud or rename, SHALL be refused as a revision conflict only when its own conversation changed after the assistant revision it names, or when it names a revision the assistant has not reached; enable and disable SHALL keep the assistant-wide revision. A rename, and a correction or removal of one of its messages, SHALL count as a change of its conversation, and each start SHALL count every saved conversation, a companion exchange without a profile included, as changed at the assistant's current revision. Every conversation's graph SHALL run on the module's one SDK-owned SQLite connection with no transaction across an await, its own checkpoint thread and its own cancellation fence. A turn is one task: one owner message and everything it causes. Each task SHALL retain limits of 50 model calls, 40 tool calls, 10 questions, 40 minutes active time and 1,000,000 usage units; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Before each model call the task SHALL reserve the request's UTF-8 bytes plus 8,192 framing units and 16,384 output units. Model/tool deadlines SHALL be six minutes and 30 seconds, and control admission five seconds. An owner message SHALL be bounded at 32 KiB, a tool result at 8 KiB, a model reply with its provider blocks at 16 KiB, the working transcript at 1 MiB, staged input at 193 KiB and each serialized checkpoint or set of pending writes at 256 KiB. A call that would pass a limit SHALL be refused before dispatch, and the task SHALL end with the capacity code and a conversation message that names the limit. Reservations SHALL precede dispatch and survive restart; resume SHALL never replenish a turn's budget; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

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

### Requirement: Private authorized controls and truthful outcomes

Inputs SHALL use bounded authenticated upload staging with references bound to request, profile, task, question and expected revision. Controls SHALL enter through core authorization. Public summaries, core operations and diagnostics SHALL omit conversation text. Conversation reads SHALL use the existing authenticated read scope and pagination with responses at most 512 KiB. Domain changes and command outcomes SHALL commit together through the SDK outbox. A successful control SHALL describe its durable local transition separately from task completion.

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
- **THEN** version 2 identifies the profile and conversation, returns the newest window of up to 16 complete messages in chronological order and at most 524,288 UTF-8 bytes including metadata, and supplies the latest task and saved question independently of the messages
- **AND** an exclusive earlier cursor stays bound to that profile and conversation, advances below the oldest returned message, and terminates with a null cursor when no older message remains
- **AND** an earlier page cannot supply a different current question, and the ordinary version 1 profile/after read retains its forward behavior

#### Scenario: Invalid or oversized history read
- **WHEN** a reader mixes history modes or supplies an invalid, unsafe or mismatched earlier cursor
- **THEN** the existing invalid-request result refuses the read
- **AND** denied reads keep the shared authorization refusal and owner read failures use unavailable
- **AND** if even the first complete row and metadata cannot fit, the read returns capacity without skipping the row or returning a nonadvancing cursor
- **AND** reads change no stored data and emit no lifecycle observations

### Requirement: Configured model provider

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file, and MAY name `assistant.prices` with the input, output, five-minute cache write and cache read prices of each model in US dollars per million tokens, which override the built-in table; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret, with a malformed price table or with an unsupported provider. A section without prices SHALL start the module and run with daily pacing at the built-in prices. A 400 `invalid_request_error` whose message starts with "You have reached your specified API usage limits" or "You have reached your specified workspace API usage limits", or a 429 `rate_limit_error` whose `error.details.error_code` is `enforced_spend_limit_reached`, SHALL end the task with the capacity code and a conversation message naming the monthly spend limit at Anthropic, with nothing more sent for that turn and no retry; no other 400 or 429 SHALL be read as a spend limit. The `bunny` profile alone SHALL use the configured provider; other profiles SHALL keep the synthetic provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results, the fixed instructions, the current Hub mode and the prompt context: the task profile's curated persona and the owner's currently active explicit preferences, read from the module's own records at each model call and rendered as owner data that grants no tool, permission or device authority. No knowledge entry, conversation history, other task, inactive or historical preference or private context document SHALL enter the prompt. When the rendered prompt context exceeds 128 KiB the model call SHALL be refused before dispatch with a capacity outcome whose transcript message names the cause; nothing SHALL be truncated silently. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Each hosted request SHALL ask for automatic prompt caching with one top-level `cache_control` of type `ephemeral`, with the tools, the system prompt and the replayed transcript first and byte-stable between a task's calls, and SHALL report usage by class: uncached input, output, cache writes and cache reads; a report without input or output counts, or with a count that is not a whole number, SHALL be unreported. Public state SHALL carry the provider, model and allowed tool names.

#### Scenario: Synthetic default
- **WHEN** the module starts with an empty companions section or with one that names no provider
- **THEN** public state shows the synthetic provider, no outbound request is made, and a task completes through the same question, tool and approval path

#### Scenario: Configured hosted provider
- **WHEN** the section names the Anthropic provider, its model and its key secret
- **THEN** a `bunny` task sends one request per model call to the Messages API with that model, the fixed instructions, the prompt context, the transcript and the permitted tools; usage tokens are recorded on the call; and the key appears in no record, state, log or page

#### Scenario: Full tool catalog on the hosted provider
- **WHEN** the permitted tool catalog exceeds the Messages API's strict-tool limit
- **THEN** the request includes every permitted tool, uses strict mode within the provider's limit, and checks the remaining tool calls against their closed input schemas before they can reach approval or act

#### Scenario: Persona and active preferences enter the prompt
- **WHEN** the owner has active and inactive explicit preferences and starts a `bunny` task, then edits a preference and stops using another before the next model call
- **THEN** the first call's prompt carries the `bunny` persona and only the then-active preferences by title and text, the next call reflects the edit and omits the stopped entry, no knowledge entry or earlier conversation appears, and the prompt text reaches no public state, outcome, log or span

#### Scenario: Prompt context over its bound
- **WHEN** the owner's active preferences render larger than 128 KiB
- **THEN** the model call is refused before dispatch, the task ends with the capacity code and a transcript message naming the preference bound, and no request is sent

#### Scenario: Provider failure
- **WHEN** the provider answers with a refusal, an authentication or rate-limit error, is unreachable or exceeds its deadline
- **THEN** the task ends failed or unavailable with the registry code, or uncertain after a lost answer, no second model is tried, and the dashboard's mode controls keep working

#### Scenario: Cached prefix on the second call
- **WHEN** a hosted task makes a second model call after a tool result
- **THEN** the second request carries the top-level cache marker and begins with the first request's tools, system prompt and first message, and the cache write and cache read counts the provider reports reach the call's usage by class

#### Scenario: Anthropic spend-limit refusal
- **WHEN** the provider answers a hosted task's model call with a documented spend-limit refusal, for a limit the owner set, a workspace limit or the tier's monthly cap
- **THEN** the task ends with the capacity code after that one request, the conversation's last message names the monthly spend limit at Anthropic and points to the Console, and another 400 or 429 keeps its own code without that message

### Requirement: Permitted tools from the runtime

The companions module SHALL discover the tools a turn may call from its own static catalog and filter them by the private section's allowlist, checking membership again when a call executes, so a changed section cannot widen an effect. The built-in owner question is always available; the synthetic fixture read exists only for the synthetic provider. The device tools SHALL use admitted LIFX device records and the registered power and brightness commands. `read_sessions` SHALL read each session through the contracts package's shared session read function and report its shared status class and detail. The dashboard SHALL show allowed and unavailable tools and grant nothing. `delegate_coding` SHALL propose handing one bounded coding task, named by an allowlisted repository and a brief, to the coding worker; without a connected worker, or with an unusable repository name or brief, the call SHALL be refused as a tool result and nothing proposed.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, status class and detail, work confirmation and attention from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

#### Scenario: Delegation without a worker
- **WHEN** the model calls `delegate_coding` while no coding worker endpoint is available
- **THEN** the call ends as a tool result saying no worker is connected, no proposal is made and the owner is not asked

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

### Requirement: Core admission of assistant commands

The core SHALL answer an `assistant-dispatch` command only from `bunny/modules/companions`, forward only an allowlisted family and target to its tracked dispatcher as one operation requested by that module, and refuse any other source, family or target before anything is recorded. The operation SHALL follow the dispatcher's ordinary reply, outcome, inbox and history rules.

#### Scenario: Forwarded mode-set
- **WHEN** the companions module dispatches an approved `mode-set` for the Hub
- **THEN** the core records one tracked operation requested by the module, the mode owner answers it, and its outcome reaches history and the inbox like an operator's command

#### Scenario: Refused dispatch
- **WHEN** another source sends `assistant-dispatch`, or the module names a family or target outside the core's allowlist
- **THEN** the core refuses with `forbidden` for another source, or `invalid-message` for a family, target or value its closed schema rejects, records no operation and sends nothing

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

### Requirement: Conversation controls configured LIFX lights

Conversation SHALL expose authorized LIFX status, power, and brightness based on the admitted owner's current device records. It SHALL ask the owner to disambiguate matching labels before proposing a write. Reads report observed values with evidence time and identify unknown or unavailable evidence. A reading older than the LIFX refresh interval, dated in the future, or superseded by a newer transmission SHALL be reported as stale.

#### Scenario: Status from the configured owner
- **WHEN** the owner asks about a configured LIFX light
- **THEN** Conversation names the light and reports the observed power and brightness or explains that the evidence is unavailable

#### Scenario: Exact target and guarded effect
- **WHEN** the owner approves a specific power or brightness proposal
- **THEN** one tracked command targets the selected eligible bulb with the saved guards, and Conversation reports the operation without claiming a physical effect from acceptance

#### Scenario: Approval can no longer execute
- **WHEN** the target becomes unavailable before owner admission, permission is removed, or the saved guards become stale
- **THEN** the approval cannot cause a device write and Conversation reports the refusal

#### Scenario: Lost reply
- **WHEN** the assistant loses the reply after possible admission
- **THEN** it reports uncertainty and restart never repeats the command

### Requirement: Device reads and capability discovery in Conversation

Conversation SHALL identify configured devices by name and owner-qualified identity and report the supported, owner-enabled actions. It SHALL use admitted owners' SDK records, preserve observation time, and distinguish stale, unavailable, and unsupported information. On explicit LIFX reads it SHALL request the existing owner sync when a record is due for refresh, within the tool deadline. It SHALL identify the result as stale if the owner has not published a new observation.

#### Scenario: Several devices have the same label

- **WHEN** a device request matches several devices
- **THEN** Conversation asks which owner-qualified device is meant and offers no write until that answer identifies a single device

#### Scenario: An integration has no control contract

- **WHEN** the owner requests an unsupported or disabled action on an installed integration
- **THEN** Conversation describes the limitation without a device command and still offers any permitted status read

### Requirement: Tracked owner approval across device integrations

Conversation SHALL propose one exact action on a selected device or explicit set of recipients. Approval SHALL bind the owner, target, effect, and the domain revision, generation or exact immutable library version required at admission. The SDK and core dispatcher SHALL carry the existing typed commands to their respective owners. The original approval and request identity SHALL persist across failures. A lost reply SHALL remain uncertain without an automatic resend. Multi-target actions SHALL present each target's effect evidence independently.

#### Scenario: Wemo respects its device policy

- **WHEN** the owner approves power on or off for an eligible Wemo plug identified by name
- **THEN** the existing Wemo command runs through that plug's queue with its hold and revision checks
- **AND** the original continuous run and maximum-on policy remain effective

#### Scenario: A saved artwork is presented

- **WHEN** the owner approves the saved artwork and exact display recipients
- **THEN** the existing art-show path prepares and presents it and Conversation exposes each display's tracked result, including skipped or uncertain effects

#### Scenario: Availability or approval changes

- **WHEN** a held target, revoked permission, stale revision, or changed generation invalidates a proposed write
- **THEN** the refusal is visible without starting a device effect

### Requirement: Light-show authoring and playback in Conversation

Conversation SHALL let the owner create a deterministic draft, edit its cues, and preview a storyboard through the existing authoring rules. Draft and preview operations SHALL send no lighting command. Saving SHALL use the existing guarded catalog operation and retain prior versions. Playing SHALL require approval for the exact saved version and eligible light. Stopping SHALL require approval for the active generation and preserve the owner's restoration behavior. [#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) owns AI-generated drafts.

#### Scenario: Create, edit, preview and save

- **WHEN** the owner creates a draft, specifies a cue edit, previews it and explicitly saves
- **THEN** the storyboard shows the edited cue and the approved save creates one independently selectable version
- **AND** no lighting command was sent

#### Scenario: Play a saved version and stop it

- **WHEN** the owner selects a saved show version and eligible light, approves playback and later approves Stop
- **THEN** the existing playback owner runs that immutable version on the selected light and stops the selected generation

#### Scenario: Unsaved or stale selection

- **WHEN** the owner requests playback of an unsaved draft or an approval no longer matches the selected light, saved version or generation
- **THEN** Conversation reports the refusal and no playback starts from that approval

### Requirement: Created artwork in a Conversation reply

An enabled companion artwork tool SHALL propose a still image or animated GIF for owner approval and SHALL use the existing art service to create and retain the result. Conversation SHALL associate one private attachment reference with the originating companion and reply. Reading or reopening the reply SHALL perform no generation or device command.

#### Scenario: Approved still and GIF appear in their respective replies

- **WHEN** the owner approves one still image and one animated GIF on separate turns and the art service completes both jobs
- **THEN** each reply shows the exact saved rendition and an accessible description, and reopening the thread after switching companions shows the same attachments and older text-only messages
- **AND** the GIF shows a still frame when reduced motion applies and has an explicit play control that reveals its distinct frames

#### Scenario: The art result fails or becomes unavailable

- **WHEN** the job fails, is refused, or has an uncertain outcome, or the referenced media cannot be read
- **THEN** the reply stays readable and reports the actual generation outcome or unavailable attachment without resending work
- **AND** a duplicate completion adds no additional attachment

#### Scenario: Private media remains behind the existing reader

- **WHEN** the browser opens an attachment
- **THEN** it reads the exact rendition through the existing authenticated media path, and generation and read failures remain correlated by the private turn and art references without placing media in model prompts or diagnostics

#### Scenario: Art completes after its admission reply is lost

- **WHEN** approved generation completes after Conversation loses the admission reply
- **THEN** the single saved reply reference resolves to that job's artwork and no work is sent again

#### Scenario: The art catalog reaches its recent limit

- **WHEN** a newer job pushes Conversation artwork past the ordinary recent limit
- **THEN** the referenced artwork remains available when the user reopens the conversation, unless it was explicitly deleted

### Requirement: Assistant conversations report through the shared session model

The companions module SHALL report each profile's conversation as one root session of the native source, with the conversation ID as its session ID and ordering epoch, each task in it, one owner message and everything it causes, as one turn named by the task ID, and each saved clarification or approval as one attention item named by its question ID. An answered question, a resume and the run either starts SHALL stay in the task's turn; only a new task SHALL start a turn, once, when it starts. Each task end SHALL report exactly one `turn-ended` with the task's result, and when one transaction ends a task and starts the next in the same conversation, the earlier turn's end SHALL precede the next turn's start. The conversation's observations SHALL carry one ordering sequence that increases across its tasks. The module SHALL add the observations for a task change to the outbox transaction that commits that change, and only for a change of the reported projection of the conversation's latest task: its turn, work, open question and result. A conversation opening, an enable or disable, a read, a spoken reply, startup reconciliation that leaves a task's state unchanged and outbox republication SHALL add no observation. The session's work, attention and outcome SHALL follow the latest task's committed status: a running task works; a task waiting on a clarification or approval needs the owner; a paused task makes no running-work claim; an uncertain task's work is unknown; a succeeded, failed or cancelled task holds one notice with that result, and no finished status SHALL claim success unless the result is `succeeded`. After a task ends, the session SHALL read as a hook session does after its turn ends, and the module SHALL never end the session. A cancelled task's notice SHALL leave no reader with an unread notice; a failed task's SHALL stay unread until acknowledged. A task waiting on delegated work SHALL raise no attention and make no running-work claim. Conversations of every profile SHALL report, titled by the conversation's title, or by the profile's persona name until one exists. The assistant's `read_sessions` tool and coding suggestions SHALL leave native sessions out. The module SHALL publish no conversation text, prompt or answer in an observation. Native worker reporting is out of scope.

#### Scenario: One session across tasks
- **WHEN** a synthetic profile's conversation runs two tasks one after the other
- **THEN** every observation names the conversation's one session and ordering epoch, the first task's observations are on turn T1 and the second's on turn T2, each turn starts once and ends once, and the sequence increases across both

#### Scenario: Answer and resume
- **WHEN** a synthetic task T asks a clarification Q, the owner answers it and a new run starts, and later a paused task is resumed
- **THEN** the session needs the owner with detail `input` on turn T, then Q alone is resolved on turn T and the session works on turn T with no new turn start, and the resumed task works again on its own turn with no new turn start

#### Scenario: One task ends and the next starts in one commit
- **WHEN** the conversation last reported task A waiting on its approval, and one commit records A cancelled and the next task B started
- **THEN** A's `turn-ended` with result `cancelled` is reported before B's `turn-started`

#### Scenario: Outcomes
- **WHEN** synthetic tasks end succeeded, failed and cancelled, one is recovered as paused at a start and one is left uncertain by an unanswered call
- **THEN** their statuses are `finished` with details `succeeded`, `failed` and `cancelled`, `quiet` with detail `interrupted`, and `unknown` with detail `lost`
- **AND** the dashboard names each result, the succeeded and failed tasks show unread, and the cancelled task shows unread to no reader

#### Scenario: Delegation wait
- **WHEN** a synthetic task's approved delegation is handed to a fake coding worker and the task waits for its word
- **THEN** the session is `quiet` with detail `idle` and has no attention item, while the approval before it was attention

#### Scenario: The assistant's own reads
- **WHEN** a running task calls `read_sessions` while a Claude session and the task's own native session are synced
- **THEN** the result lists the Claude session only

#### Scenario: Restart without replay
- **WHEN** the runtime restarts while a task waits on its question, and again while a task's model call is unanswered
- **THEN** the waiting task reports nothing, the other reports itself uncertain once, and no run, speech, dispatch or model call starts

#### Scenario: Tasks saved before this release
- **WHEN** this release first starts with saved tasks, one conversation's latest task ended and another's waiting on the owner's answer
- **THEN** it records each conversation's latest projection and reports nothing for the ended task, and the same start reports the waiting task's turn start, question and wait, so it shows as needing the owner

### Requirement: Shared spend limits

Anthropic SHALL enforce the monthly ceiling through a dedicated Console workspace's $150 monthly spend limit, which the owner sets once at installation; the companions module SHALL pace the spend of every profile's paid model calls together at $20 a day and SHALL keep a local estimate of the month with a $150 guard, by the runtime host's local day and month starting at local midnight. Prices SHALL come from the section's price table, else from a dated built-in table read from Anthropic's price list (2026-11-22: `claude-opus-5-5`, and `claude-haiku-5-5` with its dearer tier for a prompt over 100,000 tokens, counting cache reads and writes), else from the dearest known rate for each price class; a tiered model SHALL be reserved at the tier of its input bound and settled at the tier its reported prompt falls in. In the transaction that saves a paid call's receipt, the module SHALL reserve in its own SQLite ledger the most the call can cost: every input unit at the model's dearest input price and every output unit at its output price, at the model's prices (configured, else built-in, else the dearest known rate). It SHALL refuse the call with the capacity code before dispatch, and record nothing, when that reservation would pass the daily limit or the month's guard, and the conversation SHALL show a message that names the limit. Reported usage priced by class SHALL replace the reservation in the transaction that saves the answer, including an answer that arrives after the call's deadline while the module runs. A call whose usage is never reported SHALL keep counting its reservation, never zero, across restart. A call SHALL count on the day and month it was reserved. A new turn of a paid profile SHALL be refused with the capacity code and a detail naming the limit when what remains of today's limit or of the month's estimate is below the smallest reservation of its first call, 8,192 framing units at the model's dearest input price plus 16,384 output units at its output price; a call already sent SHALL finish. Synthetic calls and coding-worker runs SHALL not be counted. A model call outside a task SHALL record its spend through the same ledger. The module SHALL serve the day's and month's counted amounts, their limits and the count and amount of reservations without reported usage on a private content route without text, call or task identity, together with the paid model, where its prices come from with the built-in table's date, and its smallest call, and the page SHALL read it after each assistant-state revision, show today's spend against the daily limit and the month's figure labelled as an estimate with a line that the Anthropic Console holds the real monthly limit and spend, show where the paid model's prices come from, and show beside the composer why a paid profile's new message would be refused.

#### Scenario: Reservation then reported usage
- **WHEN** a hosted task's model call is in flight and then answers with reported usage
- **THEN** while in flight the day's spend counts the call's reservation as one call without reported usage, and afterwards it counts the reported usage priced by class and no unreported call

#### Scenario: Unreported and late usage
- **WHEN** one hosted call answers without usage and another passes its deadline, answers late with usage, and the runtime restarts
- **THEN** the first keeps counting its reservation, the second counts its late reported usage, and both amounts survive the restart

#### Scenario: Limit reached
- **WHEN** a conversation-level call has brought today's spend to $20.00
- **THEN** a new message to the hosted profile is refused with the capacity code and a detail naming the daily limit, no request is sent, a synthetic profile still starts a task, and after local midnight the day reads zero while the month keeps the amount

#### Scenario: A call already sent finishes
- **WHEN** other spend brings the day near its limit while a hosted call is in flight
- **THEN** that call's answer and its tool result are kept, the next model call is refused before dispatch, the task ends with the capacity code and the conversation names the daily limit

#### Scenario: No configured prices
- **WHEN** the hosted provider's section has no prices and the runtime starts
- **THEN** a hosted turn runs, its reported usage counts at the built-in price of 2026-11-22, a model the table does not know, even one named after an inherited member such as `constructor`, counts at the dearest known rate, and Details names where the prices come from

#### Scenario: Haiku prompt tier
- **WHEN** a `claude-haiku-5-5` call's input bound is 100,000 units and another's is 100,001, and their reported prompts, counting cache reads and writes, are 100,000 and 100,001 tokens
- **THEN** the first is reserved and settled at the lower tier and the second at the higher tier

#### Scenario: Remainder below the smallest call
- **WHEN** today's counted spend leaves one millionth of a dollar less than the smallest first call
- **THEN** a new message to the hosted profile is refused with the capacity code and a detail naming the daily limit, and no task starts

#### Scenario: Day and month boundaries
- **WHEN** a call is reserved at 23:59:59 local time and settles after midnight, and later the month turns over
- **THEN** the call counts on the earlier day and in its month, the new day starts at zero, and the new month starts at zero

### Requirement: Model-written conversation titles

The companions module SHALL give each conversation a title of the form `#<issue> <description>`, or `<repository>#<issue> <description>` for an issue in another repository, or the description alone when no issue appears, written by the profile's title model ([Hub #2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)), and the title SHALL follow the conversation's topic ([Hub #2075](https://github.com/jimmie-potts/agent-device-hub/issues/2075)). The title model SHALL check the title after the admission of a task's first owner message while the conversation has no title, after each task finishes with `succeeded`, `failed` or `cancelled`, and after each major event the module records: an answered approval, approved or declined; a tool call that changed state, that is, a command the core accepted; an accepted coding hand-off; and a coding hand-off's result. No trigger SHALL depend on a count of tasks or on the time since earlier lifecycle evidence. A start of the module SHALL start no check: neither startup reconciliation nor the settlement at start of a coding hand-off left pending at the last stop, which reaches its task as an uncertain result; a hand-off result that arrives after the start SHALL be checked. Each check SHALL start after the commit that recorded its trigger and SHALL NOT fail, delay or roll back a task. A conversation SHALL have at most one title call in flight; the triggers that arrive while a call is in flight SHALL coalesce into one follow-up check that starts when the call settles and carries each distinct event once, oldest first, up to the latest four. Each check SHALL send the fixed title instruction and a prompt of at most 2 KiB with the current title and whether the owner or the title model set it, or that there is none; one fixed-form label for each event the check answers, made of the module's own words with at most a tool identifier, a decision or an outcome word; and the conversation's last eight owner and assistant messages, escaped and cut to fit. A check SHALL send no tool result, dispatch receipt, worker report, preference, knowledge entry or failed turn's closing reply. A coding hand-off's brief SHALL be recognized in both its approval question and its accepted hand-off message. The model SHALL answer `KEEP` when the current title still fits, or a new title; the instruction SHALL tell it that a title the owner set is their choice, to keep unless the topic has clearly changed since. `KEEP`, in any case and with surrounding quotes, emphasis or trailing punctuation, and a new title equal to the current one SHALL publish nothing. The `bunny` profile with the Anthropic provider SHALL use the configured `titleModel`, default `claude-haiku-5-5`, with the same key and transport as its turns. A profile without a real title model, Reachy, MicroDuck and the `bunny` profile on the synthetic provider, SHALL make no title call and keep its persona name; only a test or harness MAY inject the fixed `Synthetic conversation` title provider, and a profile that later gets a real model gets titles by the same rule. The module SHALL keep a new title only after normalization: one line, no surrounding quotes, markdown heading or emphasis, `Title:` label or trailing punctuation, this repository's issues as a bare `#<issue>`, and a description of at most 40 characters cut at a word boundary. An empty or placeholder answer, an answer whose whole normalized form or title, also with the prompt's entity escapes undone, equals any message of the prompt or a coding hand-off's brief (ignoring case, spacing, surrounding quotes and trailing punctuation), an answer whose description after any issue reference, whole or as the title keeps it, shares a run of 6 consecutive words with an owner message or a hand-off brief, an answer long enough to be cut that appears inside another assistant reply, whole or as its whole description after any issue reference, and a title that is not session display text SHALL be refused. The title call record SHALL keep the labels of the events it answered and the model's raw answer, at most 1 KiB, privately; no log, trace, diagnostic or published record SHALL carry the answer. The module SHALL store the title on the conversation with its source, generated or owner, and publish it as the session title: at once in a `lifecycle/2.3` metadata observation while the session may be shown, and on every later lifecycle observation; until a title exists the persona name SHALL stand. A kept, failed, refused, invalid or abandoned check SHALL leave the earlier title or the persona name and SHALL NOT be retried. Each call SHALL be recorded on its conversation, admitted before it is sent and settled with its status, its outcome (applied, unchanged, kept, invalid or dropped) and its reported usage, or unknown usage. A paid call SHALL reserve its most expensive cost in the shared spend ledger as a conversation-level call, in its admission's transaction, and settle it with the reported usage, or keep the reservation counting when none is reported; a call the spend limits refuse SHALL NOT be sent and SHALL be recorded failed with `capacity`; the title model SHALL be priced like any paid model, at its configured price, else its built-in tiers, else the dearest known rate (Hub #2047), and a title call that Anthropic's monthly spend limit refuses SHALL fail with `capacity` without a retry and keep the earlier title or the persona. A title call SHALL count toward the shared spend limits and toward no task's call, unit or time limits.

#### Scenario: First message
- **WHEN** the owner starts the first task of a conversation and a fake title provider answers `"#1896 Session tracking."`, then `KEEP` for the finished task
- **THEN** the module publishes one `lifecycle/2.3` metadata observation with title `#1896 Session tracking` and source `provider`, every later observation carries that title, the task's model calls and reserved units are its own, the first call is recorded with the reported usage and the event `The owner sent a message.`, and the second is recorded kept with the event `A task finished: succeeded.`

#### Scenario: Keep or a new title
- **WHEN** a titled conversation's later tasks finish and the model answers `KEEP`, then a new title once the topic moved
- **THEN** each `KEEP` publishes nothing and the new title is published with source `provider`, its prompt carrying the earlier title as written by the title model and the recent conversation

#### Scenario: Refresh and reappearance
- **WHEN** a titled conversation starts its third task, and later a task after a day without lifecycle evidence, and each task's model call is held
- **THEN** neither start makes a title call, as no task count or time gap is a trigger, and each task's end makes one with the event `A task finished: succeeded.`

#### Scenario: Major events
- **WHEN** the owner approves a Hub mode proposal that the core accepts, and later declines another
- **THEN** checks carry the labels `The owner approved set_mode.`, `A tool call changed state: set_mode was accepted.`, `The owner declined set_mode.` and `A task finished: succeeded.`, no prompt carries the dispatch receipt or the decline's tool result, and every prompt is at most 2 KiB

#### Scenario: Coalescing
- **WHEN** a conversation's first title call is held while two more tasks start and finish, one failing
- **THEN** no second call runs beside the first, and after it settles exactly one follow-up runs with the events `A task finished: succeeded.`, `The owner sent a message.` and `A task finished: failed.`

#### Scenario: Late answer after a newer check
- **WHEN** a title call passes its deadline while a finished task's check waits behind it, the follow-up writes a new title, and the abandoned call's answer arrives later
- **THEN** the abandoned call is recorded uncertain, the follow-up's title is published, the late answer publishes nothing, and nothing is retried

#### Scenario: Failures fall back
- **WHEN** title calls fail with `capacity`, are refused, answer `Title`, answer a credential-shaped text, or reach the deadline
- **THEN** no title is published, every observation keeps the persona name, every task succeeds, and each call is recorded once as failed, invalid or uncertain

#### Scenario: Spend limits
- **WHEN** a check's reservation would pass the daily spend limit or the month's guard, in an untitled conversation and in one whose earlier title call spent the day's limit
- **THEN** nothing is sent, the call is recorded failed with `capacity`, the persona name or the earlier title stands, nothing retries and the task succeeds

#### Scenario: Anthropic spend limit refuses a title call
- **WHEN** Anthropic answers a title call's one request with a documented spend-limit refusal
- **THEN** that request is the only one the check sends and nothing retries, the call is recorded failed with `capacity`, the persona name stands and the task succeeds

#### Scenario: No title model
- **WHEN** the synthetic `bunny` profile, Reachy and MicroDuck each run a task without an injected title provider
- **THEN** no title call is made and every observation carries the persona name; with the fixed synthetic provider injected, the title is `Synthetic conversation`, which contains no conversation text, costs nothing, and the same title again is recorded unchanged

#### Scenario: Coding hand-off
- **WHEN** a task's coding hand-off with a brief naming `#2041` is accepted, and later another is accepted after the owner renamed the conversation
- **THEN** a check labelled `A coding hand-off was accepted.` carries the brief and `#2041 Flaky timer test` is published, and the later hand-off's check is told the title is the owner's and keeps it

#### Scenario: Coding hand-off result
- **WHEN** the coding worker's completed result reaches the task waiting on its hand-off
- **THEN** a check carries the label `A coding hand-off's result arrived: completed.`, and no prompt carries the worker's summary, outcome detail or changed files

#### Scenario: A start starts no check
- **WHEN** the module starts again over a task whose saved graph had finished before its end committed, and over a task whose coding hand-off was pending at the last stop
- **THEN** startup reconciles the first to `succeeded` and settles the second's hand-off as an uncertain result without any title call, and only the resumed task's end is checked

#### Scenario: Echo
- **WHEN** the title model answers with a long owner message, with an excerpt of one, with an assistant message, with a coding hand-off's brief, with an issue reference followed by six or more consecutive words of an owner message or brief that names its issue elsewhere, or with any of these in the prompt's escaped form
- **THEN** no title is kept, and a summary, a reordered or reworded title, a title reusing a reply's topic words, or one sharing fewer than six consecutive words with an owner message is kept

### Requirement: Owner rename of a conversation

The owner SHALL be able to rename a profile's conversation from **Conversation details** through the `rename` action of `assistant-control/2.1`, naming the profile and a title of 1 to 80 characters of session display text. The module SHALL refuse a rename whose title is not display text after its whitespace is collapsed with `invalid-request`. An accepted rename SHALL store the title with source owner, advance the conversation's title generation, publish it at once in a `lifecycle/2.3` metadata observation with source `user` while the session may be shown, and abandon any title call in flight together with the follow-up check waiting behind it. Each admitted title check SHALL also advance the generation. A settled title call whose generation is no longer the conversation's SHALL be dropped. The owner's title SHALL NOT be permanent ([Hub #2075](https://github.com/jimmie-potts/agent-device-hub/issues/2075)): later checks SHALL tell the model that the title is the owner's, and when the model gives a new title instead of `KEEP`, it SHALL replace the owner's with source generated, published as `provider`.

#### Scenario: Rename drops a title in flight
- **WHEN** a title call is in flight, a finished task's check waits behind it, and the owner renames the conversation to `  Kitchen   plans `
- **THEN** the session title becomes `Kitchen plans` with source `user` at once, the call is abandoned and recorded uncertain, its late answer publishes nothing, the waiting check is not sent, and later observations carry the owner's title

#### Scenario: Rename then topic change
- **WHEN** later tasks of the renamed conversation finish, the model answers `KEEP` while the topic stays and a new title once it changes
- **THEN** each check's prompt says the title was set by the owner, `KEEP` leaves `Kitchen plans`, and the new title replaces it with source `provider` on the session and on every later observation

#### Scenario: Compare before write
- **WHEN** a title answer settles after a rename advanced the generation without abandoning the call
- **THEN** the call is recorded as succeeded and dropped, and the owner's title stays

#### Scenario: Bad title
- **WHEN** the owner sends a title of whitespace only, a credential-shaped title or one of 81 characters
- **THEN** the rename is refused, nothing is published, and the earlier title stays

### Requirement: Preview an owner attachment in Conversation

Conversation SHALL accept one supported still or GIF from either a drop on the message field or the keyboard-operated Attach control. It SHALL show the same artwork to preview, replace or remove before the owner confirms a save or display.

#### Scenario: Select, replace or remove an attachment

- **WHEN** the owner selects or drops an image, replaces it, or removes it
- **THEN** Conversation shows the selected media or a visible validation error and issues zero display commands

#### Scenario: Save and display a single upload

- **WHEN** the owner confirms both actions
- **THEN** Conversation reports the library outcome and each selected display outcome independently
- **AND** a definitive failure can be retried without repeating a successful action, while an uncertain outcome stays visible without replay

### Requirement: Resolve exact artwork and display before Conversation approval

Conversation SHALL resolve the requested artwork and configured display identities before offering a display action. It SHALL distinguish a browser composition from the browser destination and a device kind from its routing ID. Each proposed destination SHALL be eligible for the exact artwork and visibly identified. Conversation SHALL explain unavailable choices and require a specific choice among ambiguous matches.

#### Scenario: A display kind matches more than one installation target

- **WHEN** the owner asks for a display by kind and two configured displays could match
- **THEN** Conversation asks which display to use and dispatches nothing before an exact selection and approval

#### Scenario: Generate for the reply and show on a display

- **WHEN** the owner approves generation for a request that also names a configured display, and the exact generated attachment becomes ready
- **THEN** the reply presents that attachment and offers a separate display approval with the intended destination selected, even if another artwork has been created since

#### Scenario: Select a destination for a ready attachment

- **WHEN** the owner opens Show on for a saved attachment
- **THEN** available choices refer to that same artwork, incompatible or unavailable choices identify the reason, and a confirmed show reports preparation and presentation evidence for each chosen destination

#### Scenario: A proposed show is dismissed or interrupted

- **WHEN** the owner declines the proposal, reloads the page or reconnects after an uncertain dispatch
- **THEN** Conversation performs no automatic generation or display write and restores the tracked preparation and presentation evidence for each selected destination, including uncertainty after a lost reply

### Requirement: Closing reply when a turn fails

An admitted turn that settles failed or uncertain SHALL save a single private closing reply explaining the known outcomes of its approved actions and the supported reason the turn stopped. The runtime SHALL use the records of that turn, preserve a provider's existing closing answer, and issue no model call, device command or retry to produce or deliver the fallback. If the cause is unknown, the fallback SHALL say so. Pending questions and paused tasks SHALL retain their controls.

#### Scenario: A failed command follows a successful step

- **WHEN** a turn has saved action evidence and a later approved action is refused, then the model cannot finish the turn
- **THEN** the closing reply describes both outcomes using the strongest recorded evidence, preserves confirmed phases across later reads with missing records, and remains readable after reload

#### Scenario: Recovery finds an uncertain call

- **WHEN** recovery settles a turn with an unresolved receipt and later receives evidence
- **THEN** the saved reply identifies uncertainty, recovery and late evidence produce no second answer or device write, and explicit continuation follows the existing recovery rules

#### Scenario: No diagnosis or proposal

- **WHEN** a read-only task or an answered clarification ends before a proposal or final explanation
- **THEN** the owner sees where the turn stopped, including a specific known limit when available, and the fallback makes no claim about the requested diagnosis

### Requirement: Approved device confirmation in Conversation

Conversation SHALL associate the approved Pixoo brightness request with its original task, turn, owner and target. It SHALL report the strongest correlated evidence available at turn end and recover a pending confirmation through SDK sync without reissuing the write.

#### Scenario: The display reports before the deadline

- **WHEN** the approved display reports fresh brightness for the tracked request within the turn's observation window
- **THEN** the original reply states the percentage the display reported, including a different or already-matching value
- **AND** answering approval clears its attention item and the turn ends once

#### Scenario: The display reports after the turn ends

- **WHEN** the original reply says confirmation is pending and correlated evidence becomes available later
- **THEN** one update appears on the original exchange, including after restart or duplicate delivery
- **AND** the original reply and its notice remain intact

#### Scenario: No reading can confirm the request

- **WHEN** readback is unavailable or only an unrelated reading exists
- **THEN** Conversation preserves any acknowledgment and reports the remaining uncertainty or lack of confirmation

### Requirement: Approved Wemo power confirmation

Conversation SHALL use the configured plug and exact on or off setting in the approval. It SHALL follow the tracked operation and report a fresh power reading in the original reply or once as a later update to that reply.

#### Scenario: Readback arrives after the original reply

- **WHEN** the owner sees a pending reply and the approved plug reports its power later
- **THEN** the original exchange receives one update, including after reconnect or restart
- **AND** no write or turn-end notice is repeated

#### Scenario: The write is uncertain

- **WHEN** the plug's write reply was lost
- **THEN** Conversation describes the uncertainty and hold and does not confirm the requested power from a later ordinary poll

### Requirement: Conversation sessions name their companion

The companions module SHALL name each conversation's companion on every lifecycle observation it reports, as the single entry of `companions` with the profile's ID and persona name, in `lifecycle/2.4` ([Hub #2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054)). Title metadata SHALL stay in `lifecycle/2.3` and SHALL carry no companions, so a generated title or an owner's rename never changes them. The module SHALL never add the companion's name to a title; an untitled conversation keeps its persona name as the title until one exists.

#### Scenario: Each conversation's companion
- **WHEN** a Reachy task and then a B.U.N.N.Y. task run in their conversations
- **THEN** every observation of the first names `reachy` with name `Reachy`, every observation of the second names `bunny` with name `B.U.N.N.Y.`, and all are `lifecycle/2.4`

#### Scenario: A titled conversation
- **WHEN** a conversation has a generated title and then the owner's title
- **THEN** its observations carry that title unchanged and the same companion, and its title metadata is `lifecycle/2.3` without companions

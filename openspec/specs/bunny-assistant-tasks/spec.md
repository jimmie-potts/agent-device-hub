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

The system SHALL admit at most one unfinished task and one graph invocation per conversation, with no execution queue; a conversation's queued messages are the owner's saved messages, each started as a new task only as "Conversation message queue" specifies ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)). A task in one conversation SHALL NOT block a start, answer, resume or cancel in another, and the running slot SHALL be keyed by conversation, not by a fixed list of profiles; each conversation belongs to one profile today. A start in a conversation whose own task is unfinished SHALL be refused with the capacity code. A command for a conversation, a start, answer, approval, resume, cancel, Read aloud or rename, SHALL be refused as a revision conflict only when its own conversation changed after the assistant revision it names, or when it names a revision the assistant has not reached; enable and disable SHALL keep the assistant-wide revision, and a queue command SHALL be checked against its conversation's queue revision instead. A rename, and a correction or removal of one of its messages, SHALL count as a change of its conversation, and each start SHALL count every saved conversation, a companion exchange without a profile included, as changed at the assistant's current revision. Every conversation's graph SHALL run on the module's one SDK-owned SQLite connection with no transaction across an await, its own checkpoint thread and its own cancellation fence. A turn is one task: one owner message and everything it causes. Each task SHALL retain limits of 50 model calls, 40 tool calls, 10 questions, 40 minutes active time and 1,000,000 usage units; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Before each model call the task SHALL reserve the request's UTF-8 bytes plus 8,192 framing units and 16,384 output units. Model/tool deadlines SHALL be six minutes and 30 seconds, and control admission five seconds. An owner message SHALL be bounded at 32 KiB, a tool result at 8 KiB, a model reply with its provider blocks at 16 KiB, the working transcript at 1 MiB, staged input at 193 KiB and each serialized checkpoint or set of pending writes at 256 KiB. A call that would pass a limit SHALL be refused before dispatch, and the task SHALL end with the capacity code and a conversation message that names the limit. Reservations SHALL precede dispatch and survive restart; resume SHALL never replenish a turn's budget; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

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

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file, and MAY name `assistant.prices` with the input, output, five-minute cache write and cache read prices of each model in US dollars per million tokens, which override the built-in table; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret, with a malformed price table or with an unsupported provider. A section without prices SHALL start the module and run with daily pacing at the built-in prices. A 400 `invalid_request_error` whose message starts with "You have reached your specified API usage limits" or "You have reached your specified workspace API usage limits", or a 429 `rate_limit_error` whose `error.details.error_code` is `enforced_spend_limit_reached`, SHALL end the task with the capacity code and a conversation message naming the monthly spend limit at Anthropic, with nothing more sent for that turn and no retry; no other 400 or 429 SHALL be read as a spend limit. By default, every profile, `bunny`, `reachy` and `microduck`, SHALL use the configured provider and model ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)) with the same effort, key, prices, per-turn limits, prompt caching and shared spend limits; without a provider, or with `assistant.provider` `synthetic`, every profile SHALL use the labelled synthetic provider. The section SHALL have no per-profile provider or model, and only a test or harness MAY give one profile another provider. The prompt SHALL contain the task inputs permitted by "Field grants at each Conversation destination" and "Common external-model Conversation context". Local synthetic context SHALL continue to use the sectioned context builder. The stable sections and the local synthetic recent section SHALL keep their own byte budgets and state what they left out. Hosted Conversation history SHALL use the model token allowance defined in "Common external-model Conversation context". A provider refusal, unavailability, rate limit or malformed answer in the ordinary task turn SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Each Anthropic request SHALL ask for automatic prompt caching with one top-level `cache_control` of type `ephemeral`, with the tools, the system prompt and the replayed transcript first and byte-stable between a task's calls, and the system prompt SHALL place the context sections in their fixed order, stable ones first and the recent conversation and the Hub mode last, as two text blocks: the instructions, the personality, the fixed rules, the knowledge notes, the preferences and the memory slot in the first, which carries its own `cache_control` breakpoint of type `ephemeral`, and the recent conversation and the Hub mode in the second, so a later task's request keeps the earlier one's tools and first system block byte-identical and can read them from the cache, and SHALL report usage by class: uncached input, output, cache writes and cache reads; a report without input or output counts, or with a count that is not a whole number, SHALL be unreported. Public state SHALL carry the provider, model and allowed tool names.

#### Scenario: Synthetic default
- **WHEN** the module starts with an empty companions section or with one that names no provider
- **THEN** public state shows the synthetic provider, no outbound request is made, and a task completes through the same question, tool and approval path

#### Scenario: Configured hosted provider
- **WHEN** the section names the Anthropic provider, its model and its key secret
- **THEN** a `bunny` task sends one request per model call to the Messages API with that model, the fixed instructions, the prompt context, the transcript and the permitted tools; usage tokens are recorded on the call; and the key appears in no record, state, log or page

#### Scenario: Reachy and MicroDuck on the configured model
- **WHEN** a section that names only the Anthropic provider, one model and its key is in force and the owner starts a Reachy task and a MicroDuck task
- **THEN** each sends its requests to that model with its own curated persona in the prompt context and one top-level `cache_control` of type `ephemeral`, without the synthetic fixture tool, and each turn and title check is reserved and counted in the shared spend ledger at that model's prices
- **AND** at a reached daily limit or monthly guard a new Reachy or MicroDuck message is refused with `capacity` naming the limit, as a `bunny` message is

#### Scenario: Explicit synthetic provider
- **WHEN** the section names `assistant.provider` `synthetic`
- **THEN** B.U.N.N.Y., Reachy and MicroDuck each run the synthetic script, nothing is sent and nothing is counted in the spend ledger

#### Scenario: Full tool catalog on the hosted provider
- **WHEN** a Conversation turn offers tools to Claude
- **THEN** one Messages request includes every permitted tool and its closed input schema without requesting strict grammar compilation
- **AND** the Hub refuses unoffered tools and validates offered tool arguments against their closed schemas before approval or execution

#### Scenario: Persona and active preferences enter the prompt
- **WHEN** the owner has active and inactive explicit preferences and an active knowledge note and starts a `bunny` task, then edits a preference and stops using another before the next model call
- **THEN** the first call's prompt carries the `bunny` persona and only the then-active preferences by title and text, the next call reflects the edit and omits the stopped entry, the knowledge section is off and carries no note, the task's own message is its transcript and not its context, and the prompt text reaches no public state, outcome, log or span

#### Scenario: Prompt context over its bound
- **WHEN** the owner's active preferences render larger than the preferences section's 32 KiB budget
- **THEN** the model call is sent with the preferences that fit, in order, and a line stating how many more were left out to fit the budget, and the task continues

#### Scenario: Stable prefix across tasks
- **WHEN** two hosted tasks of one conversation are sent, the second after more messages were saved
- **THEN** both system prompts carry the personality, the fixed rules, the knowledge notes and the preferences in that order before the recent conversation and the Hub mode, the first system block of each, which ends after the stable sections and carries the explicit breakpoint, is byte-identical with the same tools before it, and only the second block differs

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

The companions module SHALL discover the tools a turn may call from its own static catalog and filter them by the private section's allowlist, checking membership again when a call executes, so a changed section cannot widen an effect. The built-in owner question is always available; the synthetic fixture read exists only for the synthetic provider. The device tools SHALL use admitted LIFX device records and the registered power and brightness commands. `read_sessions` SHALL read each session through the contracts package's shared session read function and report its shared status class and detail. All three profiles SHALL offer the same configured tools with the same execution checks ([Hub #2106](https://github.com/jimmie-potts/agent-device-hub/issues/2106)). The dashboard SHALL show allowed and unavailable tools for the open profile. Tool availability SHALL grant no access to fields at an ungranted destination. `delegate_coding` SHALL propose handing one bounded coding task, named by an allowlisted repository and a brief, to the coding worker; without a connected worker, or with an unusable repository name or brief, the call SHALL be refused as a tool result and nothing proposed.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, status class and detail, work confirmation and attention from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

#### Scenario: Delegation without a worker
- **WHEN** the model calls `delegate_coding` while no coding worker endpoint is available
- **THEN** the call ends as a tool result saying no worker is connected, no proposal is made and the owner is not asked

#### Scenario: Companion tool scope
- **WHEN** the allowlist names `read_sessions`, a device tool and a catalog tool, and Reachy, MicroDuck and B.U.N.N.Y. each run a turn on the configured model
- **THEN** all three companions' turns offer the listed tools and Details shows the same list

### Requirement: Owner approval of proposed commands

Coding hand-offs and paid generation SHALL use the owner approval interrupt. Approval SHALL bind the exact target, settings and applicable revision. The coding endpoint revision SHALL move when an endpoint is selected, disabled or lost. Running or completing work SHALL retain that revision. A delegation SHALL be proposed while a coding worker is connected, even when the asking companion's slot is busy. The owner SHALL answer an approval only with the literal decisions approve or decline. An approved command SHALL be dispatched once through the core's tracked dispatcher; a dispatch whose bound revision has moved SHALL be refused and reported to the model as refused; a decline SHALL send nothing and say so. An approved coding delegation SHALL record a background job and return its stable Hub job ID. Only a delegation checkpoint saved by an earlier version MAY resume through the worker-result interrupt.

#### Scenario: Approved mode change
- **WHEN** the authorized owner explicitly asks for a specific mode and the bound Hub revision still matches
- **THEN** one tracked operation carries the bound revision and the turn presents its actual result without an approval question

#### Scenario: Declined or stale proposal
- **WHEN** the owner declines, or approves after the coding worker's endpoint changed
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

### Requirement: Core admission of assistant commands

The core SHALL answer an `assistant-dispatch` command only from `bunny/modules/companions`, forward only an allowlisted family and target to its tracked dispatcher as one operation requested by that module, and refuse any other source, family or target before anything is recorded. The operation SHALL follow the dispatcher's ordinary reply, outcome, inbox and history rules.

#### Scenario: Forwarded mode-set
- **WHEN** the companions module dispatches an owner-requested `mode-set` for the Hub
- **THEN** the core records one tracked operation requested by the module, the mode owner answers it, and its outcome reaches history and the inbox like an operator's command

#### Scenario: Refused dispatch
- **WHEN** another source sends `assistant-dispatch`, or the module names a family or target outside the core's allowlist
- **THEN** the core refuses with `forbidden` for another source, or `invalid-message` for a family, target or value its closed schema rejects, records no operation and sends nothing

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

### Requirement: Viewport-filling Conversation workspace

The Conversation page SHALL use remaining viewport height for the transcript and keep the composer in view when the controls fit. The page SHALL show one header row with the open profile's name and Details, with no Demo label for any profile ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)); the page's own title SHALL remain its heading without being drawn. The transcript's reading column and the composer SHALL share one measure of at most 920px. The chat profiles SHALL be chosen in the dashboard's rail, which names each profile before selection, and the page SHALL carry no profile list or selector of its own. The page SHALL retain the Hub navigation, and the other companion pages SHALL be reached from the Devices menu.

#### Scenario: Read and compose in the available viewport
- **WHEN** the owner opens an empty or short conversation on desktop or a narrow phone viewport
- **THEN** the open profile's name, the transcript and the composer fit without scrolling the document, and additional viewport height increases the transcript height
- **AND** a long decision or constrained viewport still allows scrolling to read its full text and reach every action

#### Scenario: Browse profiles and companion pages
- **WHEN** the owner inspects the conversations in the rail and chooses one, or opens the Devices menu
- **THEN** each profile is named before selection with no Demo label, the header row names the chosen profile with none, and the device-management links remain distinct from the chat choices
- **AND** the Devices menu lists the other companion pages and marks the open page
- **AND** switching to Reachy or MicroDuck while another profile has unfinished work shows that profile's separate history and lets the owner start its own task

#### Scenario: Resize or open local navigation while reading
- **WHEN** the owner resizes the viewport, chooses another profile in the rail or opens and closes the Devices menu without leaving Conversation
- **THEN** the mounted conversation keeps each profile's draft and sends no command or additional speech endpoint registration
- **AND** resizing and the Devices menu keep the reading position

### Requirement: Spoken replies to typed requests

When a task turn ends with a result, a question for the owner or a refusal, the companions module SHALL offer that saved message once to its speech coordinator, after the message is durable, under the message's own identity. A `speak` control naming a task and a saved assistant message SHALL offer that message again under the request's identity; it SHALL refuse owner or tool text and an unknown message, SHALL work for finished tasks, and SHALL be idempotent per request. A message longer than 512 characters SHALL stay written only. Startup reconciliation SHALL offer nothing, and a failed offer SHALL NOT change the task's outcome. The spoken voice SHALL be the installation's qualified local voice regardless of the model provider, and stopping speech SHALL NOT answer a question or cancel the task. A profile whose persona audio is quacks only, MicroDuck, SHALL have its English text kept as its intended meaning and never spoken ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)): its turn-ending messages SHALL NOT be offered, a `speak` control naming one of its messages SHALL be refused with `invalid-request` and fixed text that names no profile, and the page SHALL show that its text is intended meaning in place of Read aloud. The engine and the page SHALL read this rule from the persona's audio, never from a profile name, and SHALL treat an unknown profile as not spoken. The Spoken replies panel SHALL say that B.U.N.N.Y.'s and Reachy's replies are spoken and MicroDuck's never are.

#### Scenario: Turn-ending messages are spoken once
- **WHEN** spoken replies are enabled and a typed request produces a question, then an answer produces a result
- **THEN** the question and the result are each spoken once through the reserved endpoint with the saved text, and a restart between them speaks nothing

#### Scenario: Speak replays a saved answer
- **WHEN** the owner activates Read aloud beside a saved assistant message
- **THEN** one accepted control receipt is recorded, the message is spoken again as its own utterance, a repeated request id speaks nothing more, and a direct speak request for owner text or an unknown message is refused

#### Scenario: Stop without cancellation
- **WHEN** the owner stops speech while a question is being spoken
- **THEN** the audio stops, the task stays waiting for its answer, and Quiet mode keeps the next reply written only

#### Scenario: MicroDuck is never spoken in English
- **WHEN** spoken replies are enabled and a MicroDuck task ends with a result, then the owner asks to hear that message, and a Reachy task ends with the same text
- **THEN** MicroDuck's message stays written with the intended-meaning note and nothing is offered to the voice, the `speak` request is refused with `invalid-request`, and Reachy's message is offered once and can be replayed

### Requirement: Registered safe diagnostics

Assistant run/model/tool spans and decision records SHALL use the SDK diagnostic contract and registered identifiers. Spans SHALL finish at human waits and shutdown; subsequent runs SHALL link prior context. Logs SHALL contain only fixed codes, identifiers and bounded numeric evidence. A failed diagnostic sink SHALL not change execution outcomes.

#### Scenario: Correlated private task
- **WHEN** a synthetic request starts a run and a model/tool call
- **THEN** registered records correlate request, task, run and logical effect without prompts, tool bodies, credentials or exception text

### Requirement: Conversation controls configured LIFX lights

Conversation SHALL expose authorized LIFX status, power, and brightness based on the admitted owner's current device records. It SHALL ask the owner to disambiguate matching labels before sending a write. Reads report observed values with evidence time and identify unknown or unavailable evidence. A reading older than the LIFX refresh interval, dated in the future, or superseded by a newer transmission SHALL be reported as stale.

#### Scenario: Status from the configured owner
- **WHEN** the owner asks about a configured LIFX light
- **THEN** Conversation names the light and reports the observed power and brightness or explains that the evidence is unavailable

#### Scenario: Exact target and guarded effect
- **WHEN** the owner explicitly requests a specific power or brightness setting
- **THEN** one tracked command targets the selected eligible bulb with the saved guards, and Conversation reports the operation without claiming a physical effect from acceptance

#### Scenario: Approval can no longer execute
- **WHEN** the target becomes unavailable before owner admission, permission is removed, or the saved guards become stale
- **THEN** the request cannot cause a device write and Conversation reports the refusal

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

### Requirement: Wemo maximum-on limits in Conversation

The named Wemo reads SHALL report the core's current maximum-on limit for
the selected plug. They SHALL distinguish a missing limit in a synced copy
from an unknown limit while the copy is unavailable. They SHALL describe
the configured duration, enabled state, recorded status, and last attempt
outcome when present. Enforcement SHALL be described as dependent on the
Hub running and the plug being reachable. The reads SHALL send no device
or automation command.

#### Scenario: A running maximum-on limit

- **WHEN** either device read selects a Wemo plug with an armed limit whose deadline is in the future
- **THEN** it reports the start and deadline in the runtime's local time and as ISO instants, and computes the remaining duration from the clock at the read

#### Scenario: The limit is not running

- **WHEN** the selected plug has no limit, or the recorded status is disabled, unavailable, off, elapsed-unknown, due, attempted, or blocked
- **THEN** the read explains the applicable state without claiming time remaining or a confirmed off effect from an attempt receipt

#### Scenario: A deadline passed before the core updated its record

- **WHEN** the copied record is armed but its deadline has arrived
- **THEN** the read preserves the recorded status and says the deadline is already due without a positive countdown

#### Scenario: The copy is recovering

- **WHEN** the core's copy is unavailable or a replacement sync is in progress
- **THEN** the read says the limit is unknown until SDK sync restores the copy

### Requirement: Tracked owner approval across device integrations

Conversation SHALL resolve one exact action on a selected device or explicit set of recipients. Admission SHALL bind the owner, target, effect, and the domain revision, generation or exact immutable library version required at admission. The SDK and core dispatcher SHALL carry the existing typed commands to their respective owners. The original owner input and request identity SHALL persist across failures. A lost reply SHALL remain uncertain without an automatic resend. Multi-target actions SHALL present each target's effect evidence independently.

#### Scenario: Wemo respects its device policy

- **WHEN** the owner explicitly requests power on or off for an eligible Wemo plug identified by name
- **THEN** the existing Wemo command runs through that plug's queue with its hold and revision checks
- **AND** the original continuous run and maximum-on policy remain effective

#### Scenario: A saved artwork is presented

- **WHEN** the owner requests the saved artwork on exact display recipients
- **THEN** the existing art-show path prepares and presents it and Conversation exposes each display's tracked result, including skipped or uncertain effects

#### Scenario: Availability or approval changes

- **WHEN** a held target, revoked permission, stale revision, or changed generation invalidates a resolved write
- **THEN** the refusal is visible without starting a device effect

### Requirement: Light-show authoring and playback in Conversation

Conversation SHALL let the owner create a deterministic draft, edit its cues, and preview a storyboard through the existing authoring rules. Draft and preview operations SHALL send no lighting command. Saving SHALL use the existing guarded catalog operation and retain prior versions. Playing SHALL require an explicit request for the exact saved version and eligible light. Stopping SHALL require an explicit request for the active generation and preserve the owner's restoration behavior. [#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) owns AI-generated drafts.

#### Scenario: Create, edit, preview and save

- **WHEN** the owner creates a draft, specifies a cue edit, previews it and explicitly saves
- **THEN** the storyboard shows the edited cue and the explicit save creates one independently selectable version
- **AND** no lighting command was sent

#### Scenario: Play a saved version and stop it

- **WHEN** the owner requests a saved show version on an eligible light and later requests Stop
- **THEN** the existing playback owner runs that immutable version on the selected light and stops the selected generation

#### Scenario: Unsaved or stale selection

- **WHEN** the owner requests playback of an unsaved draft or a request no longer matches the selected light, saved version or generation
- **THEN** Conversation reports the refusal and no playback starts from that request

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

Anthropic SHALL enforce the monthly ceiling through a dedicated Console workspace's monthly spend limit, whose amount the owner chooses and sets once at installation; the companions module SHALL pace the spend of every profile's paid model calls together at $20 a day and SHALL keep a local estimate of the month with a guard, by the runtime host's local day and month starting at local midnight. The guard SHALL be $150 unless the section's optional `assistant.monthlyLimit` sets it in US dollars, a number from 0.01 to 10000, to match the owner's Console limit ([Hub #2102](https://github.com/jimmie-potts/agent-device-hub/issues/2102)); any other value SHALL refuse the section with the invalid-request code and a detail naming `assistant.monthlyLimit` and its range, and the synthetic provider SHALL take no monthly limit. The month's total, its refusals and the page SHALL use the configured guard, and the daily limit SHALL stay $20. Prices SHALL come from the section's price table, else from a dated built-in table read from Anthropic's price list (2026-11-22: `claude-opus-5-5`, and `claude-haiku-5-5` with its dearer tier for a prompt over 100,000 tokens, counting cache reads and writes), else from the dearest known rate for each price class; a tiered model SHALL be reserved at the tier of its input bound and settled at the tier its reported prompt falls in. In the transaction that saves a paid call's receipt, the module SHALL reserve in its own SQLite ledger the most the call can cost: every input unit at the model's dearest input price and every output unit at its output price, at the model's prices (configured, else built-in, else the dearest known rate). It SHALL refuse the call with the capacity code before dispatch, and record nothing, when that reservation would pass the daily limit or the month's guard, and the conversation SHALL show a message that names the limit. Reported usage priced by class SHALL replace the reservation in the transaction that saves the answer, including an answer that arrives after the call's deadline while the module runs. A call whose usage is never reported SHALL keep counting its reservation, never zero, across restart. A call SHALL count on the day and month it was reserved. A new turn of a paid profile SHALL be refused with the capacity code and a detail naming the limit when what remains of today's limit or of the month's estimate is below the smallest reservation of its first call, 8,192 framing units at the model's dearest input price plus 16,384 output units at its output price; a call already sent SHALL finish. Synthetic calls and coding-worker runs SHALL not be counted. A model call outside a task SHALL record its spend through the same ledger. The module SHALL serve the day's and month's counted amounts, their limits and the count and amount of reservations without reported usage on a private content route without text, call or task identity, together with the paid model, where its prices come from with the built-in table's date, and its smallest call, and the page SHALL read it after each assistant-state revision, show today's spend against the daily limit and the month's figure labelled as an estimate with a line that the Anthropic Console holds the real monthly limit and spend, show where the paid model's prices come from, and show beside the composer why a paid profile's new message would be refused.

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

#### Scenario: Configured monthly guard
- **WHEN** the hosted provider's section sets `assistant.monthlyLimit` to 200 and this month's counted spend on earlier days is $150, and later $200
- **THEN** the spend route and Details name a $200.00 monthly guard and the $20.00 daily limit, a new message at $150 is admitted and runs, and at $200 a new message is refused with the capacity code and a detail naming the $200.00 guard, and no request is sent

#### Scenario: Default and invalid monthly guard
- **WHEN** the section sets no monthly limit, or sets one of 0, 0.009, 10000.01, a string, null or an object
- **THEN** without one the guard is $150.00 and a month counted at $150 refuses a new message naming it, and each invalid value refuses the section with the invalid-request code and the detail naming `assistant.monthlyLimit` and its range from 0.01 to 10000

### Requirement: Model-written conversation titles

The companions module SHALL give each conversation a title of the form `#<issue> <description>`, or `<repository>#<issue> <description>` for an issue in another repository, or the description alone when no issue appears, written by the profile's title model ([Hub #2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)), and the title SHALL follow the conversation's topic ([Hub #2075](https://github.com/jimmie-potts/agent-device-hub/issues/2075)). The Anthropic title model SHALL check the title after the admission of a task's first owner message while the conversation has no title, after each task finishes with `succeeded`, `failed` or `cancelled`, and after each major event the module records: an answered approval, approved or declined; a tool call that changed state, that is, a command the core accepted; an accepted coding hand-off; and a coding hand-off's result. No trigger SHALL depend on a count of tasks or on the time since earlier lifecycle evidence. A start of the module SHALL start no check: neither startup reconciliation nor the settlement at start of a coding hand-off left pending at the last stop, which reaches its task as an uncertain result; a hand-off result that arrives after the start SHALL be checked. Each check SHALL start after the commit that recorded its trigger and SHALL NOT fail, delay or roll back a task. A conversation SHALL have at most one title call in flight; the triggers that arrive while a call is in flight SHALL coalesce into one follow-up check that starts when the call settles and carries each distinct event once, oldest first, up to the latest four. Each hosted check SHALL apply the common title purpose, select the minimum permitted current request and same-conversation excerpts needed for the title, and recheck those fields before submission. The title purpose SHALL exclude device facts and history. Each eligible hosted check SHALL send the fixed title instruction and a prompt of at most 2 KiB with one fixed-form label for each event the check answers and permitted excerpts of owner messages, escaped and cut to fit. The model SHALL receive neither a previously generated or owner-set title nor derived assistant or coding text under the retained-excerpt grant. A check SHALL send no tool result, dispatch receipt, worker report, preference, knowledge entry or failed turn's closing reply. The model SHALL answer `KEEP` when the current title still fits, or a new title; the instruction SHALL tell it that a title the owner set is their choice, to keep unless the topic has clearly changed since. `KEEP`, in any case and with surrounding quotes, emphasis or trailing punctuation, and a new title equal to the current one SHALL publish nothing. Every profile with the Anthropic provider, `bunny`, `reachy` and `microduck` alike ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)), SHALL use the configured `titleModel`, default `claude-haiku-5-5`, with the same key and transport as its turns, by these same rules. On the synthetic provider no profile has a real title model: each SHALL make no title call and keep its persona name; only a test or harness MAY inject the fixed `Synthetic conversation` title provider. The module SHALL keep a new title only after normalization: one line, no surrounding quotes, markdown heading or emphasis, `Title:` label or trailing punctuation, this repository's issues as a bare `#<issue>`, and a description of at most 40 characters cut at a word boundary. An empty or placeholder answer, an answer whose whole normalized form or title, also with the prompt's entity escapes undone, equals any message of the prompt or a coding hand-off's brief (ignoring case, spacing, surrounding quotes and trailing punctuation), an answer whose description after any issue reference, whole or as the title keeps it, shares a run of 6 consecutive words with an owner message or a hand-off brief, an answer long enough to be cut that appears inside another assistant reply, whole or as its whole description after any issue reference, and a title that is not session display text SHALL be refused. The title call record SHALL keep the labels of the events it answered and the model's raw answer, at most 1 KiB, privately; no log, trace, diagnostic or published record SHALL carry the answer. The module SHALL store the title on the conversation with its source, generated or owner, and publish it as the session title: at once in a `lifecycle/2.3` metadata observation while the session may be shown, and on every later lifecycle observation; until a title exists the persona name SHALL stand. A kept, failed, refused, invalid or abandoned check SHALL leave the earlier title or the persona name and SHALL NOT be retried. Each call SHALL be recorded on its conversation, admitted before it is sent and settled with its status, its outcome (applied, unchanged, kept, invalid or dropped) and its reported usage, or unknown usage. A paid call SHALL reserve its most expensive cost in the shared spend ledger as a conversation-level call, in its admission's transaction, and settle it with the reported usage, or keep the reservation counting when none is reported; a call the spend limits refuse SHALL NOT be sent and SHALL be recorded failed with `capacity`; the title model SHALL be priced like any paid model, at its configured price, else its built-in tiers, else the dearest known rate (Hub #2047), and a title call that Anthropic's monthly spend limit refuses SHALL fail with `capacity` without a retry and keep the earlier title or the persona. A title call SHALL count toward the shared spend limits and toward no task's call, unit or time limits.

#### Scenario: First message
- **WHEN** the owner starts the first task of a conversation and a fake title provider answers `"#1896 Session tracking."`, then `KEEP` for the finished task
- **THEN** the module publishes one `lifecycle/2.3` metadata observation with title `#1896 Session tracking` and source `provider`, every later observation carries that title, the task's model calls and reserved units are its own, the first call is recorded with the reported usage and the event `The owner sent a message.`, and the second is recorded kept with the event `A task finished: succeeded.`

#### Scenario: Keep or a new title
- **WHEN** a titled conversation's later tasks finish and the model answers `KEEP`, then a new title once the topic moved
- **THEN** each `KEEP` publishes nothing and the new title is published with source `provider`, with only the permitted current request and recent owner excerpts in the hosted prompt

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

#### Scenario: Companions on the configured title model
- **WHEN** Reachy and MicroDuck each run a task on the Anthropic provider, and a later MicroDuck task changes the topic
- **THEN** each conversation is checked after its first message and after each finished task, gets its own title, and MicroDuck's title follows the new topic
- **AND** each check is a conversation-level call reserved and counted in the shared spend ledger at the title model's price

#### Scenario: No title model
- **WHEN** B.U.N.N.Y., Reachy and MicroDuck each run a task on the synthetic provider without an injected title provider
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

Conversation SHALL resolve the requested artwork and configured display identities before executing a display action. It SHALL distinguish a browser composition from the browser destination and a device kind from its routing ID. Each destination SHALL be eligible for the exact artwork and visibly identified. Conversation SHALL explain unavailable choices and require a specific choice among ambiguous matches.

#### Scenario: A display kind matches more than one installation target

- **WHEN** the owner asks for a display by kind and two configured displays could match
- **THEN** Conversation asks which display to use and dispatches nothing before an exact selection

#### Scenario: Generate for the reply and show on a display

- **WHEN** the owner approves generation for a request that also names a configured display, and the exact generated attachment becomes ready
- **THEN** the reply presents that attachment and offers the Show on control with the intended destination selected, even if another artwork has been created since

#### Scenario: Select a destination for a ready attachment

- **WHEN** the owner opens Show on for a saved attachment
- **THEN** available choices refer to that same artwork, incompatible or unavailable choices identify the reason, and a confirmed show reports preparation and presentation evidence for each chosen destination

#### Scenario: A proposed show is dismissed or interrupted

- **WHEN** the owner dismisses the display choice, reloads the page or reconnects after an uncertain dispatch
- **THEN** Conversation performs no automatic generation or display write and restores the tracked preparation and presentation evidence for each selected destination, including uncertainty after a lost reply

### Requirement: Closing reply when a turn fails

An admitted turn that settles failed or uncertain SHALL save a single private closing reply explaining the known outcomes of its recorded actions and the supported reason the turn stopped. The runtime SHALL use the records of that turn, preserve a provider's existing closing answer, and issue no model call, device command or retry to produce or deliver the fallback. If the cause is unknown, the fallback SHALL say so. Pending questions and paused tasks SHALL retain their controls.

#### Scenario: A failed command follows a successful step

- **WHEN** a turn has saved action evidence and a later requested action is refused, then the model cannot finish the turn
- **THEN** the closing reply describes both outcomes using the strongest recorded evidence, preserves confirmed phases across later reads with missing records, and remains readable after reload

#### Scenario: Recovery finds an uncertain call

- **WHEN** recovery settles a turn with an unresolved receipt and later receives evidence
- **THEN** the saved reply identifies uncertainty, recovery and late evidence produce no second answer or device write, and explicit continuation follows the existing recovery rules

#### Scenario: No diagnosis or proposal

- **WHEN** a read-only task or an answered clarification ends before a proposal or final explanation
- **THEN** the owner sees where the turn stopped, including a specific known limit when available, and the fallback makes no claim about the requested diagnosis

### Requirement: Approved device confirmation in Conversation

Conversation SHALL associate the Pixoo brightness request with its original task, turn, owner and target. It SHALL report the strongest correlated evidence available at turn end and recover a pending confirmation through SDK sync without reissuing the write.

#### Scenario: The display reports before the deadline

- **WHEN** the selected display reports fresh brightness for the tracked request within the turn's observation window
- **THEN** the original reply states the percentage the display reported, including a different or already-matching value
- **AND** the turn ends once and any resolved clarification clears its attention item

#### Scenario: The display reports after the turn ends

- **WHEN** the original reply says confirmation is pending and correlated evidence becomes available later
- **THEN** one update appears on the original exchange, including after restart or duplicate delivery
- **AND** the original reply and its notice remain intact

#### Scenario: No reading can confirm the request

- **WHEN** readback is unavailable or only an unrelated reading exists
- **THEN** Conversation preserves any acknowledgment and reports the remaining uncertainty or lack of confirmation

### Requirement: Approved Wemo power confirmation

Conversation SHALL use the configured plug and exact on or off setting in the request. It SHALL follow the tracked operation and report a fresh power reading in the original reply or once as a later update to that reply.

#### Scenario: Readback arrives after the original reply

- **WHEN** the owner sees a pending reply and the selected plug reports its power later
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

### Requirement: Sectioned companion context

One context builder SHALL assemble the local synthetic prompt context and the allowed section contents for external models for the task's companion as named sections in a fixed order, each with its own budget in UTF-8 bytes of its rendered text ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)): personality, the curated persona (4 KiB); knowledge, the owner's active knowledge notes by title and text (32 KiB), off until the owner turns it on for that companion; preferences, the owner's active explicit preferences by title and text (32 KiB); memory, a long-term memory slot that holds nothing yet (16 KiB); and recent, the conversation history (48 KiB and at most 48 messages for the synthetic provider, a portion of the model token budget for a hosted supervisor). The stable sections SHALL come first and the recent conversation last. For the synthetic provider, the recent conversation SHALL hold only the task's own conversation's saved owner messages, companion replies and tool results, such as device reads, worker reports and refusals, up to the last message saved when the task started, oldest first, so it stays the same for all of the task's calls; a later message waits for the next task. Each line SHALL name the saved message's identity, its speaker or tool and an artwork attachment's request identity and description. It SHALL NOT hold another conversation, another companion's messages, a companion exchange, a removed message, a message the profile may not read in that conversation, as the history page reads them, or an imported message, which stays historical until the owner selects it for a copied context. When the owner removes an owner message of a task, its opening message or an answer, that task's tool results SHALL leave the recent section too, while its reply stays until the owner removes it (coordinator decision, 2026-11-24). A correction's meaning SHALL be the saved text. A task saved before this boundary existed SHALL have an empty recent section. A byte-bounded section over its budget SHALL keep what fits, the synthetic recent section its newest messages and the others their first entries, and SHALL state in its text how many items it left out. The synthetic recent section SHALL count in that statement the messages beyond its 48-message bound. The section texts SHALL frame their content as data that grants no tool, permission, approval or device authority, and the recent section SHALL tell the model to check current state with a tool before proposing a change and to ask the owner when a reference could mean more than one thing. The common external-model policy SHALL apply before a hosted supervisor receives input from these sections. A follow-up that names a subject from recent context SHALL still pass every current capability, guard and approval check of the proposal it leads to. Each companion SHALL have a saved knowledge switch, off until the owner turns it on with a knowledge command checked by its own revision scope. An authorized reader SHALL be able to read the context preview, `assistant-context`, for a profile: the builder's own sections, for the next model call, either the next call of the current conversation's unfinished task or that of a new message's task, with each section's budget, state, counts of items sent and left out, bytes and text; the read SHALL change nothing. `read_saved_art` SHALL name each listed artwork's source request, so an attachment's request identity leads to its artwork.

#### Scenario: Follow-up sees the earlier exchange
- **WHEN** on the synthetic provider, the owner asks a question whose task reads a tool and replies, then sends a follow-up
- **THEN** the follow-up's first call carries the first task's message, tool result with its tool name and reply, each with its saved message identity, and not its own message, which is its transcript

#### Scenario: The section is fixed when the task starts
- **WHEN** on the synthetic provider, a message is saved in the conversation while a task waits on its question, and the owner then removes an earlier message
- **THEN** the task's next call carries the same recent section as its first, and the next task carries the later message and not the removed one

#### Scenario: No other companion's conversation
- **WHEN** B.U.N.N.Y.'s earlier and current conversations, a synthetic Reachy and MicroDuck exchange and Reachy's conversation all hold messages saved before each checked call's boundary
- **THEN** Reachy's follow-up carries only Reachy's own exchange, and B.U.N.N.Y.'s follow-up carries only its current conversation's messages

#### Scenario: Imported messages stay historical
- **WHEN** an archive is imported into an empty store and the owner then sends messages in the imported conversation
- **THEN** no imported message reaches any model call or the preview, the imported messages stay readable on the page, and only the messages saved after the import enter the recent section

#### Scenario: A removed owner message takes its task's tool results along
- **WHEN** the owner removes the opening message of a task that read a tool and replied
- **THEN** the next call's recent section holds neither that message nor that task's tool result, still holds its reply and another task's tool result, and drops the reply once the owner removes it too
- **AND** when the owner removes the answer of a task that asked a question, was answered, read with a tool and replied, the preview and the next call keep that task's opening message, question and reply and hold neither the answer nor its tool result

#### Scenario: A message the profile may not read
- **WHEN** B.U.N.N.Y.'s conversation holds a saved message from Reachy to MicroDuck
- **THEN** neither the preview nor B.U.N.N.Y.'s next call carries it

#### Scenario: A reference outside the budget
- **WHEN** a conversation holds 61 earlier messages
- **THEN** the recent section sends the newest 48 and states that 13 earlier messages were left out, and the oldest reference is not sent

#### Scenario: Knowledge per companion
- **WHEN** the owner has an active knowledge note, turns knowledge on for B.U.N.N.Y. and later off
- **THEN** B.U.N.N.Y.'s calls carry the note only while it is on, Reachy's never do, and a second switch command naming the same revision is refused as a revision conflict while a library command naming it is accepted

#### Scenario: Preview equals the next call
- **WHEN** the owner previews the context before a task, during a task that waits on a question, and after a restart
- **THEN** each preview's sections equal the sections the next synthetic model call sends, and the hosted request shares only the fields permitted by the common policy

#### Scenario: Follow-ups across subjects
- **WHEN** after discussing one synthetic light the owner says "dim it", after discussing two the owner says "dim it" again, and after the light is removed the owner names it
- **THEN** the first proposal names that light bound to its current configuration and nothing is sent before approval, the second leads to a clarification naming both, and the third is refused with nothing sent
- **AND** "show that animation" after a synthetic striped pennant was attached resolves through its request identity to that artwork rather than another library item, "investigate that" after a synthetic playback warning drafts a delegation brief with the symptom for approval, and a question about the second of two check results in an earlier worker report is answered without a tool call

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

### Requirement: Direct private Conversation controls

For an explicit request by the authorized owner in private Conversation, each companion SHALL execute the resolved supported Hub or device control through the tracked dispatcher without an approval turn. Before dispatch the module SHALL bind the owner input, action, targets, settings, request identity and current revisions. The module SHALL ask for missing or ambiguous details before sending anything. Previous messages MAY resolve references and SHALL NOT authorize a new action. Status questions, hypotheticals and model suggestions SHALL NOT dispatch controls. The dispatcher and designated writer SHALL preserve capability, permission, revision and hold checks. A lost acknowledgment SHALL report uncertainty with no retry.

#### Scenario: All three companions can execute

- **WHEN** the owner names a unique configured plug and asks to turn it off, or asks for an explicit Hub mode, in any of the three conversations
- **THEN** its allowed control dispatches once without an approval question

#### Scenario: Clarification binds a missing setting

- **WHEN** the owner requests a control without specifying a required setting, or names a target matching two devices
- **THEN** Conversation asks for the missing setting or the exact device
- **AND** the owner's answer completes the original request and one tracked command dispatches without another approval

#### Scenario: Ordinary requests bind typed controls

- **WHEN** the owner asks to pause media on a uniquely named display, clear notices for an exact session or change a named monitor setting
- **THEN** the matching typed command dispatches once without an approval or a protocol-formatted request

#### Scenario: A brightness instruction needs a device lookup first

- **WHEN** the owner sets a specific brightness by exact device ID and the supervisor looks up the device first
- **THEN** the supervisor receives only the matched permitted device and its supported brightness control
- **AND** Conversation applies the original target and amount through the usual guarded dispatch once, without a separate approval
- **AND** ambiguous, unsupported or denied selections send no command

#### Scenario: A literal brightness ID collides with another device's label

- **WHEN** the owner names `id:<device-id>` in the brightness instruction or in an answer to its clarification
- **THEN** Conversation resolves the literal ID against the matching devices, ignoring display labels for that selection
- **AND** a recognized read-only status question that names the literal ID selects only that ID under the current grants and sends no command
- **AND** the device lookup for either supervisor and the brightness command tools accept the bare returned ID or an explicit `id:<device-id>` selector, which matches only that ID within the selected owner scope
- **AND** before dispatch, Conversation checks the current access to the original request and any exact clarification
- **AND** an unresolved or no longer permitted ID sends no command

#### Scenario: A direct brightness command has a saved acceptance

- **WHEN** the tracked dispatcher accepts the direct brightness command and Conversation saves its receipt
- **THEN** Conversation completes locally from the receipt and distinguishes acceptance from correlated confirmation
- **AND** reconciliation after restart sends no new command and makes no supervisor replay for that request
- **AND** if current read or sharing authority no longer permits the receipt details, Conversation shows a neutral completion
- **AND** Read aloud requires current access to the receipt at both the private Conversation and speech destinations

#### Scenario: A display alias matches multiple eligible targets

- **WHEN** the owner asks to show saved art on a shared display alias and another destination, even if the model proposes an exact display ID
- **THEN** Conversation asks which exact display the owner meant and names only candidates permitted at the reply destination
- **AND** a valid clarification preserves the rest of the requested destination set

#### Scenario: The owner names a specific draft revision

- **WHEN** a save proposal selects a different draft revision than the one the owner requested, or the draft changes before dispatch
- **THEN** the save conflicts and no library write is sent

#### Scenario: Matching words alone do not authorize effects

- **WHEN** a model requests brightness using a number the owner supplied for a different property or a relative change
- **THEN** no brightness command is sent
- **AND** a saved-art show must match every requested recipient and the requested status visibility

#### Scenario: A stored admission has no reply after restart

- **WHEN** the runtime restarts after admitting the command but before receiving its reply
- **THEN** the original request stays uncertain and is never sent again

### Requirement: Field grants at each Conversation destination

Before disclosing retained fields, the owning module SHALL check the current grant for caller, companion, purpose, source and destination. This SHALL cover discovery, counts, joins, pages, tool output, provider prompts, recent context, title requests and coding briefs. Existing collection and sharing choices SHALL remain in force. All configured external Conversation models SHALL use the same owner-selected field policy with separate purposes for supervisor turns and title requests. Private Conversation and speech reads and approved coding briefs SHALL use their existing destination grants. Other destinations SHALL receive retained fields only after explicit owner selection. Revocation SHALL apply before the next disclosure.

#### Scenario: Public metadata respects current grants

- **WHEN** a task's public read grant is withdrawn after a state snapshot was prepared
- **THEN** later assistant-state updates, replay and sync omit the identity, status and counts of that task
- **AND** a conversation list uses the neutral persona title when a stored generated title cannot be traced to currently allowed fields
- **AND** an explicit owner title is shown while its label grant allows it

#### Scenario: No access through a different read

- **WHEN** the owner withdraws a grant for a retained record
- **THEN** a later read cannot return the record, its fields or its contribution to counts through a different companion, task, tool, page or ungranted destination

#### Scenario: Revocation follows saved answers and selected briefs

- **WHEN** a later turn repeats an earlier tool-derived answer and the owner revokes its source field
- **THEN** the derived answer cannot reach a page, a new model prompt or read-aloud delivery after restart
- **AND** an approved brief with a source denied to the worker does not leave through a new or queued dispatch
- **AND** a retained question cannot expose an answer whose own message grant was revoked

### Requirement: Per-task companion supervisor

For [Hub #2108](https://github.com/jimmie-potts/agent-device-hub/issues/2108), every companion SHALL offer the configured hosted supervisors for a new Send or Queue. The selected supervisor SHALL be independent of coding-worker selection and SHALL follow the task through questions, tool results, steers and recovery. Hosted tasks SHALL pin their supervisor, model, effort and pricing before admission. A task whose prior provider is ambiguous or whose matching configuration is unavailable SHALL remain readable and unable to resume. A request refused by one provider SHALL have no automatic retry or fallback. Both hosted supervisors SHALL use the common external-model policy in ADR 0011. Each adapter SHALL keep its own request format, sizing, caching and native continuation. Provider-native continuation items SHALL be sent only to their originating task and adapter, subject to the current sharing policy.

#### Scenario: Resume a task after selecting another supervisor

- **GIVEN** OpenAI and Anthropic are available and an OpenAI task waits on a clarification
- **WHEN** the owner queues an Anthropic task, restarts and answers the active question
- **THEN** the answer and the opaque items from the active task reach only its pinned OpenAI supervisor, and the queued task retains Anthropic for its own start

#### Scenario: Limit an OpenAI disclosure before a model call

- **GIVEN** a current hosted task, private preferences, unrelated sessions and messages in other conversations
- **WHEN** the task requests a model turn or title
- **THEN** the request contains only the allowed current owner request and relevant scoped data for that purpose, and a revoked disclosure prevents opaque replay

#### Scenario: Respect device exclusions before a Responses tool result

- **GIVEN** the owner asks for a named device's state and excludes another device or a device group
- **WHEN** either supervisor requests a device listing
- **THEN** the result can include the requested device and excludes the other device or group

#### Scenario: One configured hosted supervisor is unavailable

- **GIVEN** both hosted supervisors are configured and one has an unreadable credential
- **WHEN** the companion starts
- **THEN** the companion can start a newly selected task on the available supervisor and serve existing conversation history, while tasks pinned to the unavailable one cannot start or resume

#### Scenario: Upgrade with no saved supervisor identity

- **GIVEN** an earlier task and its queued work have no saved supervisor
- **WHEN** the companion starts or receives an approval or queue-resume request
- **THEN** the earlier task stays readable and its queued work stays held, without applying the approval or sending work to the currently configured supervisor

#### Scenario: Revalidate a saved coding hand-off

- **GIVEN** an approved coding hand-off waits across a restart and an earlier supervisor input names the same repository
- **WHEN** dispatch rechecks the saved approval and sharing grants
- **THEN** only the approval bound to that operation, repository and brief uses the worker-only grant
- **AND** earlier call disclosures require the original supervisor, private read and derived-input grants
- **AND** an unverifiable approval stays readable with a refusal before dispatch
- **AND** a verified hand-off with current grants can start without another supervisor call

#### Scenario: A title trigger waits during another supervisor’s check

- **WHEN** a title trigger arrives while the other supervisor’s title check is running
- **THEN** its follow-up uses its own provider and permitted inputs
- **AND** the follow-up checks title eligibility and current grants before submission

#### Scenario: A paid Responses call loses its answer

- **GIVEN** a shared ledger with reservations from both hosted supervisors and their title calls
- **WHEN** OpenAI usage remains unknown after an uncertain call
- **THEN** the pinned worst-case reservation remains counted, and another call that would exceed the shared guard is refused before submission

#### Scenario: Dispatch a shared device command and hand off a background job

- **GIVEN** the OpenAI supervisor is selected and the owner names a supported device or approves a proposed coding hand-off
- **WHEN** the assistant binds the device instruction or accepts the background job through the existing dispatcher
- **THEN** the owner's device instruction follows the same command path and guards as other supervisors, and the background job posts its result in the originating conversation without replaying private worker data to OpenAI

### Requirement: Background coding jobs in Conversation

An approved coding delegation SHALL return a stable job ID and let its Conversation turn finish without waiting for dispatch, worker admission or a result. The approved job SHALL remain independent of subsequent turns and chat selection. The result SHALL reach the original conversation and exchange by the saved attempt identity. Conversation SHALL offer an authenticated stop control on a queued or running job reference. It SHALL name the exact job and attempt, including when opened in an earlier chat. Settlement SHALL save the observed result and pending conversation delivery together, including for pre-upgrade delegations. If saving an accepted-dispatch or unconfirmed-stop observation fails, or delivering a saved observation fails, the coordinator SHALL retry only the local write. Settlement SHALL retain preceding observations in order. Recovery of an unsettled run with a committed stop intent and no saved receipt SHALL show that a stop was requested and remains unconfirmed. Repeated delivery SHALL affect only the original job exchange or saved delegation question. It SHALL never resend a worker command to recover delivery.

#### Scenario: Worker still running

- **WHEN** an approved job has a delayed worker result
- **THEN** Conversation can answer a Hub question and accept a second delegation before the result arrives

#### Scenario: Results in a different order

- **WHEN** two jobs finish in reverse order after the owner starts another chat
- **THEN** each result appears once on its originating exchange

#### Scenario: A pre-upgrade delegation cannot receive its saved observation immediately

- **WHEN** recovery settles a pre-upgrade dispatch or run, and the original conversation cannot be written immediately
- **THEN** the saved uncertainty remains pending until the local conversation write succeeds, the original legacy turn remains paused for owner resume, and no worker command is resent

### Requirement: Bounded device history in Conversation

Conversation SHALL offer supported sources and read operations from the shared device contracts and check current destination grants when returning retained evidence. The core SHALL provide a versioned bounded read over its own history and open observation spans with one device identity and one half-open interval. The read SHALL return on, off and unknown durations and evidence identities, distinguish gaps and removals, and carry observed power through confirmed metadata-only deltas. A link SHALL identify the tracked request, successful transmission and later matching observation as distinct evidence, without claiming exclusive cause. Relative device history SHALL use an optional `assistant.historyTimeZone` for both supervisor paths and every companion, falling back to the runtime time zone. An unsupported zone ID SHALL refuse the section with `invalid-request`. The relative interval SHALL use the time the owner submitted the request text, including the latest saved edit to a queued message and the saved time of a steer. Explicit timestamp intervals, spend accounting periods and scheduled routines retain their existing semantics. A Conversation cursor SHALL bind its task, destination, normalized query and captured evidence boundary. A stale or foreign cursor SHALL be refused and a denied operation SHALL expose no request link.

A supervisor SHALL receive summary facts for ordinary duration and last-change questions. When the owner explicitly asks for on or off times of one specific device over a specified period, either supervisor SHALL be eligible to receive the same in-period timestamps for the selected device and period, up to two pages of 12 rows. The current common detail policy SHALL apply on every page. The timestamp projection SHALL exclude raw observations, evidence and operation identifiers, raw cursors and links.

#### Scenario: Power history on a local day

- **WHEN** the owner asks about an allowed device's observed power yesterday across a daylight-saving change, a gap or a removal
- **THEN** duration totals partition the actual local day and unknown time remains visible

#### Scenario: Evidence pages and causes

- **WHEN** a bounded result needs multiple pages
- **THEN** Conversation returns whole rows from the captured evidence boundary and rechecks the grants on every page
- **AND** a send without observed effect, or competing possible causes, supports no unique causal claim

#### Scenario: An OpenAI supervisor answers an explicit history request

- **WHEN** the owner asks about one exact Wemo plug or LIFX light over a resolved interval and current local and model grants allow the summary
- **THEN** either supervisor receives the same permitted summary facts for the requested device and interval, with incomplete or unknown coverage identified
- **AND** raw observations, evidence and operation identifiers, links and private cursors stay private
- **AND** an ambiguous device, mismatched query, expired or foreign cursor or revoked grant exposes no retained facts

#### Scenario: A Claude supervisor answers a named local-day history question

- **WHEN** the owner asks how long one named Wemo plug or LIFX light was on or off yesterday
- **THEN** the request fixes the source, device and local-day interval before any model tool call
- **AND** Claude receives the same bounded summary facts permitted to either supervisor, with unknown time visible
- **AND** each page rechecks current grants and an ambiguous, mismatched or foreign query exposes no retained facts

#### Scenario: Explicit on and off times for one device

- **WHEN** the owner asks for the on or off times of one exact device over a specified period and the current common details policy allows them
- **THEN** each supervisor receives the same bounded in-period timestamps with unknown coverage identified
- **AND** ordinary history questions, unresolved requests and requests with a denied details grant expose no detail timestamps

### Requirement: Separate explicit job instructions from ordinary Conversation

Conversation SHALL give each authorized coding-job receipt an attempt-specific card. An explicit natural-language job instruction SHALL be resolved to an eligible job and its current attempt. When the owner has not identified a unique target the page SHALL request a choice before sending. Ordinary messages and approvals SHALL retain their existing Conversation behavior while the job runs.

#### Scenario: Two similar jobs and a Hub question

- **GIVEN** two jobs for the same companion use the same repository
- **WHEN** the owner addresses one by a unique name and asks a separate Hub question
- **THEN** only the named attempt receives the job instruction and the Hub question proceeds in Conversation

### Requirement: Private status of one named coding job

Conversation SHALL answer an owner’s status question about one full coding job ID locally, using the current attempt from the authorized Jobs projection in its originating conversation. Mixed or ambiguous requests SHALL require a separate question. The status question SHALL send no job control or provider request.

#### Scenario: Status while coding continues

- **GIVEN** a readable coding job with an active attempt
- **WHEN** its owner asks for its status by full ID in the originating conversation
- **THEN** the answer identifies the attempt and the state Jobs reported at that instant
- **AND** the worker continues and the owner can send another ordinary message

#### Scenario: Private reply after permission or attempt changes

- **WHEN** the owner reads a saved status reply after restart
- **THEN** Conversation checks current permission for the conversation and the source job and attempt
- **AND** a foreign, unknown or inaccessible job reveals no job facts
- **AND** a changed attempt cannot be presented as the attempt that supplied the saved status
- **AND** later provider and title prompts receive no job facts from the private question or answer
- **AND** a request for the last owner message cannot substitute an older message for that private question

### Requirement: Common external-model Conversation context

For [Hub #2180](https://github.com/jimmie-potts/agent-device-hub/issues/2180), Companions SHALL select permitted semantic inputs once for a given companion, active owner request, conversation and purpose, irrespective of the configured hosted supervisor. The supervisor purpose SHALL receive the active owner request, the eligible working context of that conversation, scoped device facts and explicitly requested bounded device-history summaries. Active knowledge and preference fields SHALL require an explicit common prompt grant for each field. The companion's knowledge switch SHALL still apply. Eligible earlier owner messages, companion replies and permitted tool results SHALL enter the working context in chronological order. The current request's wording SHALL NOT filter this history. Current device discovery and command guards SHALL resolve ambiguous references before a control can proceed. A steer that changes the subject SHALL rebuild the scope. A call SHALL deliver every newly admitted owner steer in the selected batch in order. Earlier companion replies and tool results SHALL retain proof of access to the original disclosures that their permission depends on. Credentials, raw logs, unrelated sessions and conversations, raw coding transcripts, media, bulk history and unrelated fields SHALL stay private. Other authorized non-device inputs SHALL remain within their existing purposes.

The hosted working context SHALL fit within the selected model's estimated token allowance, after reserving instructions, tools, current input, continuation and output. Individual message admission, transport safety and spend limits SHALL remain independent. If the required request alone exceeds the working allowance, Companions SHALL preserve the saved input and refuse transport before reserving spend for that request. When the eligible history outgrows its allowance, Companions SHALL preserve recent exchanges verbatim and automatically attempt a bounded summary of older exchanges. The summary SHALL carry relevant decisions, unresolved requests, device references and corrections as historical background. A compaction request SHALL send no tools and SHALL use the same pinned supervisor, with its existing spend, receipt and uncertainty controls. A missing or unusable compaction MAY leave only the eligible verbatim tail while original history remains privately readable. Past messages and derived text SHALL grant no approval or authority to act.

A saved summary SHALL be scoped to its conversation and covered sources. Before reuse or disclosure, Companions SHALL recheck the covered source versions and currently applicable grants. An edit, removal or revocation SHALL prevent disclosure of stale derived text. Saved replies and questions SHALL remain visible where the owner's private read grants permit them. Private display and speech SHALL also check the respective current grants against deduplicated original field requirements inherited through earlier replies or tool results. Companions SHALL save reusable private disclosure proof with finalized replies and eligible tool results, and read the direct disclosure requirements in older released ledgers. Companions SHALL preserve the raw record and withhold a derived reply whose required proof is absent. A permitted saved reply SHALL remain available irrespective of lineage length. After awaiting compaction, the ordinary call SHALL refresh any shared current state from its authoritative synced copy before admission. Companions SHALL NOT repeat a compaction with an uncertain receipt under a new identity merely to produce the same summary.

The owner's explicit Send, Queue, Steer and Answer actions SHALL use the existing Conversation input path. The common policy SHALL govern submitted text and other model-bound fields. Configured credentials and secret files SHALL stay in the existing configuration and transport mechanisms, outside model input.

Companions SHALL check current local access and common model grants before discovery, projection, paging and transport. A denied required field SHALL prevent submission with an existing refusal code. Derived text and native continuation SHALL be rechecked against their original disclosures before replay after a steer or restart. A missing disclosure record SHALL fail closed when current permission cannot be established. Only the originating task and adapter may reuse native items that meet the current policy.

The runtime SHALL normalize existing model grants into the common policy without rewriting private originals. An explicit denial SHALL survive migration. When an old choice and common policy cannot be reconciled without widening access, the affected field SHALL stay private and a conflict SHALL be visible locally without disclosing its private values.

#### Scenario: Equivalent hosted inputs for each companion

- **GIVEN** a same-conversation request names two allowed devices, with unrelated devices and conversations present
- **WHEN** the owner follows up about the two devices and then changes the subject, using each hosted supervisor on equivalent fixtures
- **THEN** decoded requests for each companion carry the same eligible chronological history under equivalent fitting limits, with the same current request and scoped device facts for the same purpose
- **AND** a title request exposes only its permitted title inputs
- **AND** the changed subject does not replay ungranted device fields or incompatible native items

#### Scenario: Older exchanges pass the working token allowance

- **GIVEN** eligible history includes a settled owner decision, an open question, a device reference and a later correction
- **WHEN** many short exchanges or a few long exchanges fill the model's working allowance
- **THEN** the bounded summary carries continuity from older exchanges and recent exchanges keep their exact text in saved order
- **AND** original messages remain privately readable, and only the current request and control guards can authorize action

#### Scenario: Compaction replay and changes to sources

- **GIVEN** a private checkpoint from a completed compaction and the receipt of a separate attempt with an uncertain result
- **WHEN** the task resumes, and an input source is later edited, removed or denied
- **THEN** the checkpoint is reusable only while its source versions and grants still match
- **AND** stale derived text does not reach the next transport, and the uncertain attempt is not resent as new work

#### Scenario: Private reply inherits grants through many exchanges

- **GIVEN** a saved reply derives from an older grant-controlled reading across a long conversation
- **WHEN** the owner reads the latest page or asks to speak the reply, including after a restart
- **THEN** an allowed reply remains available irrespective of lineage length
- **AND** withdrawing the original private read or speech grant withholds the reply for that recipient

#### Scenario: Submit ordinary Conversation text

- **GIVEN** a configured hosted supervisor and allowed owner text
- **WHEN** the owner uses Send, Queue, Steer or Answer
- **THEN** Conversation uses the corresponding existing control and the selected task receives permitted text through the common policy
- **AND** configured credentials and secret file contents stay outside model input

#### Scenario: Revocation after assembly

- **GIVEN** a hosted request is assembled with a granted field
- **WHEN** the grant is revoked before submission, during subsequent paging or before replay after a steer or restart
- **THEN** the next disclosure omits the denied field or refuses with no provider request when that field is required
- **AND** choosing the other supervisor does not restore the field or replay the first supervisor's opaque items

#### Scenario: Legacy sharing choices

- **GIVEN** absent, legacy-only, identical and conflicting model grant configurations
- **WHEN** Companions loads each configuration
- **THEN** current authority bounds the resulting common grants
- **AND** explicit denials survive, conflicts keep affected fields private and are visible locally, and the saved configuration is preserved

### Requirement: Model-interpreted Wemo power proposals

The selected Conversation supervisor SHALL interpret the current authenticated owner request using the common context and grants. It SHALL distinguish a question, a request needing clarification and a power action for one or two configured Wemo plugs. The Hub SHALL bind a typed action to the current request, any eligible clarification and the eligible target references. The Hub SHALL validate the whole selection, current access, registered ownership, power capability and target guards before dispatch. It SHALL use the existing tracked generic power dispatch and the designated Wemo writer with its hold and maximum-on policy. Permitted conversation facts and a scoped lookup of configured Wemo IDs and labels MAY identify a referenced device. The current owner request supplies authorization.

#### Scenario: Read before applying exact Wemo power

- **WHEN** the current owner directs a power change using one complete Wemo ID and the supervisor looks up the device first
- **THEN** the scoped lookup SHALL preserve that literal ID, including when followed by sentence punctuation, and return only its uniquely matched permitted device
- **AND** an unknown or malformed explicit ID SHALL return no scoped device facts or dispatch, and ambiguous names SHALL require clarification before dispatch
- **AND** a generic lookup SHALL return no device for an ambiguous name, while the typed Wemo finder MAY return matching permitted candidates for clarification and MAY discover permitted candidates for an open request with no recognized device name

#### Scenario: A clear group request continues after discovery

- **WHEN** the owner explicitly requests power on or off for all configured Wemo plugs and the read-only lookup resolves a supported group
- **THEN** the supervisor proposes the whole group in a subsequent model response within the same owner request
- **AND** the Hub dispatches once per intended target if the group passes current validation

#### Scenario: Two plugs followed by one reference

- **WHEN** the owner asks any companion to operate two named Wemo plugs and then asks to operate just one using the previous exchange
- **THEN** the first request dispatches once for each intended target and the next request dispatches once for the one resolved target
- **AND** both configured supervisors use the same proposal and validation rules

#### Scenario: A relative description needs a lookup

- **WHEN** the owner describes a plug without using its configured name or ID
- **THEN** the supervisor can resolve the request using the permitted target lookup and prior Conversation facts
- **AND** the Hub checks the chosen ID against the disclosed records and their current guards

#### Scenario: Exact IDs constrain all writes

- **WHEN** the current request or scoped answer supplies an `id:` selector
- **THEN** only those complete, registered IDs can be write targets
- **AND** an unknown or malformed selector prevents every write in the proposal, including when the model marks it as context
- **AND** a group proposal or an additional implicit target requires clarification before the Hub sends a command

#### Scenario: A request mentions two exact IDs

- **WHEN** a power request explicitly contains two registered ID references
- **THEN** the proposal accounts for each ID as a target or as context the owner intends to leave alone
- **AND** an unaccounted ID prevents any dispatch from that proposal
- **AND** the receipt states that the Hub sent no command to each context-only ID

#### Scenario: Ambiguous or superseded request

- **WHEN** the request leaves an intended target or setting unresolved
- **THEN** the companion asks one focused question before sending any power command
- **AND** an exact eligible ID selects that device independently of other devices' labels
- **AND** a concrete target selection in the answer constrains the proposal, including group selections
- **AND** a steer supersedes any part of the previous request that has yet to send

#### Scenario: Questions and contextual text

- **WHEN** the owner asks a state question, quotes an example, describes a hypothetical action or says to leave a plug alone
- **THEN** the supervisor proposes no power action
- **AND** words in device labels, prior messages, tool results and assistant suggestions supply no command authority

#### Scenario: Independent results with a lost reply

- **WHEN** a request reaches more than one plug and a result is unavailable, expired, failed or uncertain
- **THEN** the original exchange reports each target's own receipt and retains any confirmed result
- **AND** duplicate delivery and restart preserve each operation identity without resending a possibly sent effect
- **AND** transmission alone establishes no observed plug power

### Requirement: Conversation uses the runtime device lookup

Conversation SHALL use the shared device lookup for supported device facts, and SHALL apply its active context-sharing and tool grants to every returned field. Proposals SHALL continue to use guarded device identity and the existing tracker, approval and receipt flow.

#### Scenario: Device details are outside the conversation grant

- **WHEN** a model asks for device details that the active Conversation sharing policy excludes
- **THEN** the model receives no excluded fields, even if a different client has authority to read them

#### Scenario: The supervisor reads the selected light's current controls

- **WHEN** the owner names one light and the selected supervisor has permission for its current device status
- **THEN** the supervisor can read the light's supported controls, advertised bounds and current observations for the request
- **AND** historical timestamp permission is unnecessary for those current facts, while denying current status withholds them

#### Scenario: The scoped reader selects a Wemo plug

- **WHEN** the selected supervisor has current-status and power-control grants for one Wemo plug
- **THEN** its facts include that plug's power support, allowed action and current guards, plus its existing maximum-on information when available

### Requirement: Contextual lighting settings

Conversation SHALL use the selected supervisor's interpretation of the current authenticated owner request to resolve supported lighting power, brightness, color and temperature. The Hub SHALL validate the result against registered device identity, capability, settings, grants and current command guards. The current request supplies action authority. Authorized conversation context supplies references. The supervisor SHALL declare read or set intent, timing, and any missing setting independently. A setting answer SHALL retain the original timing and exact device.

#### Scenario: Follow-up setting and read

- **WHEN** the owner sets a configured light's brightness, refers back to the light to change a supported setting, and asks how the light is set
- **THEN** each valid setting change reaches the exact light once through its registered writer
- **AND** the status question reads the known setting under the current grants and sends no write.
- **WHEN** a lighting proposal declares a read, a conditional or future scope, or unresolved timing
- **THEN** the Hub sends no immediate lighting command.
- **WHEN** a proposed boolean conflicts with an explicit on or off value in its quoted owner evidence
- **THEN** the Hub refuses the proposed command before dispatch.

#### Scenario: A conditional lighting request needs a setting

- **WHEN** the supervisor declares a conditional or later lighting change and identifies a missing setting
- **THEN** Conversation asks once for that setting and saves the current request, condition, device and setting slot.
- **AND** answering the question after a restart retains the original scope and sends zero immediate commands.
- **AND** a generic clarification without a saved lighting scope cannot supply execution authority.

#### Scenario: Ineligible or ambiguous proposal

- **WHEN** the proposal has an ambiguous target or lacks a required setting
- **THEN** Conversation asks a focused question before dispatch.
- **WHEN** the settings are invalid or the permission, device binding, capability or controller guard refuses the request
- **THEN** the affected device receives no command.

#### Scenario: Receipt after interruption

- **WHEN** the action is interrupted or the same request is delivered again
- **THEN** the original receipt remains authoritative and a possibly sent effect is not sent again.

#### Scenario: Context preserves ambiguity and owner qualification

- **WHEN** an earlier owner message uses a name shared by one light's ID and another light's label
- **AND** the current owner request refers back without resolving that collision
- **THEN** Conversation asks for the exact device and sends no command even if the model supplies an ID.
- **WHEN** the owner qualifies a shared label by device owner
- **THEN** the requested route may resolve that owner's eligible device.

#### Scenario: A color proposal is missing saturation

- **WHEN** a valid color proposal specifies hue for a resolved light and lacks saturation
- **THEN** Conversation asks one focused saturation question and sends no command until the owner answers.
- **AND** the completed proposal preserves the resolved target and hue and passes the current permission, mode and device revision checks before dispatch.
- **AND** the owner answer supplies one whole saturation percentage that matches the proposed value. An answer with no usable percentage, conflicting values or incompatible units sends no command.

#### Scenario: Context remains available in a read-only configuration

- **WHEN** the owner asks a contextual LIFX status question with the LIFX read tool enabled
- **THEN** Conversation reads the eligible light under the current grants without requiring or adding a lighting write tool.

#### Scenario: A hosted supervisor reports a contextual device reading

- **WHEN** a current hosted status request refers to a device in the preceding owner exchange
- **THEN** the Hub SHALL use a saved single-match lookup for that exchange, or a verified control binding for the same owner source, to identify the device for a fresh read.
- **AND** a missing or ambiguous lookup SHALL clear the prior reference. The Hub SHALL ask which device the owner means and use the authenticated answer to resolve the lookup without forwarding stale facts.
- **AND** the Hub SHALL recheck exact device identity, owner sources and current grants both when reading facts and before forwarding the result. An unavailable newer owner message SHALL NOT revive an older binding. A later observation of the same device SHALL NOT invalidate the permitted sample.
- **AND** an exact owner selection with an authenticated setting-slot answer can ground a fresh read after a refused write without treating the write as applied.
- **AND** the status request SHALL send no device write. A local refusal before provider transmission SHALL NOT retain a charge for that unsent call.

#### Scenario: A hosted device read omits its selector

- **WHEN** the selected supervisor leaves the device selector empty and the complete current owner request binds to one permitted device
- **THEN** the Hub reads that device and rechecks its owner, exact ID and grants before replaying the facts.
- **WHEN** that binding is unclear
- **THEN** the same supervisor gets one facts-free opportunity to supply an explicit selector for this request.
- **AND** if the target remains unclear, Conversation asks which exact device the owner means before any command.
- **AND** a cancelled read discloses no device facts. An excluded device cannot be selected via the missing-selector path.

#### Scenario: Explicit quantities keep their meaning

- **WHEN** the owner names a starting value and a desired value
- **THEN** the selected supervisor distinguishes them and the Hub validates the whole desired quantity in the registered unit, including signed digits and whole numbers written in words.
- **WHEN** a proposed absolute setting drops a sign, uses a malformed quantity, conflicts with the cited owner value or exceeds the registered bounds
- **THEN** the Hub sends no command.
- **WHEN** the owner supplies a numeric lighting value with repeated or conflicting signs, or declares an unsupported unit beside the quantity or separately for that setting
- **THEN** Conversation asks for an unambiguous value in a supported unit and sends no command before the owner answers.
- **AND** a corrected numeric answer binds to the same selected device, operation and current guards.

#### Scenario: Brightness requires a determinate value

- **WHEN** the current request names a clear brightness value, a fraction of brightness or a registered limit
- **THEN** the Hub uses the stated value and unit on the resolved device. A conflicting model scalar cannot replace a fraction or registered limit. A limit named only as an exclusion or ceiling supplies no setting.
- **AND** a fractional percent must be representable at the device step.
- **WHEN** the brightness is missing, subjective or only qualified by a time
- **THEN** Conversation asks once for a percent, fraction or limit. The answer must supply that value for the same device and operation before one command can be sent. A bare affirmation cannot supply a value for this open question.

#### Scenario: Relative and extreme settings use registered limits

- **WHEN** the owner asks for a supported relative brightness or temperature change
- **THEN** the Hub calculates the proposed setting in the selected unit from current observed state, rounds to the registered step and stays within the registered bounds.
- **AND** the Hub sends no command if the observation is stale or unknown, the observed base changes before dispatch, or the calculated setting is unchanged.
- **WHEN** the owner requests a supported extreme
- **THEN** the Hub uses the registered bound.

### Requirement: Model-interpreted Conversation catalog

Either registered supervisor SHALL receive the configured tools for the supported Conversation catalog. A migrated action SHALL remain bound to the current authenticated request, an eligible registered owner and target, the validated settings and the existing owner revision or generation. The Hub SHALL preserve existing approvals and field-specific sharing. A private draft mutation SHALL use its guarded revision and SHALL send no device command.

#### Scenario: A catalog operation uses a current owner request

- **WHEN** the owner asks for a supported operation and the supervisor supplies a unique target and valid settings
- **THEN** the Hub sends the existing guarded owner command through the tracked dispatcher once
- **AND** the private result follows the owner's existing evidence contract

#### Scenario: Device availability follows the registered owner rule

- **WHEN** a catalog request targets an unavailable device
- **THEN** the tracked dispatcher applies the registered owner's availability rule to the guarded command
- **AND** eligible owner-local changes such as Pixoo Now Playing and Moments preferences can be admitted
- **AND** a physical action requiring availability is refused, and an active hold refuses these preference and physical writes

#### Scenario: A Hub mode answer belongs to a question about switching

- **WHEN** the current owner asks to switch Hub mode without naming a mode
- **THEN** the supervisor can ask the Hub to render and save a question about which mode to switch to
- **AND** a short mode answer can complete that same request after restart while the request and Hub mode revision are current
- **AND** a short answer to a generic or informational question sends no mode command
- **AND** a complete current owner instruction naming the requested mode can dispatch directly

#### Scenario: A supervisor cites a current request to switch Hub mode

- **WHEN** the supervisor interprets the current owner input as an affirmative Hub mode switch and cites the action and its selected mode verbatim
- **THEN** the Hub checks the current owner quote and validates the selected mode against the quoted action before dispatch
- **AND** absent or inconsistent cited evidence authorizes no write

#### Scenario: A hosted catalog proposal cites the current target words

- **WHEN** the hosted supervisor proposes a catalog effect against an existing target
- **THEN** the selected supervisor cites verbatim target selections and exclusions in the current authenticated owner request or clarification, with their primary or nested roles
- **AND** the Hub checks each cited source and resolves current named targets in their owner-local permitted records before dispatch
- **AND** absent, inaccessible, ambiguous or conflicting named targets send no command and require clarification

#### Scenario: Visible command-capable devices share a label across owners

- **WHEN** a current target name matches visible devices under different owners for the requested command
- **THEN** the Hub requires a current exact ID or an owner-qualified name, or asks for clarification before dispatch
- **AND** a model-supplied owner alone cannot resolve the collision
- **AND** hidden devices are excluded before matching and their absence does not change the visible result

#### Scenario: The owner selects one target and excludes another

- **WHEN** the current request selects one named target and rules out another
- **THEN** the Hub resolves the selected target and rejects an excluded canonical target
- **AND** a missing selection sends no command, even when the excluded target exists
- **AND** a unique authorized selection with valid settings can dispatch directly

#### Scenario: Earlier context identifies a genuine reference

- **WHEN** a current target phrase refers back to an eligible record in the same conversation
- **THEN** eligible prior context may identify that record for the cited role
- **AND** a pronoun in another instruction cannot replace an absent or conflicting name in the current selection

#### Scenario: The owner asks for the last scene they activated on a light

- **WHEN** the current request names an eligible light and refers to its last scene activation
- **THEN** the Hub checks tracked activation order across callers for that light and selects the latest successful activation only when its scene has eligible owner-backed evidence
- **AND** it asks which saved scene to use if a newer activation has an unresolved outcome or eligible evidence is missing or conflicts
- **AND** the Hub rechecks the receipt identity and permission after reading the tracker and confirms that the same receipt is still current before admitting the command
- **AND** the normal sharing, capability and revision checks still apply
- **AND** a receipt of transmission establishes no physical effect

#### Scenario: A hold release cites an operation

- **WHEN** the current request cites an operation for a held device
- **THEN** a selected operation must match the current hold, even if the supervisor omits the operation ID from its command arguments
- **AND** an explicitly excluded operation cannot be released
- **AND** an authorized request to release the current hold may leave the operation unspecified

#### Scenario: A stale draft edit or invalid target is proposed

- **WHEN** the supervisor proposes a stale draft revision, an invalid target, or a target whose permission has changed
- **THEN** the Hub sends no device command and leaves the affected draft unchanged

#### Scenario: A stored scene or original is requested by name

- **WHEN** the current owner asks to activate a saved Nanoleaf scene on an eligible light or change an original Pixoo asset by name
- **THEN** Companions resolves the name through the selected owner and binds its opaque ID before using the existing tracked command
- **AND** both hosted adapters tell the supervisor that the scene argument accepts the owner's exact saved name, an exact scene ID, or the explicit last-activated reference
- **AND** private catalog names and records remain out of the hosted supervisor's results
- **AND** a missing scene returns `not-found` without sending a command, and the supervisor asks the owner for another scene
- **AND** an ambiguous match prompts for clarification and sends no command

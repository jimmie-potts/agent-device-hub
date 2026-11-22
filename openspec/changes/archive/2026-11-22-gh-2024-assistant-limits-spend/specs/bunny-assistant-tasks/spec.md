## ADDED Requirements

### Requirement: Shared spend limits

The companions module SHALL bound the spend of every profile's paid model calls together at $20 a day and $150 a month, by the runtime host's local day and month starting at local midnight. In the transaction that saves a paid call's receipt, the module SHALL reserve in its own SQLite ledger the most the call can cost: every input unit at the model's dearest input price and every output unit at its output price, from the section's price table. It SHALL refuse the call with the capacity code before dispatch, and record nothing, when that reservation would pass the daily or the monthly limit, and the conversation SHALL show a message that names the limit. Reported usage priced by class SHALL replace the reservation in the transaction that saves the answer, including an answer that arrives after the call's deadline while the module runs. A call whose usage is never reported SHALL keep counting its reservation, never zero, across restart. A call SHALL count on the day and month it was reserved. A paid turn or call of a model without a configured price SHALL be refused with the capacity code and a message naming the missing price. A new turn of a paid profile SHALL be refused with the capacity code and a detail naming the limit when what remains of today's or this month's limit is below the smallest reservation of its first call, 8,192 framing units at the model's dearest input price plus 16,384 output units at its output price; a call already sent SHALL finish. Synthetic calls and coding-worker runs SHALL not be counted. A model call outside a task SHALL record its spend through the same ledger. The module SHALL serve the day's and month's counted amounts, their limits and the count and amount of reservations without reported usage on a private content route without text, call or task identity, together with the paid model and its smallest call, or a missing price, and the page SHALL read it after each assistant-state revision, show whether the paid model is priced and show beside the composer why a paid profile's new message would be refused.

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

#### Scenario: Missing price
- **WHEN** the hosted provider's section has no price for its model and the runtime starts, and a task saved earlier waits on its answer
- **THEN** the companions module starts, the answered task's next model call is refused before dispatch with the capacity code and a message naming the missing price, a new message is refused the same way, and Details and the composer name the missing price

#### Scenario: Remainder below the smallest call
- **WHEN** today's counted spend leaves one millionth of a dollar less than the smallest first call
- **THEN** a new message to the hosted profile is refused with the capacity code and a detail naming the daily limit, and no task starts

#### Scenario: Day and month boundaries
- **WHEN** a call is reserved at 23:59:59 local time and settles after midnight, and later the month turns over
- **THEN** the call counts on the earlier day and in its month, the new day starts at zero, and the new month starts at zero

## MODIFIED Requirements

### Requirement: Bounded single execution

The system SHALL admit at most one unfinished task across profiles and one invocation, with no execution queue. A turn is one task: one owner message and everything it causes. Each task SHALL retain limits of 50 model calls, 40 tool calls, 10 questions, 40 minutes active time and 1,000,000 usage units; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Before each model call the task SHALL reserve the request's UTF-8 bytes plus 8,192 framing units and 16,384 output units. Model/tool deadlines SHALL be six minutes and 30 seconds, and control admission five seconds. An owner message SHALL be bounded at 32 KiB, a tool result at 8 KiB, a model reply with its provider blocks at 16 KiB, the working transcript at 1 MiB, staged input at 193 KiB and each serialized checkpoint or set of pending writes at 256 KiB. A call that would pass a limit SHALL be refused before dispatch, and the task SHALL end with the capacity code and a conversation message that names the limit. Reservations SHALL precede dispatch and survive restart; resume SHALL never replenish a turn's budget; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

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

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file, and MAY name `assistant.prices` with the input, output, five-minute cache write and cache read prices of each model in US dollars per million tokens; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret, with a malformed price table or with an unsupported provider. A section without a price for its model SHALL still start the module. The `bunny` profile alone SHALL use the configured provider; other profiles SHALL keep the synthetic provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results, the fixed instructions, the current Hub mode and the prompt context: the task profile's curated persona and the owner's currently active explicit preferences, read from the module's own records at each model call and rendered as owner data that grants no tool, permission or device authority. No knowledge entry, conversation history, other task, inactive or historical preference or private context document SHALL enter the prompt. When the rendered prompt context exceeds 128 KiB the model call SHALL be refused before dispatch with a capacity outcome whose transcript message names the cause; nothing SHALL be truncated silently. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Each hosted request SHALL ask for automatic prompt caching with one top-level `cache_control` of type `ephemeral`, with the tools, the system prompt and the replayed transcript first and byte-stable between a task's calls, and SHALL report usage by class: uncached input, output, cache writes and cache reads; a report without input or output counts, or with a count that is not a whole number, SHALL be unreported. Public state SHALL carry the provider, model and allowed tool names.

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

### Requirement: Conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, the coding worker's availability, reported usage in hosted tokens or synthetic units, and unknown when usage is unreported, today's and this month's shared spend against the spend limits, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL carry the speech endpoint controls as spoken replies (enable in this tab, mute, stop speaking, playback and tracked operation) and a Read aloud control beside each saved assistant message within the spoken bound, stating that enabling makes the tab the one speaker and that stopping speech does not cancel the task. A delegation proposal SHALL show its repository, brief and bound revision; a waiting delegation SHALL say it waits for the worker and offer cancel, not an answer box. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

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
- **AND** retained assistant facts read as Last known, a missing worker copy reads as unknown, usage distinguishes unknown, zero, synthetic units and hosted tokens without estimating a task's billed cost, and spend today and this month read as dollars of their limits, naming reservations still counted for calls without reported usage, or as unknown when the spend cannot be read
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
- **THEN** the titled Spoken replies panel explains browser output, shows the current blocker or Quiet suppression beside the existing Enable, Mute and eligible recovery actions, and keeps detailed requirements and playback evidence available in a disclosure
- **AND** explicit close and Escape return keyboard focus to Voice, and clicking outside dismisses the panel without taking focus from the clicked control
- **AND** opening or dismissing the panel preserves the draft and current speech endpoint without sending a command
- **AND** an unresolved playback reservation disables Enable until it is cleared, and historical uncertainty remains in the playback disclosure without overriding a later successful Enable
- **AND** Stop speaking remains available outside the panel during local playback and leaves the task and question unchanged
- **AND** Read aloud uses the tracked command for the same saved assistant message within the speech limit, presents the command receipt separately from playback, and explains why a longer message stays written only

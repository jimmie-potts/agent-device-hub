## MODIFIED Requirements

### Requirement: Configured model provider

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file, and MAY name `assistant.prices` with the input, output, five-minute cache write and cache read prices of each model in US dollars per million tokens, which override the built-in table; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret, with a malformed price table or with an unsupported provider. A section without prices SHALL start the module and run with daily pacing at the built-in prices. A 400 `invalid_request_error` whose message starts with "You have reached your specified API usage limits" or "You have reached your specified workspace API usage limits", or a 429 `rate_limit_error` whose `error.details.error_code` is `enforced_spend_limit_reached`, SHALL end the task with the capacity code and a conversation message naming the monthly spend limit at Anthropic, with nothing more sent for that turn and no retry; no other 400 or 429 SHALL be read as a spend limit. Every profile, `bunny`, `reachy` and `microduck`, SHALL use the configured provider and model ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)) with the same effort, key, prices, per-turn limits, prompt caching and shared spend limits; without a provider, or with `assistant.provider` `synthetic`, every profile SHALL use the labelled synthetic provider. The section SHALL have no per-profile provider or model, and only a test or harness MAY give one profile another provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results, the fixed instructions, the current Hub mode and the prompt context: the task profile's curated persona and the owner's currently active explicit preferences, read from the module's own records at each model call and rendered as owner data that grants no tool, permission or device authority. No knowledge entry, conversation history, other task, inactive or historical preference or private context document SHALL enter the prompt. When the rendered prompt context exceeds 128 KiB the model call SHALL be refused before dispatch with a capacity outcome whose transcript message names the cause; nothing SHALL be truncated silently. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Each hosted request SHALL ask for automatic prompt caching with one top-level `cache_control` of type `ephemeral`, with the tools, the system prompt and the replayed transcript first and byte-stable between a task's calls, and SHALL report usage by class: uncached input, output, cache writes and cache reads; a report without input or output counts, or with a count that is not a whole number, SHALL be unreported. Public state SHALL carry the provider, model and allowed tool names.

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

### Requirement: Spoken replies to typed requests

When a task turn ends with a result, a question for the owner or a refusal, the companions module SHALL offer that saved message once to its speech coordinator, after the message is durable, under the message's own identity. A `speak` control naming a task and a saved assistant message SHALL offer that message again under the request's identity; it SHALL refuse owner or tool text and an unknown message, SHALL work for finished tasks, and SHALL be idempotent per request. A message longer than 512 characters SHALL stay written only. Startup reconciliation SHALL offer nothing, and a failed offer SHALL NOT change the task's outcome. The spoken voice SHALL be the installation's qualified local voice regardless of the model provider, and stopping speech SHALL NOT answer a question or cancel the task. A profile whose persona audio is quacks only, MicroDuck, SHALL have its English text kept as its intended meaning and never spoken ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)): its turn-ending messages SHALL NOT be offered, a `speak` control naming one of its messages SHALL be refused with `invalid-request` and fixed text saying why, and the page SHALL show that its text is intended meaning in place of Read aloud.

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

### Requirement: Model-written conversation titles

The companions module SHALL give each conversation a title of the form `#<issue> <description>`, or `<repository>#<issue> <description>` for an issue in another repository, or the description alone when no issue appears, written by the profile's title model ([Hub #2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)), and the title SHALL follow the conversation's topic ([Hub #2075](https://github.com/jimmie-potts/agent-device-hub/issues/2075)). The title model SHALL check the title after the admission of a task's first owner message while the conversation has no title, after each task finishes with `succeeded`, `failed` or `cancelled`, and after each major event the module records: an answered approval, approved or declined; a tool call that changed state, that is, a command the core accepted; an accepted coding hand-off; and a coding hand-off's result. No trigger SHALL depend on a count of tasks or on the time since earlier lifecycle evidence. A start of the module SHALL start no check: neither startup reconciliation nor the settlement at start of a coding hand-off left pending at the last stop, which reaches its task as an uncertain result; a hand-off result that arrives after the start SHALL be checked. Each check SHALL start after the commit that recorded its trigger and SHALL NOT fail, delay or roll back a task. A conversation SHALL have at most one title call in flight; the triggers that arrive while a call is in flight SHALL coalesce into one follow-up check that starts when the call settles and carries each distinct event once, oldest first, up to the latest four. Each check SHALL send the fixed title instruction and a prompt of at most 2 KiB with the current title and whether the owner or the title model set it, or that there is none; one fixed-form label for each event the check answers, made of the module's own words with at most a tool identifier, a decision or an outcome word; and the conversation's last eight owner and assistant messages, escaped and cut to fit. A check SHALL send no tool result, dispatch receipt, worker report, preference, knowledge entry or failed turn's closing reply. A coding hand-off's brief SHALL be recognized in both its approval question and its accepted hand-off message. The model SHALL answer `KEEP` when the current title still fits, or a new title; the instruction SHALL tell it that a title the owner set is their choice, to keep unless the topic has clearly changed since. `KEEP`, in any case and with surrounding quotes, emphasis or trailing punctuation, and a new title equal to the current one SHALL publish nothing. Every profile with the Anthropic provider, `bunny`, `reachy` and `microduck` alike ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)), SHALL use the configured `titleModel`, default `claude-haiku-5-5`, with the same key and transport as its turns, by these same rules. On the synthetic provider no profile has a real title model: each SHALL make no title call and keep its persona name; only a test or harness MAY inject the fixed `Synthetic conversation` title provider. The module SHALL keep a new title only after normalization: one line, no surrounding quotes, markdown heading or emphasis, `Title:` label or trailing punctuation, this repository's issues as a bare `#<issue>`, and a description of at most 40 characters cut at a word boundary. An empty or placeholder answer, an answer whose whole normalized form or title, also with the prompt's entity escapes undone, equals any message of the prompt or a coding hand-off's brief (ignoring case, spacing, surrounding quotes and trailing punctuation), an answer whose description after any issue reference, whole or as the title keeps it, shares a run of 6 consecutive words with an owner message or a hand-off brief, an answer long enough to be cut that appears inside another assistant reply, whole or as its whole description after any issue reference, and a title that is not session display text SHALL be refused. The title call record SHALL keep the labels of the events it answered and the model's raw answer, at most 1 KiB, privately; no log, trace, diagnostic or published record SHALL carry the answer. The module SHALL store the title on the conversation with its source, generated or owner, and publish it as the session title: at once in a `lifecycle/2.3` metadata observation while the session may be shown, and on every later lifecycle observation; until a title exists the persona name SHALL stand. A kept, failed, refused, invalid or abandoned check SHALL leave the earlier title or the persona name and SHALL NOT be retried. Each call SHALL be recorded on its conversation, admitted before it is sent and settled with its status, its outcome (applied, unchanged, kept, invalid or dropped) and its reported usage, or unknown usage. A paid call SHALL reserve its most expensive cost in the shared spend ledger as a conversation-level call, in its admission's transaction, and settle it with the reported usage, or keep the reservation counting when none is reported; a call the spend limits refuse SHALL NOT be sent and SHALL be recorded failed with `capacity`; the title model SHALL be priced like any paid model, at its configured price, else its built-in tiers, else the dearest known rate (Hub #2047), and a title call that Anthropic's monthly spend limit refuses SHALL fail with `capacity` without a retry and keep the earlier title or the persona. A title call SHALL count toward the shared spend limits and toward no task's call, unit or time limits.

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

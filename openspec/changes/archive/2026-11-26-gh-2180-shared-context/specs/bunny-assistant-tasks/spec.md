## MODIFIED Requirements

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
- **WHEN** the permitted tool catalog exceeds the Messages API's strict-tool limit
- **THEN** the request includes every permitted tool, uses strict mode within the provider's limit, and checks the remaining tool calls against their closed input schemas before they can reach approval or act

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

### Requirement: Common external-model Conversation context

For [Hub #2180](https://github.com/jimmie-potts/agent-device-hub/issues/2180), Companions SHALL select permitted semantic inputs once for a given companion, active owner request, conversation and purpose, irrespective of the configured hosted supervisor. The supervisor purpose SHALL receive the active owner request, the eligible working context of that conversation, scoped device facts and explicitly requested bounded device-history summaries. Active knowledge and preference fields SHALL require an explicit common prompt grant for each field. The companion's knowledge switch SHALL still apply. Eligible earlier owner messages, companion replies and permitted tool results SHALL enter the working context in chronological order. The current request's wording SHALL NOT filter this history. Current device discovery and command guards SHALL resolve ambiguous references before a control can proceed. A steer that changes the subject SHALL rebuild the scope. A call SHALL deliver every newly admitted owner steer in the selected batch in order. Earlier companion replies and tool results SHALL retain proof of access to the original disclosures that their permission depends on. Credentials, raw logs, unrelated sessions and conversations, raw coding transcripts, media, bulk history and unrelated fields SHALL stay private. Other authorized non-device inputs SHALL remain within their existing purposes.

The hosted working context SHALL fit within the selected model's estimated token allowance, after reserving instructions, tools, current input, continuation and output. Individual message admission, transport safety and spend limits SHALL remain independent. When the eligible history outgrows its allowance, Companions SHALL preserve recent exchanges verbatim and automatically attempt a bounded summary of older exchanges. The summary SHALL carry relevant decisions, unresolved requests, device references and corrections as historical background. A compaction request SHALL send no tools and SHALL use the same pinned supervisor, with its existing spend, receipt and uncertainty controls. A missing or unusable compaction MAY leave only the eligible verbatim tail while original history remains privately readable. Past messages and derived text SHALL grant no approval or authority to act.

A saved summary SHALL be scoped to its conversation and covered sources. Before reuse or disclosure, Companions SHALL recheck the covered source versions and currently applicable grants. An edit, removal or revocation SHALL prevent disclosure of stale derived text. Companions SHALL NOT repeat a compaction with an uncertain receipt under a new identity merely to produce the same summary.

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

## MODIFIED Requirements

### Requirement: Configured model provider

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. The module SHALL take a companions section, as every configured module does; with an empty section or one that names no provider, the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file, and MAY name `assistant.prices` with the input, output, five-minute cache write and cache read prices of each model in US dollars per million tokens, which override the built-in table; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret, with a malformed price table or with an unsupported provider. A section without prices SHALL start the module and run with daily pacing at the built-in prices. A 400 `invalid_request_error` whose message starts with "You have reached your specified API usage limits" or "You have reached your specified workspace API usage limits", or a 429 `rate_limit_error` whose `error.details.error_code` is `enforced_spend_limit_reached`, SHALL end the task with the capacity code and a conversation message naming the monthly spend limit at Anthropic, with nothing more sent for that turn and no retry; no other 400 or 429 SHALL be read as a spend limit. Every profile, `bunny`, `reachy` and `microduck`, SHALL use the configured provider and model ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)) with the same effort, key, prices, per-turn limits, prompt caching and shared spend limits; without a provider, or with `assistant.provider` `synthetic`, every profile SHALL use the labelled synthetic provider. The section SHALL have no per-profile provider or model, and only a test or harness MAY give one profile another provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results, the fixed instructions, the current Hub mode and the prompt context that the sectioned context builder assembles for the task's companion, as "Sectioned companion context" specifies ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)): its curated persona, the owner's active knowledge notes once the owner turns them on for that companion, the owner's currently active explicit preferences, an empty long-term memory slot and the recent messages and tool results of the task's own conversation, read from the module's own records at each model call and rendered as owner data that grants no tool, permission, approval or device authority. No inactive or historical entry, removed message, other conversation, other companion's message, companion exchange or private context document SHALL enter the prompt. Each section SHALL keep to its own byte budget and state what it left out; nothing SHALL be truncated silently, and an over-budget section SHALL NOT refuse the call. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Each hosted request SHALL ask for automatic prompt caching with one top-level `cache_control` of type `ephemeral`, with the tools, the system prompt and the replayed transcript first and byte-stable between a task's calls, and the system prompt SHALL place the context sections in their fixed order, stable ones first and the recent conversation and the Hub mode last, as two text blocks: the instructions, the personality, the fixed rules, the knowledge notes, the preferences and the memory slot in the first, which carries its own `cache_control` breakpoint of type `ephemeral`, and the recent conversation and the Hub mode in the second, so a later task's request keeps the earlier one's tools and first system block byte-identical and can read them from the cache, and SHALL report usage by class: uncached input, output, cache writes and cache reads; a report without input or output counts, or with a count that is not a whole number, SHALL be unreported. Public state SHALL carry the provider, model and allowed tool names.

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

## ADDED Requirements

### Requirement: Sectioned companion context

One context builder SHALL assemble each model call's prompt context for the task's companion as named sections in a fixed order, each with its own budget in UTF-8 bytes of its rendered text ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)): personality, the curated persona (4 KiB); knowledge, the owner's active knowledge notes by title and text (32 KiB), off until the owner turns it on for that companion; preferences, the owner's active explicit preferences by title and text (32 KiB); memory, a long-term memory slot that holds nothing yet (16 KiB); and recent, the recent conversation (48 KiB and at most 48 messages). The stable sections SHALL come first and the recent conversation last. The recent conversation SHALL hold only the task's own conversation's saved owner messages, companion replies and tool results, such as device reads, worker reports and refusals, up to the last message saved when the task started, oldest first, so it stays the same for all of the task's calls; a later message waits for the next task. Each line SHALL name the saved message's identity, its speaker or tool and an artwork attachment's request identity and description. It SHALL NOT hold another conversation, another companion's messages, a companion exchange, a removed message, a message the profile may not read in that conversation, as the history page reads them, or an imported message, which stays historical until the owner selects it for a copied context. When the owner removes an owner message of a task, its opening message or an answer, that task's tool results SHALL leave the recent section too, while its reply stays until the owner removes it (coordinator decision, 2026-11-24). A correction's meaning SHALL be the saved text. A task saved before this boundary existed SHALL have an empty recent section. A section over its budget SHALL keep what fits, the recent conversation its newest messages and the others their first entries, and SHALL state in its text how many items it left out; the recent section SHALL count in that statement the messages beyond its 48-message bound. The section texts SHALL frame their content as data that grants no tool, permission, approval or device authority, and the recent section SHALL tell the model to check current state with a tool before proposing a change and to ask the owner when a reference could mean more than one thing. A follow-up that names a subject from recent context SHALL still pass every current capability, guard and approval check of the proposal it leads to. Each companion SHALL have a saved knowledge switch, off until the owner turns it on with a knowledge command checked by its own revision scope. An authorized reader SHALL be able to read the context preview, `assistant-context`, for a profile: the builder's own sections, exactly as the next model call would send them, either the next call of the current conversation's unfinished task or that of a new message's task, with each section's budget, state, counts of items sent and left out, bytes and text; the read SHALL change nothing. `read_saved_art` SHALL name each listed artwork's source request, so an attachment's request identity leads to its artwork.

#### Scenario: Follow-up sees the earlier exchange
- **WHEN** the owner asks a question whose task reads a tool and replies, then sends a follow-up
- **THEN** the follow-up's first call carries the first task's message, tool result with its tool name and reply, each with its saved message identity, and not its own message, which is its transcript

#### Scenario: The section is fixed when the task starts
- **WHEN** a message is saved in the conversation while a task waits on its question, and the owner then removes an earlier message
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
- **THEN** each preview's sections equal the sections the next model call sends

#### Scenario: Follow-ups across subjects
- **WHEN** after discussing one synthetic light the owner says "dim it", after discussing two the owner says "dim it" again, and after the light is removed the owner names it
- **THEN** the first proposal names that light bound to its current configuration and nothing is sent before approval, the second leads to a clarification naming both, and the third is refused with nothing sent
- **AND** "show that animation" after a synthetic striped pennant was attached resolves through its request identity to that artwork rather than another library item, "investigate that" after a synthetic playback warning drafts a delegation brief with the symptom for approval, and a question about the second of two check results in an earlier worker report is answered without a tool call

### Requirement: New conversation

The owner SHALL be able to start a new conversation for a profile from the Conversation page ([Hub #2029](https://github.com/jimmie-potts/agent-device-hub/issues/2029)). The module SHALL take it as a staged `new-conversation` input naming the profile and the assistant revision read, checked against the profile's current conversation as any conversation command is, and admitted while conversation is off. It SHALL be refused with `invalid-state` while the profile's current conversation has an unfinished task: running, waiting on a clarification, an approval or the coding worker, paused or uncertain (owner decision 2026-11-24); a profile SHALL have at most one unfinished task. It SHALL also be refused with `invalid-state` while the profile has no conversation or its current one holds no message, so repeated requests cannot add empty conversations; the page disables the button with the note "This conversation is empty. Send a message first." Otherwise the profile's current conversation SHALL become a new one with its own identity, so its own session on the devices, title, running slot and change revision, and both conversations SHALL count as changed. The new conversation's recent context SHALL start empty. Public assistant state SHALL list each profile's latest task in its current conversation only. The earlier conversation SHALL keep its messages, title and last session report, and SHALL stay readable by its identity in the recent view, without a current task; a read for a conversation that is not one of the profile's SHALL be not found. An authorized reader SHALL be able to list a profile's conversations, 16 a page with an offset cursor: the current one first, then the others by their last message, newest first, and those without messages last, each with whether it is current, its message count, first and last message times and published title; Details SHALL offer the older pages. The page SHALL offer New conversation beside Details, disabled while the conversation's task is unfinished with the note "Finish or cancel this conversation's task first.", and SHALL list the profile's conversations in Details, where an earlier one opens read only with no composer and a way back to the current one. An archive export SHALL list each profile's current conversation after its earlier ones, with no change to the archive format, and an archive import SHALL accept a profile's earlier conversations, SHALL NOT move a current one, and SHALL make a profile without one take the archive's last conversation of that profile, so a round trip restores the current conversation.

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

#### Scenario: Archive round trip
- **WHEN** a store whose current conversation is C imports another store's earlier and current conversations, exports, and a fresh store imports that export
- **THEN** C stays current in the first store, is listed first there, and is current in the fresh store

#### Scenario: Archive with earlier conversations
- **WHEN** an archive holding a profile's earlier and current conversations is imported into an empty store and into its own store
- **THEN** both imports are accepted, the empty store's current conversation is the archive's latest, the earlier one is readable, and the source store's current conversation does not move

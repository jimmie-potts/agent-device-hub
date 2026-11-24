## MODIFIED Requirements

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

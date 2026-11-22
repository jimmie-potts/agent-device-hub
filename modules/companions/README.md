# Companions

One optional, statically shipped module owns fixed-text Reachy cards, the
B.U.N.N.Y. conversation and its assistant tasks, explicit private preferences
and companion knowledge. Reachy consumes
qualified first-live coding opportunities from the authoritative core and defaults
to disabled. Enable it on its Reachy page in the existing React dashboard; category mute and a one-hour
social snooze use the existing tracked command path. Settings completion means
the controls were saved; fixture completion means its synthetic input was
admitted. Card decision/publication and visibility are separate. Session attention remains
available independently of this module.

Reachy uses fixed phrases with seeded variation and no model account, camera
or sensors. Optional speech uses one explicitly selected browser endpoint. Approval cards ask the human to review the
request; turn-ended cards have no response content or task-result evidence.
Cards identify their source/session, evidence, and decision reason. Publication
is not evidence that someone saw a card.

The module syncs sessions and Hub mode from `bunny/core`; it owns no second
lifecycle reducer or mode store. It keeps settings, at most 128 admission records and 4,096 consumed-origin receipts,
separate live/scenario social allowances, and the last presentation in its own
private SQLite file. Pending candidates are in memory only: one active and at
most one waiting in each category. Coding attention survives Work/Quiet. A
question, input request or approval takes priority over background cards,
social cards, suggestions and automatic speech for 30 seconds from its own
evidence instant, on the reporting host's clock as the core's opportunity sets
it. The window is held in memory from admitted coding-attention opportunities
and ends early when the attention item clears. The question stays shown on
every status device afterward. Unrelated progress raises no opportunity, so it
does not renew the window, and a restart opens none. When the reporting host's
clock runs ahead of the hub's, or 30 seconds or more behind it, the core raises
no opportunity, so that question gets no window. Social scenarios require Free,
known non-busy/non-media facts and no question window or snooze. Their shared allowance is three episodes per
local day, three hours apart across midnight. The local day uses the host's
IANA timezone, shown with the controls. Scenario records never consume a live
social slot or establish household perception.

Labelled arrival/visit and mixed question/arrival fixtures enter the same
rules/text/presentation path with identity and location unknown. Ordinary core
snapshots, duplicates, outbox recovery, reconnect, restart and return to Free
never create reaction opportunities. A saved card is restored as history.
Enablement, mute, mode, the opportunity's match to its session (generation,
identity, turn, and its attention item or notice) and expiry are checked after
asynchronous waits and immediately before new publication. The module reads
sessions through the shared session read function. No session freshness,
restart or age term refuses a card.

From the root with Node 24, run `npm run build`, `npm run typecheck`,
`npm run lint:js`, `npm run test:companions:built`, the affected runtime/event
checks, `reachy-text` catalog and the runtime dashboard browser journey.
These checks use synthetic inputs and private disposable stores. Installed
client smoke and desk installation are separate evidence in the owning issues.

## Reusable companion cards

Home and the Reachy/MicroDuck pages use the same quiet glass cards. Add either
through **Edit Home → Add card**; Reachy stays optional and existing MicroDuck
placements keep their identity. Adding or opening a card enables no text or
speech. Illustrations remain mounted while tabs change only the controls.
Long messages stay readable, and changing tabs preserves the card's dimensions
for unchanged content.

The Reachy card reads its `companion-state` copy through the SDK's shared
`followCopy` (#1540). A read refused with a code that may clear, such as
`unavailable`, is read again on its own after 1 s, doubling to 30 s. Until
then Reachy shows as unavailable, its saved reaction stays history and speech
is not live. A final refusal waits for a reconnect. Only the read repeats; no
setting, fixture or speech command is sent again.

Reachy's **Latest**, **Controls** and **Voice** keep fixed-text reactions,
category mute, social snooze and browser speech separate. Muted categories are
struck through. **Evidence & tools** on its page retains provenance and labelled
fixtures; Coding suggestions remains below the card. The Voice face stays
mounted when hidden, so switching tabs does not withdraw an explicitly enabled
endpoint. Removing the card or navigating away closes that endpoint and requires
fresh enablement. Voice requirements explains qualification and availability.

MicroDuck's **Meaning** shows one latest intended meaning, original time and
provenance, with playback still unknown. **Conversation → Choose conversation**
lists stored exchanges containing Reachy and MicroDuck; **More conversations**
loads the next existing bounded page. Records have participant/identifier labels,
not saved topic names. **Use conversation** changes the existing selection;
Cancel leaves it alone, and **Clear selection** retains history. Read-only or
stale contexts cannot change it. **View conversation** opens separate permitted
history. Disconnection, denied access and replacement sync hide private card
content; obsolete reads cannot restore it. Browsing produces no dialogue, audio,
capture or robot output.

The assistant persistence qualification uses `node --test
modules/companions/dist/tests/checkpointer.test.js` after the root build. It
opens SQLite through the SDK, terminates a disposable process after a saved
interrupt and resumes in a fresh process. The existing companions CI test
discovery includes it; pending-write and namespace checks use the same saver.

## Browser speech

The speech coordinator consumes only newly admitted live cards. It holds one
selected connection-bound browser endpoint, one active utterance and at most one
pending card. Text enablement does not enable speech. An explicit endpoint enable
action declares availability for that connection; reconnect, navigation, endpoint
loss and runtime restart require fresh enablement. Old cards never catch up.
Scenario fixtures remain silent. Quiet, category mute, missing live state and
changed or expired source evidence suppress speech while visual attention keeps
its existing behavior. Final checks reuse the card's admission and policy owner.

On the Reachy page, **Enable spoken alerts in this tab** declares availability
only for that mounted, connected page. **Stop speaking** cancels audio without
cancelling a coding task. **Mute spoken alerts** cancels audio and withdraws
availability. The page states that calls and other applications are not detected;
the operator must mute before interruption-sensitive activity. Playback callbacks
and the tracked operation result are shown separately. Neither proves hearing.

The selected installation supplies `modules/companions/speech-qualification.json`
under its private runtime state directory. The file must be a regular, single-link,
owner-only file owned by the runtime user, no larger than 4 KiB. The module reads
it once at startup. Its closed `browser-speech-qualification/1.0` document contains
`browserVersion` as four numeric components, `platform: "macos"`, a canonical UTC
`qualifiedAt` timestamp and `voice` with the exact `name`, English `lang` and
`voiceURI`. The installed qualification procedure supplies these observed values;
creating a file alone does not qualify a route. Keep the receipt and its supporting
audio, OS and network evidence private. It stores no availability or queued text.

Missing or invalid qualification leaves speech unavailable and text companions
usable. The authenticated page reads the receipt and checks Google Chrome and
macOS locally with a five-second bound. Browser identity stays local. The receipt's
`browserVersion` records the qualification version; a Chrome update does not
invalidate qualification. Missing browser identity or a different browser or
platform leaves speech unavailable. The browser
then verifies the exact local English voice on explicit enablement and before each
utterance. No settings, microphone or default voice are changed.

The core's internal `companion-speech-dispatch` adapter accepts only the companions
source and sends one tracked `companion-speech-play` operation back to that owner.
Ordinary dashboard and MCP command routes refuse all internal speech families.
The operation reuses the tracker's five-second admission and thirty-second outcome
budgets. The module saves responsibility on its existing SQLite connection before
accepting, then sends one live command to the selected endpoint. It bounds its
receipt wait to twenty-five seconds and a Stop receipt to five seconds.

Ordered start/completion receipts can complete the tracked operation. Stopped
playback retains partial-output evidence and does not claim the sentence finished
or was heard. Missing or contradictory receipts leave speech unavailable and
prevent replacement. A late definitive cancellation can release the reservation,
but requires fresh enablement. Unresolved responsibility survives restart as
uncertain; there is no restored candidate, endpoint or automatic resend.
Outcomes use the shared outbox, preserving their identity during republication.
After restart, an orphaned uncertain operation offers **Recover voice**. Stop
playback in all earlier voice tabs or close those tabs, then check the confirmation
and recover. The page also cancels local synthesis and requires it to be idle.
Recovery records the operator acknowledgement separately; it never changes the
old uncertain result into completion or stop evidence. Voice stays off until a
fresh Enable action. The old utterance never replays. A live operation or selected
endpoint, stale recovery request or storage failure prevents recovery. Each new
uncertain operation needs its own recovery. These controls use the existing
connection-bound endpoint API with the 2.1 recovery action and speech state;
2.0 messages remain supported. The additive private `companion_speech_recovery`
table keeps the operation, request, endpoint, trace and acknowledgement time.
Acknowledgement and state revision commit together; old speech rows are retained.

Stop and mute clear pending work. Higher-priority attention waits for confirmed
cancellation before replacing lower-priority output.

The same coordinator and endpoint speak B.U.N.N.Y.'s replies to typed requests
(Hub #500, first slice). Open **Voice** in the composer toolbar to enable
spoken replies, mute them, inspect readiness or recover an eligible earlier
operation. Enabling makes this tab the speaker for replies and eligible Reachy
alerts. **Stop speaking** remains available during local playback, including
inside **Details** when it opens as an overlay. Closing Voice or Details,
changing profiles or resizing leaves the selected endpoint in place. The
**Voice requirements and playback evidence** disclosure shows the qualification
and playback report.

When a turn ends with a result, a question for the owner or a refusal, the engine
offers that saved message once. **Read aloud** beside a saved assistant message
offers it again under its own request identity. The command receipt and playback
report appear separately. A reply ranks with coding
attention: it interrupts a notice or social card after confirmed cancellation,
waits for an active equal, and a newer pending reply replaces an older one, so a
stale answer never precedes the current one. Replies honor Quiet and need the
synced Hub mode; Reachy's text enablement and category mutes do not govern
them. A message over 512 characters, the driver's bound, stays written only.
A reply is stale sixty seconds after it was saved. Nothing is spoken for a task
that fails without a saved message, and startup reconciliation speaks nothing.
Stop speaking stops the audio of a question without answering or cancelling the
task; cancellation stays the separate **Cancel task** control.

The browser driver requires an exactly qualified local English voice, discovers
it within five seconds and sets it explicitly without changing the browser default.
Its playback deadline is fifteen seconds and cancellation confirmation has a
half-second bound. Unsupported or ambiguous output remains unavailable or
uncertain. Source tests use synthetic text and fake synthesis. These contracts
and source checks do not establish installed audio or human perception.

## Coding suggestions

On Reachy, choose a current coding session in **Coding suggestions**, then enter
one task ID, optional repository/base, full current and evidence head commits,
the actual UTC ISO observation time, and statuses/references for tests, build,
browser and accessibility. Passed, failed, skipped, unrun and unknown differ.
Passed/failed/skipped claims need a reference. Revisions and results are
owner-supplied and are never independently checked against a repository.

**Inspect coding suggestion** uses fixed templates: investigate a failed check,
or after passed tests propose an explicitly unrun build, browser or accessibility
check, in that order. Other evidence shows a gap. Turn endings alone provide no
result. The card shows known session/turn, source revision, statuses, references,
observation time and a five-minute deadline. Unknown turn/base/repository stays
unknown. Inspecting sends no input to the server and changes no clipboard.
**Copy coding suggestion** rechecks current source, policy and deadline, then
copies only on that click. No submission, execution, approval or model occurs.

Reachy enablement and **Turn endings** mute govern this optional preview; a
question's 30-second window takes priority. The page reads that window from the
live question card Reachy presents. The session's own silence never withdraws a
suggestion; the evidence's five-minute deadline does. A changed session revision clears check claims and
observation time. Editing any input retires the preview; changing task,
repository or commits also resets checks. Newer evidence supersedes older input;
older or contradictory equal-time claims cannot restore the prior preview.
Duplicates and SDK reconnect/sync admit no suggestion. The preview is unavailable
while a replacement settings snapshot is pending, including
SDK overflow resync with transport still connected. The per-copy SDK restart
callback clears readiness; only completed current settings sync restores it.
Input and preview stay in browser memory and are discarded on reload, navigation
or disconnect, with no durable
collection/archival acceptance. Keep credentials out of the fields. No diagnostic
record contains the input; the existing authenticated session/mode/settings sync
is unchanged. The shell supplies its existing core copies and live flags through
the optional SDK frontend context, without broadening module-scoped sync. No new evidence/proposal wire contract or provider seam exists.

Run the fixed-corpus `suggestions.test.js` after build and the existing
`test:companions:browser` journey for real form/clipboard, policy/context changes,
connection failure, keyboard and narrow layout. Source evidence establishes
neither installed-client usefulness nor physical acceptance.

## Conversation and assistant tasks

The **Conversation** page (`assistant`) is B.U.N.N.Y.'s text conversation beside
Reachy (Hub #46). The `bunny` profile talks to the provider the private section
selects; Reachy and MicroDuck keep the labelled synthetic provider, which makes
no network call and no paid usage. Activation defaults to off. The three
profiles keep separate conversation histories, with one unfinished task across
all of them and one graph invocation at a time.

Choose the everyday B.U.N.N.Y. assistant or a Reachy or MicroDuck demo under
**Conversations** in the dashboard's rail, from any page (Hub #1890). On a
phone, open the menu button first. Both demos are labelled Demo there, and the
page's one header row names the open profile beside **Details**. A dot on a
profile in the rail means that conversation needs your answer or approval. A
wait on the coding worker shows none, and neither does a conversation whose
state the page cannot read now. The Reachy and MicroDuck device controls and
the other companion pages are in the rail's **Devices** menu.

The rail's group is this module's own component (`ConversationRail`, exported
from the frontend entry beside the Home widgets). It follows `assistant-state`
through a read-only copy and reads a profile's recent history once for each
pending question, to tell a question for you from delegated work. The open
Conversation page shares what it has already read. The group sends no command
and opens no speech endpoint. The selected profile is kept in the page's memory
(`conversation-rail.ts`): returning to Conversation shows it again, and a
reload starts on B.U.N.N.Y.

The transcript takes the available height and scrolls above the composer. When
the screen is short or a decision needs more room, scroll the page to reach the
full decision and its controls. Conversation opens at the newest saved messages.
**Load earlier** fills the preceding gap without moving the message you were
reading. If replies arrive while you are reading farther up, **New messages**
jumps to the latest exchange.

Assistant replies use open text. Your messages sit in bubbles on the other
side of the same reading column, which aligns with the composer. **Tool result**
expands the full saved text in place. Long links, markup and line breaks appear
as saved. **Read aloud** sits below eligible replies. Longer replies explain
the speech limit and remain readable in full.

A fresh, empty history invites you to send the first message when input is
available. If history or input is unavailable, the page shows the reason.

Use **Send** for a message or **Answer** for a saved question. Enter submits
and Shift+Enter inserts a line break. Enter during text composition does not
submit. The composer shows the exact UTF-8 count starting at 26,215 bytes and
refuses drafts over 32,768 bytes. Each profile and pending question has its own
draft. Drafts remain after submission and clear on reload. You can browse
another profile while a task is unfinished. Follow the link beside the composer
to return to that task before starting another one.

**Voice** is in the composer toolbar. Open **Spoken replies** to enable output
in this tab, mute it, or inspect requirements and tracked playback evidence.
Use **Close**, Escape, or click outside to dismiss the panel. During playback,
**Stop speaking** stays in the toolbar and moves into the narrow Details
overlay while it is open.

Questions, approvals, worker waits and task controls appear above the composer.
A successful task leaves a short **Task completed** cue by the composer.
Open **Details** to inspect the task. Failed, cancelled, paused and uncertain
outcomes remain visible by the relevant controls.
An approval shows the full scope and the revision it applies to. A command
receipt reports what happened to the request separately from task completion.
Disconnected or stale copies retain loaded history and lock mutations.
**Stop speaking** controls audio only.

### Inspect conversation details

Choose **Details** beside the profile heading to open **Conversation details**.
The drawer shows the selected profile. On a wide screen it sits beside the
conversation. On a narrow screen it opens over the conversation. Its facts
scroll separately from the transcript. Choose **Close**, press Escape, or tap
outside the narrow drawer to return focus to **Details**. Closing it keeps the
draft and reading position. Opening Voice closes Details and opening Details
closes Voice.

Choose a section label to expand it. The sections start collapsed and keep
their open state while you inspect another panel or resize the page.

- **Capabilities** lists the provider, model, allowed and unavailable tools,
  and coding worker availability.
- **Task activity** shows the task, conversation and run IDs, status, counters,
  bounds, diagnostic code, saved question and answer, and settled successful
  control receipt. Pending and failed receipts stay beside the controls.
- **Usage** shows reported usage and the reservation against the task limit.
  A synthetic task may show **Unknown** usage alongside `0 / 1000000 units`
  reserved. Hosted tasks use reported tokens and leave the task's billed cost
  unknown. **Spend today** and **Spend this month** show the shared spend of
  every profile against the [spend limits](#spend-limits), naming any
  reservation still counted for a call without reported usage. **Prices**
  says whether the paid model has a configured price. When a paid profile's
  new message would be refused, its composer says why: a missing price or a
  reached limit.
- **Conversation settings** explains where submitted text goes and links to
  **Preferences** and **Companion knowledge**. An unfinished task prevents
  disabling the conversation.

In a synthetic session, ask about recent coding activity and answer the
clarification. Open **Tool result** in the transcript to read the saved result,
for example, `No coding agent session is known to the core right now.` Choose
**Tool result** again to collapse it. While a result is open, **Load earlier**
keeps the result expanded and preserves your reading position.

```mermaid
flowchart LR
  Page[Authenticated React page] -->|bounded private upload| Gateway[Existing gateway]
  Gateway -->|opaque input reference| Core[Core tracked dispatcher]
  Core -->|assistant-input / assistant-control| Module[Companions task owner]
  Module --> Graph[Turn → question | read tool | proposal → approval → act → turn]
  Graph -->|one request per model call| Provider[Synthetic script or Anthropic Messages API]
  Graph -->|approved mode-set| Dispatch[assistant-dispatch → core dispatcher → mode owner]
  Graph --> DB[SDK-owned SQLite connection]
  Module --> Outbox[Shared SDK outbox]
  Outbox -->|small assistant-state / control outcome| Core
  Page -->|authenticated conversation pages| Module
```

### Section, provider and permitted tools

The module's section of the private `runtime.json` is required for it to start,
as for every configured module; an empty section keeps every default:

```json
{"companions": {"assistant": {"provider": "anthropic", "model": "claude-opus-5-5", "effort": "medium",
  "titleModel": "claude-haiku-5-5", "tools": ["read_sessions", "set_mode"],
  "prices": {"claude-opus-5-5": {"input": 1.5, "output": 7.5, "cacheWrite": 1.875, "cacheRead": 0.15},
    "claude-haiku-5-5": {"input": 0.25, "output": 1.25, "cacheWrite": 0.3125, "cacheRead": 0.025}}},
  "secrets": {"anthropic-api-key": "/run/secrets/bunny/anthropic-api-key"}}}
```

The prices above are synthetic. Copy the provider's current price list into the
private section instead.

- `assistant.provider` is `synthetic` (the default) or `anthropic`. The Anthropic
  provider needs `secrets.anthropic-api-key`, the owner-only file holding the
  API key. The module reads it once at start, holds it only in the provider,
  sends it only as the request header and never stores, publishes or logs it;
  the runtime redacts it from its own records. `model` defaults to
  `claude-opus-5-5` and `effort` to `medium` (`low`, `medium` or `high`).
  `titleModel` names the small model that writes conversation titles (see
  [Conversation titles](#conversation-titles)) and defaults to
  `claude-haiku-5-5`. The synthetic provider takes none of the three.
- `assistant.prices` (Hub #2024) maps each model to its `input`, `output`,
  `cacheWrite` and `cacheRead` prices in US dollars per million tokens, as the
  provider's price list states them. `cacheWrite` is the five-minute cache
  write price, which the
  [Anthropic price list](https://platform.claude.com/docs/en/about-claude/pricing)
  states as 1.25 times the input price. The table is optional. When present,
  each entry needs all four prices, from 0 to 1000, for at most 16 models.
  Without an entry for the Anthropic provider's model the section is still
  accepted and the module starts, but every new turn and model call of that
  model is refused with `capacity`, naming the missing price, so spend stays
  bounded. Without an entry for the title model, the ledger refuses each
  title call the same way, nothing is sent, and the conversation keeps its
  earlier title or persona name. The module has no built-in prices. The
  synthetic provider takes no prices.
- `assistant.tools` lists the permitted tools by name, each once:
  `read_sessions`, `set_mode`, `delegate_coding`, `read_lifx`, `set_lifx_power`, `set_lifx_brightness`, `read_wemo` and `set_wemo_power`.
  The engine builds the model's tool
  definitions from the list at start and checks membership again when a call
  executes, so a changed section cannot widen an effect. The built-in
  `ask_owner` is always available; the synthetic fixture read is never listed.
- Requests go to `https://api.anthropic.com/v1/messages` through the module's
  own fetch with API version `2026-10-21`, carrying the fixed instructions, the
  current Hub mode, the task's transcript, the tool definitions marked strict,
  `output_config.effort`, one tool call per turn and the model's default
  thinking. There is no retry and no fallback model: a refusal ends the task
  `forbidden`, an error status maps once to `unauthenticated`, `forbidden`,
  `not-found`, `capacity` (a rate limit), `invalid-request`, `too-large` or
  `unavailable`, an unreadable answer to `invalid-message`, and output cut at the
  provider's limit to `capacity`. A lost answer or a transport error leaves the
  call uncertain. Usage is the sum of the tokens the provider reports (input,
  output and cache tokens); unreported usage stays unknown. A report without
  input or output counts, or with a count that is not a whole number, is
  unreported. The module enforces the [spend limits](#spend-limits); the
  dedicated Console workspace's own monthly limit stays as a second bound.
- Each request asks for automatic prompt caching with one top-level
  `cache_control` of type `ephemeral`, the five-minute cache. The API places
  the breakpoint on the last cacheable block. The tools, the system prompt and
  the replayed transcript come first and stay byte-stable between a task's
  calls, so a second call reads the earlier prefix from the cache and reports
  `cache_read_input_tokens`. A Hub-mode change or a preference edit changes the
  system prompt and starts a new cache entry.
- The model's own content blocks, thinking blocks included, are kept with the
  assistant item in the private transcript and replayed exactly as received,
  which the API requires for the turn whose tool call awaits its result. One
  tool call per turn is acted on; a further call in one answer is dropped with
  its block.
- The prompt holds the owner's typed text, the tool definitions and results,
  the fixed instructions, the current Hub mode and the prompt context: the
  profile's curated persona (name and character) and the owner's currently
  active explicit preferences by title and text, read from the module's own
  records at each model call, so an edit or **Stop using** applies to the next
  turn (Hub #507, decision 5 on #46 as amended on 2026-10-31). Preferences are
  framed as the owner's data that grants no tool, permission or device
  authority; permission is the allowlist and the core's dispatcher, never
  prompt text. No knowledge entry, conversation history, other task, inactive
  or historical preference or household record enters the prompt. The rendered
  context is bounded at 16 KiB; over it the call is refused before anything is
  sent, the task ends `capacity` and the conversation shows which bound was hit
  rather than truncating silently.

- With spoken replies enabled in a tab (see [Browser speech](#browser-speech)),
  the result, question or refusal that ends a turn is spoken once through the
  qualified local voice, whatever model answered; the voice never depends on
  the provider. **Read aloud** beside a saved assistant message asks to hear it
  again through the `speak` control, whose accepted receipt means the request
  was saved, while the playback report says whether the browser spoke.

### Artwork in replies

Allowlist `create_artwork` for B.U.N.N.Y. Conversation to offer a still image
or animated GIF. The approval names the artwork and discloses generation use.
Art queues the request under the existing allowance. The reply tracks that
specific job and displays the exact saved rendition or the job's outcome.
The animation stays on its first frame until played. Opening a conversation
or playing a GIF does not generate art or send it to a device. If the art is
removed from the library, the saved reply remains readable.

Allowlist `control_art_show` to use **Show on…** on a generated reply. Select the
browser or a configured display, then approve. When a create request also names
a display, the reply opens this choice with the intended destination selected.
Each display reports its own preparation and presentation results.

### Attach artwork

Use Attach or drop one PNG, JPEG, or GIF onto the Conversation message field.
The attachment stays private and opens in the Conversation artwork preview.
Choose Display now for a compatible display, Save to library for later, or
Display and save for both. The library and each display report their own
outcomes. A failed action can be retried independently. An uncertain action
stays visible without replay.

### Coding delegation

`delegate_coding` (Hub #502) proposes handing one bounded coding task to the
[coding worker](../../docs/coding-worker.md) on the owner's computer: the model
names an allowlisted repository and writes a brief; without a connected worker,
or with an unusable name or brief, the call is refused as a tool result and
nothing is proposed. The proposal is bound to the coding state's revision, so
a worker that connects, disconnects or starts other work between proposal and
approval refuses the dispatch with `revision-conflict`. An approved delegation
goes to the core as `coding-dispatch` and through its tracked dispatcher as one
`coding-run` the module answers: the coding coordinator saves responsibility,
sends one `coding-work` start to the worker's endpoint, reports the tracked
outcome succeeded when the worker reports it started (observed), failed when
the start is refused, and uncertain when no start arrives within twenty
seconds. The task then waits on a delegation only the worker's word answers;
the owner's input is refused for it, it counts no owner question, and **Cancel
task** asks the worker to stop. The worker's completed, failed, cancelled or
uncertain report settles the responsibility and resumes the task with the
result as the tool's later word, bounded text naming outcome, git facts, checks,
findings, limitations and usage (the model sees it as text naming the call,
since the call's own result was the hand-off acceptance and the Messages API
takes one result per call, Hub #1360); nothing is resent, and a restart or a lost
worker leaves the operation uncertain. One task runs at a time; the dispatch
carries twenty minutes, sixty turns and five dollars as bounds. The page shows
the worker's availability beside the provider. The worker's readiness (Hub
#1743: tool version, signed in or not, plan and the latest limit windows, each
unknown where the tool did not say) arrives on its enable and is published in
`coding-state/2.1`; a readiness report from the selected worker does not move
the revision a proposal is bound to. A result may also end `usage-limit`, with
the limit's window and reset time or unknown, or `waiting-for-owner`, with the
worker's question among the findings; neither is retried.

### Turns, tools and approval

A task runs turn → (question | read tool | proposal → approval → act) → turn
until the model answers without a tool call. `ask_owner` pauses the task with a
clarification question. `read_sessions` summarizes the core's synced sessions
through the shared session read function (provider, client, label or title, the
hub's status class and detail, work state and confirmation, attention and
evidence age; at most 16 sessions and 4 KiB) and needs no approval; an unsynced
copy says so instead of pretending the list is current. `set_mode` is a
proposal: the task pauses with an approval question naming the family
(`mode-set`), the target (`hub`) and the mode, and records the synced Hub-mode
revision seen when proposed; while the module's copy of the core is not synced,
or when the model names a value that is not a mode, the call is refused to the
model and nothing is proposed. Only the literal answers `approve` and `decline`
are accepted for it. Approval sends one `assistant-dispatch` command to the core,
which forwards an allowlisted `mode-set` through its tracked dispatcher as an
operation requested by this module, with the recorded revision as
`expectedRevision`. The dispatcher's answer becomes the tool result,
`accepted: …` or `refused: <code>` such as `revision-conflict` after the mode
changed by hand. The approval keeps the revision it was proposed against, so it
never overrides that manual choice; the result then says the mode changed since
the proposal and nothing was changed. The operation's outcome, inbox item and
history belong to the core: a stale refusal like this opens no inbox item,
because sending its saved revision again would always be refused (#1657). The
conversation never claims a device effect. The dispatcher's own
uncertainty, a reply deadline that passed while the mode owner held the
command, reaches the module as `uncertain-result` and leaves the call
uncertain like a lost answer. A decline sends
nothing. A tool the section does not list, or that the model names wrongly,
returns a refusal to the model and has no effect. An uncertain dispatch answer
leaves the call uncertain and the task refuses resume, as any uncertain call
does.

The synthetic provider is a fixed script behind the same contract: it proposes
the mode the message names when `set_mode` is allowed, otherwise asks its fixed
clarification question; after the answer it reads `read_sessions` when allowed
or its immutable fixture; then it composes a result from the evidence it was
given. The `assistant-task` and `assistant-mode-approval` catalog scenarios and
the companions browser journey walk those paths.

### Identities, staging and bounds

`assistant-input/2.0` carries only a request ID and opaque input reference.
Private staging binds the text to that request, profile, expected state revision
and, for an answer, the task and question. Admission checks the binding again.
A five-second staging deadline and eight-input bound apply before admission;
admitted text and execution evidence are retained privately. Public state carries
`provider`, `model` and the allowed tool names, plus task summaries with
identifiers, status and counters, never a key, prompt or transcript. Existing
read-scoped clients can read the private conversation route; it does not grant
control or add a conversation MCP tool.

A conversation ID is stable per profile; each task has its own ID. LangGraph's
`thread_id` is the task ID. The saved question ID survives restart, while each
explicit activation creates a new run ID. Call receipts use the task ID and the
graph's logical step, so a new run cannot repeat a saved effect, and the
transcript item a call produced is found again by that effect id. Future
workspace records can reference `{owner: "companions", conversationId, taskId,
questionId?}`. Coding-worker dispatch has a separate owner and is not a model
provider here.

The SDK owns the only SQLite connection. Domain records, private messages,
questions/answers, runs and call receipts are inspectable in `assistant_*`
tables beside the existing Reachy records. One revision sequence covers all
companion state families; one SDK sync owner serves their combined or separate
snapshots. Domain changes and their outcomes commit in the shared outbox
transaction. The module-local saver pins LangGraph 1.5.0 and checkpoint 1.2.0,
serializes checkpoints and pending writes, and uses synchronous graph
durability. Checkpoint and application projections are separate commits:
startup reads the checkpoint to repair that gap without invoking the graph.
Interrupt nodes do no external work before interrupting. A saved answer or
decision can be explicitly resumed after a crash between its admission and
continuation. Startup and outbox republication never activate work. A running
task is recovered as paused, waiting, completed, failed or uncertain from its
durable evidence. A receipt without a result keeps its reservation and cannot
be retried automatically; a call the provider answered definitively is failed
with its code. Tasks saved by the earlier fixed graph (`synthetic-1`) retain
readable history and refuse resume. There is no execution queue.

| Bound | Per task or request |
| --- | --- |
| Calls and questions | 50 model calls, 40 tool calls, 10 questions |
| Active time | 40 minutes; human waits and downtime excluded |
| Deadlines | Model 6 minutes, tool 30 seconds, control admission 5 seconds |
| Text and working state | Owner message 32 KiB, persona and preferences 128 KiB, result 8 KiB, a model reply with its blocks 16 KiB, working transcript 1 MiB, staged input 193 KiB, serialized graph and pending writes 256 KiB each |
| Usage | 1,000,000 units per turn; each model call reserves its request's UTF-8 bytes plus 8,192 framing units and 16,384 output units before it is sent; a unit is one provider token or one fake synthetic unit |
| Private read | At most 16 messages and 512 KiB per page, advancing cursor |
| Spend | $20 a day and $150 a month across all profiles; see [Spend limits](#spend-limits) |

A turn is one task: one owner message and everything it causes. A call that
would pass a limit is refused before anything is sent. The task ends with
`capacity`, and the conversation shows a message that names the limit, such
as "This turn reached its limit of 50 model calls." A request's bytes bound
its input tokens because each token encodes at least one byte of text.

### Spend limits

The assistant's paid model calls may spend $20 a day and $150 a month across
all profiles (Hub #2024). The day and the month are the runtime host's local
ones and start at local midnight. A call counts on the day it was reserved.
Coding-worker runs use the coding worker's own sign-in and are not counted.

- **Reservation before dispatch.** In the transaction that saves a paid call's
  receipt, the module reserves the most the call can cost in its private
  SQLite ledger (`assistant_spend`). Every input unit is priced at the dearest
  input class, and every output unit at the output price. When that
  reservation would pass the daily or the monthly limit, the call is refused
  with `capacity` and nothing is sent. The conversation then shows the
  limit, for example "The daily spend limit of $20.00 would be passed: $19.80
  is counted today and this model call could cost up to $0.42. Nothing was
  sent."
- **Reported usage.** The answer's reported tokens, priced by class from
  `assistant.prices`, replace the reservation in the same transaction that
  saves the answer. An answer that arrives after the call's deadline, while
  the module still runs, also replaces it.
- **Unreported usage.** A call whose usage is never reported keeps counting
  its full reservation, never zero. Examples are a lost answer, a deadline, a
  crash or an error status. Its turn usage also stays unknown.
- **New turns.** A new message to a paid profile is refused with `capacity`
  and a detail that names the reason when its model has no price, or when what
  remains of today's or this month's limit is below the smallest possible first
  call: 8,192 framing units at the model's dearest input price plus 16,384
  output units at its output price. So a message is not admitted only to fail
  at its first model call. A call already sent finishes, and the next call is
  refused. The synthetic profiles cost nothing and keep working.
- **Restart.** The ledger is in the module's database, so it survives restart
  unchanged. Startup never settles or releases a reservation.
- **Other calls.** A model call outside a task, such as a conversation-level
  call, records its spend through the same ledger (`AssistantEngine.spend`).
  It calls `reserve` before the request leaves and refuses the call when
  `reserve` answers a message. When the answer arrives it calls `settle` with
  the reported usage, or with null when the answer is lost. `inputBound(request)`
  bounds the request's input units; `LIMITS.outputUnits` bounds the answer.

**Details** reads the shared totals from the private `spend` content route
after each assistant-state revision. The route returns the day's and month's
counted millionths of a dollar, the limits and the count and amount of
reservations without reported usage. It also names the B.U.N.N.Y. profile's
paid model with its smallest possible call, or null for that amount when the
model has no price, and null for the synthetic provider. It carries no text,
call or task identity.

Unknown usage stays unknown. A crash or timeout keeps the call's reserved time
and units; explicit continuation never resets them. Cancellation first saves a
generation fence, then requests abort. Late replies may add bounded receipt
evidence but cannot continue the graph or undo cancellation. If SQLite cannot
save the fence, cancellation is refused. A successful command receipt means
that local control was saved; task completion is reported separately.

### Conversations on the status devices

Each profile's conversation is also one session in the hub's shared session
model (Hub #505), so the status devices, Habitat, the dashboard and automations
show it beside Codex and Claude sessions. Each task in the conversation, one
owner message and everything it causes, is one turn of that session.
Conversation stays the place to answer and approve.

| Latest task | Session status |
| --- | --- |
| Running | Working |
| Waiting on a clarification or an approval | Needs the owner (input or approval) |
| Waiting on the coding worker | Quiet, idle: no owner attention and no running-work claim |
| Paused | Quiet, interrupted |
| Uncertain | Unknown |
| Succeeded, failed or cancelled | Finished, detailed by the result |

The session ID and the ordering epoch are the conversation ID, a turn is one
task by its task ID, and an attention item is the saved question's ID. An
answered question, a resume and the new run either starts stay in the task's
turn; only the next task starts a new turn, which supersedes the earlier task's
notice as a new Claude prompt does. The source is `bunny`/`assistant` on the
core host. The session is titled by the conversation's title (see
[Conversation titles](#conversation-titles)), or by the persona until one
exists: `B.U.N.N.Y.`, `Reachy` or `MicroDuck`. Every
transaction that changes a task also adds the `lifecycle/2.2` observations that
move its conversation's session there, from the module's own source and on the
conversation's one ordering sequence, and records the last state it reported
in `assistant_reports`, one row per conversation. When one transaction ends a
task and starts the next, the earlier task's turn end comes first. Nothing else
reports: a page or history read, an enable, a spoken reply, a startup
reconciliation that keeps a task's state, and outbox republication report
nothing new. The first start of this release records each conversation's
latest task as already reported, so an ended task appears only when the
conversation next changes, except a task that waits on the owner's answer or
approval: that start reports it at once, so it shows on the devices as needing
the owner.

A failure stays unread on the devices until it is acknowledged. A task the
owner cancels shows its result but leaves no unread notice: its notice is
acknowledged for every consumer at once. Detail-aware surfaces name the
result, such as `Failed · unread` on the dashboard. After a task ends, the
session reads as a Claude session does after its turn ends, finished until it
is acknowledged or the next task starts, and the session itself never ends. It
expires a day after its conversation's last change, as every session does;
the conversation, its tasks and their questions stay here, and the next change
shows the session again on the same ordering sequence. Each conversation
counts once toward the hub's limit of 128 sessions, and at the limit it may be
left off the devices until there is room. A session holds at most 128 notices,
one per ended task, and 256 ordering watermarks, one per question and one for
the work, so a conversation of about 128 tasks without a day's break stops
updating on the devices until it expires; the core refuses its further
observations with `capacity`. No Reachy or MicroDuck
card is raised for a conversation, and `read_sessions` and coding suggestions
list coding agent sessions only. Native worker reporting is not part of this.

### Conversation titles

Each conversation gets a short title that a title model writes, led by the
GitHub issue it is about, such as `#1896 Session tracking` or `pixoo#14 Boot
channel` for an issue in another repository (Hub #2025). Until a title exists,
the persona name stands.

Only a profile with a real title model gets titles: B.U.N.N.Y. on the
Anthropic provider, with `assistant.titleModel`. Reachy and MicroDuck, and
B.U.N.N.Y. on the synthetic provider, make no title call and keep their
persona names until the owner renames them. When a profile gets a real model
(Hub #2026), it gets titles by the same rule. A test or harness can inject
`SyntheticTitleProvider`, which writes the fixed title `Synthetic conversation`.

- **When.** A title is written after the first message of a session
  appearance, again at the third task of that appearance, after the first
  message when the session reappears after a day without lifecycle evidence,
  and when a coding hand-off is accepted, so an issue named only in the brief
  can lead the title. The title call runs beside the task and never delays,
  fails or rolls back it.
- **What the model sees.** The fixed title instruction as the system prompt
  and the conversation's last eight owner and assistant messages, escaped and
  cut to 2 KiB. No tool result, preference or knowledge entry is sent.
- **What is kept.** After the issue reference, the description is cut to 40
  characters at a word boundary. Quotes, markdown, a `Title:` label and
  trailing punctuation are removed. An answer that is empty, a placeholder such
  as `Title`, or not session display text (a control character or a
  recognizable credential) is no title. So is an echo: before the description
  is cut, the whole answer is compared with every owner and assistant message
  in the prompt, ignoring case, spacing, surrounding quotes and trailing
  punctuation, and a cut title that is the start of such a message is refused
  too. The guard catches verbatim repeats only; a paraphrase or a reordered or
  partly repeated message is not detected. A failed, refused or invalid first
  title leaves the persona name; a failed refresh keeps the earlier title.
  Nothing is retried.
- **Where it goes.** The conversation's recent messages go to Anthropic's
  title model, as the turns' messages go to the turn model. The title is
  stored on the conversation with its source, generated or the owner's, and
  published at once as display metadata in `lifecycle/2.3`, which changes only
  the session's title and keeps no expiring session alive, and on every later
  lifecycle observation. A generated title has source `provider` and the
  owner's has source `user`. From the session it reaches the status devices,
  the dashboard and Habitat, the core's session history and read tools such as
  the `core_sessions` MCP tool, Tidbyt's cloud rendering of the status tile,
  and, once it exists, the decision maker's Decisions input, which
  [ADR 0011](../../docs/decisions/0011-private-personal-data-retention.md)
  allows to receive session titles. The assistant's own `read_sessions` leaves
  native sessions out.
- **Diagnosis.** Each title call's record keeps the model's raw answer, at
  most 1 KiB, privately in `assistant_title_calls`, so an invalid outcome can
  be explained. It reaches no log, trace, diagnostic or published record.
- **Rename.** Open **Details**, then **Conversation settings**, and enter a
  name under **Rename conversation** (at most 80 characters). The page sends
  the `rename` action of `assistant-control/2.1`. The owner's name replaces any
  generated title, and the model never changes it again. A title call still in
  flight is abandoned, and an answer that arrives after the rename is
  dropped. A name that is not display text is refused with `invalid-request`.
- **Spend.** A paid title call reserves its most expensive cost in the shared
  spend ledger as a conversation-level call before it is sent, and its
  reported usage replaces the reservation; a lost or failed answer keeps the
  reservation counting. A call that the spend limits or a missing price
  refuse is not sent, and the persona or earlier title stays. Title calls
  count toward the shared spend limits and toward no task's limits. Without
  a price for the title model in `assistant.prices`, every title call is
  refused this way. Each call is also recorded on its conversation in
  `assistant_title_calls` with its model, status, outcome and reported usage.

The title instruction, prompt and normalization are adapted from OpenAI Codex
(Apache License 2.0) and T3 Code (MIT License); see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

### LIFX status and controls

Allow `read_lifx`, `set_lifx_power`, or `set_lifx_brightness` in the private
Conversation tool list. Read status by a configured light name or routing ID.
A read reports the last observation and supported controls. Conversation labels an observation stale after 30 seconds or when it predates a command. An explicit stale read requests the owner's rate-limited refresh. An unchanged result can retain its original observation timestamp. If several lights
match a write, Conversation asks for the exact ID before proposing it.

The approval shows the selected light and value. It binds the action to the
light's configuration revision and generation. The core forwards the approved
action through the tracked dispatcher. Expand **Tool result** to see the
operation result and its available evidence. Device availability, changed
configuration, a restart, or a revoked tool can invalidate an approval.

### Wemo status and power

`read_wemo` reports the plug's observed power, freshness, and hold state.
`set_wemo_power` proposes on or off for one named plug. The approval binds
the Wemo owner and the plug's configuration revision and generation. The
core tracks the existing power command. The plug's queue and hold still
govern the write, and the core's existing maximum-on policy still applies.

### Device controls and saved content

Enable `read_devices` to look up installed devices by name or ID. Results
identify the owner, available observations and enabled controls. Use
`read_playback`, `read_roborock` and `read_volcano` for their own status
records. Roborock has no cleaning command in this integration. Volcano
publishes equipment status and supports editing the software session gap.

Each added command has its own name in `assistant.tools`. The
[Conversation action catalog](../../packages/event-contracts/src/v2/assistant-actions.ts)
lists the exact command families and eligible owners. Command names take
the form `control_<family>` with underscores. Existing LIFX and Wemo power
permissions keep their original names. Conversation shows the target, owner
and exact values for approval. The existing owner command checks device
revisions, generation and capability. The tracked operation shows acceptance
and the available effect evidence separately.

`read_saved_art` offers saved artwork IDs and compositions. After approval,
`control_art_show` uses the existing `art-show` preparation and presentation
path. `read_art_show_effects` uses the approved request ID to show each
display's preparation and presentation evidence. A skipped phase shows its owner refusal.
If the evidence is unavailable, the phase reports that separately.

For light shows, `create_light_show_draft` uses a Nanoleaf starter timeline.
`edit_light_show_cue` applies edits against the current draft revision.
`preview_light_show_draft` shows cue timing, colors and intensity.
`save_light_show` uses a separate approval to write a version to the existing
Nanoleaf catalog. Each immutable version can confirm its save by request
identity after a lost reply. If the save expires without a matching version,
the owner can make a new approval against the catalog's current revision.
`read_light_shows` pages through drafts, saved versions and lighting sessions.
Supply an exact ID for its records, or leave it empty to list a category.
`control_music_lighting_control` approves playback of one exact saved version
on an eligible light. Stop, pause, resume and seek bind the active generation.
Drafting, editing, previewing and saving send no lighting command.

### Conversation history contract

The existing authenticated `GET /modules/companions/content/conversation`
read accepts `profile=bunny`, `profile=reachy` or `profile=microduck`. With
only `profile` and optional `after` it returns version 1, in ascending order
after that sequence (default 0). The first page includes `currentTask`; later
pages return `currentTask: null`. The existing panel still uses version 1.

For version 2, add `view=recent` and omit `after`:

| Request | Result |
| --- | --- |
| `profile=bunny&view=recent` | Newest saved window and latest task/question |
| `profile=bunny&view=recent&before=<older>` | Older window, with `currentTask: null` |

The response is `{version: 2, profile, conversationId, messages, currentTask,
older}`. Messages retain the version 1 fields and full saved text. Each window
contains at most 16 messages in ascending sequence order, chosen newest first.
The body is at most 65,536 UTF-8 bytes, including the cursor and current task.
If the first whole message and required metadata cannot fit, the owner returns
the shared `capacity` error rather than skipping or shortening the message.

Pass `older` back unchanged as `before`. It is a canonical base64url encoding
of the profile, conversation ID and a positive safe integer sequence. It reads
strictly below the oldest returned sequence and only in that profile and
conversation. A null cursor means no older messages remain. A profile without
a saved conversation returns a null conversation ID and an empty window.
An invalid or mismatched cursor or mixed query returns `invalid-request`.
Permission refusals still come from the runtime; owner read failures use
`unavailable`.

The newest response includes the latest task independent of the visible
messages. Its saved question keeps the ID, text, answer, kind
(`clarification`, `approval` or `delegation`), and proposal with its target,
full data and expected revision. It omits the private call reference. Reads
make no writes and publish no lifecycle observations. Nothing polls history.

The browser reader checks the response profile and conversation before using
it. It merges overlapping windows by sequence and leaves gaps explicit for
one earlier read at a time. An earlier page never replaces the latest question.
Abort old reads when changing profiles or starting a replacement read. If a
read fails, the caller can retain the last loaded history and explicitly retry
the read. Unsubmitted drafts stay in page memory only.

The companions source checks above include history route and reader tests. The
existing browser journey exercises the recent reader against the real private
gateway with synthetic saved history. Run the focused journey after the root
build with `node apps/runtime/dashboard/tests/conversation-history.browser.ts`,
or run it as part of `npm run test:companions:browser`.

Diagnostics use the SDK's log, trace, clock, scheduler and abort signal and the
runtime's host adapter. Profile 1.6 registers assistant run/model/tool spans and
task/run/effect identifiers. Runs end at human waits or shutdown; a later run
links the previous run. No prompt, answer, tool body, key or raw exception is
logged. No LangSmith exporter is configured. Global LangChain/LangSmith tracing
or verbose flags make the executor unavailable, preventing implicit content
export. Reachy's fixed-text policy remains independent.

### Checks

Run the root build and `npm run test:companions:built` for abrupt process exits,
pending-write fidelity, unknown-call recovery, cancellation, budgets, full disk,
outbox replay and private pagination, plus `assistant.test.js` (approval,
decline, stale approval, uncertain dispatch, allowlist refusal, refusal,
truncation and fault codes, profile isolation), `assistant-sessions.test.js`
(each conversation's shared-session observations across its tasks, restart and
baseline, Hub #505), `conversation-titles.test.js` (title normalization,
prompt, the title call, refresh, rename and failures, Hub #2025),
`anthropic.test.js` (the request
shape, tool-use parsing, usage, error mapping and abort against a fake
transport) and `configure.test.js` (the section and a keyed provider through
the harness's secret). `spend.test.js` checks the ledger's pricing,
reservations, settlement, local day and month boundaries and restart.
`assistant-spend.test.js` checks the relaxed limits, their conversation
messages, spend reservations before dispatch, refusals at the limits and
unreported and late usage. `conversation-spend.test.js` checks the page's
reading of the spend route. `node --test apps/runtime/dist/tests/assistant-dispatch.test.js`
checks the core's admission. The `assistant-task` and `assistant-mode-approval`
runtime catalog cases run over both transports and in a disposable runtime. The
existing companions browser check exercises the real authenticated page with
approved and declined proposals across reload, a clarification with the read
tool, cancellation, keyboard, disconnection and reader refusals while
preserving Reachy. The Conversation state journey checks Details at desktop
and 320px, including scrolling facts, returning focus, and preserving the
reading position. The speech journey checks Stop speaking during narrow
inspection. Use the disposable `scenario-assistant-task` capture for the normal
Conversation view and matched synthetic captures for the open drawer.

These are synthetic source checks. They establish neither
live-model usefulness nor installed or physical acceptance; live provider use is
the installed acceptance of #508 under the owner's allowance.

## Explicit preferences

The **Preferences** page manages a small private library independently of the
Reachy and synthetic-task switches. Add a short title and text, inspect its
history, edit it, choose **Stop using**, or explicitly **Reactivate** it. New
owner-created entries are active; editing an inactive entry keeps it inactive.
IDs and full change snapshots survive restart in the same SDK-owned database.
No background learning, provider or transcript source is added. The only
automatic use is the B.U.N.N.Y. conversation's model prompt, which reads the
currently active entries at each model call (see [Conversation and assistant
tasks](#conversation-and-assistant-tasks)); inactive entries and history never
reach it. Preference text is data and never grants permissions or device authority.

Select active entries and choose **Copy selected active preferences** for plain
text (`title`, newline, current text; blank lines between entries). The click
rereads current active values, excluding inactive and historical text even when
a selection was made earlier. Unsubmitted drafts stay only in page memory.
Stop using keeps private history and cannot retract earlier copies or exports.
Do not put passwords, tokens or other credentials in preferences. This is not an
arbitrary-prose secret detector.

### Private read and export contract

The authenticated route `/modules/companions/content/preferences` uses the
existing read grant; it grants no control. Its modes are:

| Query | Document | Contents |
| --- | --- | --- |
| omitted or `view=active` | `preferences/1.0` | `revision`, `entries`: current active records without history |
| `view=manage` | `preference-view/1.0` | `revision`, `entries`: every current record with history |
| `view=export` | `preference-library/1.0` | `entries`: every current record with history |

Each document has its version in `schema`. Records have `id`, `title`, `text`,
`active`, `createdAtMs` and `updatedAtMs`. Management/export records also have
`history`: ordered snapshots with `action`, `source`, `atMs`, `title`, `text`
and `active`. Actions are `created`, `edited`, `deactivated`, `reactivated` or
`imported`; source is `owner` or `import`. Imported files supply their earlier
history; that provenance is not independently verified evidence. The module's
package exports these TypeScript document types without exposing its store.

**Export library** downloads compact private JSON, including inactive entries
and history. Import validates the whole closed versioned document, including
unique IDs and consistent latest snapshots. It preserves every existing entry
exactly and inserts only missing IDs, always inactive. Each insertion retains
its original history and adds an inactive import snapshot. Repeated or older
exports cannot overwrite edits, replace history or reactivate an entry. A fresh
library also needs explicit activation after import. No snapshot replacement,
semantic deduplication or permanent erasure is provided.

### Controls, bounds and failures

Preference changes use the existing private upload at target `preferences`,
name `preferences.json`, with the `assistant-input/2.0` opaque envelope. The
private JSON input has `expectedRevision` and one action: `create` with title/text,
`edit` with ID/title/text, `set-active` with ID/active, or `import` with the export
in `library`. Existing `assistant` uploads keep their separate validation and
25,600-byte bound. Control authority, current revision, request binding and
five-second admission remain required. Eight private staged requests can wait;
restart discards them without applying them. Successful request receipts prevent
repeat effects. The core sees request IDs and opaque references only.

`preference-state/2.0` carries only `{id: "preferences", revision}` through the
existing owner and shared revision sequence. The dashboard refreshes its private
read after a state change or reconnect; it does not poll. Preference records,
revision, request receipt and outcome commit together through the SDK outbox.
A refused publication after commit stays committed and awaits publication.

Titles are limited to 200 UTF-8 bytes, text to 4096, and the serialized retained
library including history to 8 MiB. Uploads use the existing 10 MiB ceiling.
A full library or SQLite failure refuses the change without truncating history
or partially applying an import. Imported history plus the new import snapshot
and existing records must fit the retained limit. Existing records remain
readable/exportable. A revision conflict requires reviewing fresh state; an
uncertain result requires checking the tracked receipt, without automatic resend.

After the root build, `test:companions:built` covers the real SQLite lifecycle,
old/repeated import, rollback, full disk and staged-command boundaries. The
`preferences` scenario checks gateway grants, restart and content-free metadata
over both SDK transports and a disposable runtime. `test:companions:browser`
covers management, clipboard, private files, keyboard and narrow viewport,
with existing assistant/Reachy journeys retained. Use a private temporary
directory outside every Git checkout for runtime checks. These are synthetic
source checks, not installed or physical acceptance.

## Companion knowledge and context

**Companion knowledge** manages explicit titled notes about people, relationships,
events or stated routines. It reuses the preference lifecycle: new owner entries
are active; Stop using keeps history; editing an inactive entry does not reactivate
it. Knowledge and preferences have separate records and document schemas. There
is no extraction from conversations or sensors, automatic learning, person graph
or recognition. Keep credentials out of notes and private files.

The page shows three curated profiles: B.U.N.N.Y. is a helpful generalist; Reachy
is articulate, expressive and diplomatic; MicroDuck is cheeky, expressive and
capable. Stable IDs are `bunny`, `reachy` and `microduck`. Optional explicit voice
references are stored independently of models; an absent selection stays absent.
A saved persona reference does not qualify or enable the separate spoken-alert endpoint.

Choose a persona, optionally choose a conversation and up to 16 messages, then
**Preview current context** or **Copy current context**. Each click reads current
active knowledge/preferences and the selected permitted messages. Other personas'
private conversations, inactive entries and historical knowledge snapshots are
excluded. Corrections and removals affect the next read. A large context is
refused rather than silently truncated. No knowledge entry or conversation
message enters the assistant graph automatically; the curated persona and
active preferences reach the model prompt only as the conversation section
describes. Copied data grants no permission or current location evidence.

### Conversation records

Authoritative conversation records extend `assistant_messages` on the existing
SDK SQLite connection. New `companion-message/1.0` records carry message and
conversation IDs, optional known turn/task identity, speaker, explicit or unknown
recipients, creation time, revision, creation ordering, meaning, provenance and
delivery references. Meaning is literal text/language, emotion with optional
intensity, or unknown. Legacy rows retain their IDs, sequence, time and text;
missing meaning, audience and delivery evidence remain unqualified. Operational
tool records, calls and checkpoints are not authoritative conversation/context.

**Create synthetic Reachy–Duck exchange** saves four labelled fictional messages
in one conversation shared by both personas. It generates no household facts,
audio or device commands. Duck English text is labelled intended meaning or
translation. Unknown meaning has no invented translation. Source portability
fixtures enforce quacks-only fake Duck audio; no live audio is qualified.

**Correct message** changes meaning and increments its revision without changing
creation order or original delivery references. **Remove message** removes its
authoritative text and retains ID/order/removal metadata. Latest Duck reads fall
back to the newest remaining Duck message, then empty. Correction/removal of an
unfinished task's message is refused until the task finishes or is cancelled.
This also applies to imported removals. Operational evidence and old files are
not securely erased; readers never fall back to those records for removed text.
Reads, import and startup never render messages or invoke the graph.

### Private contracts and recovery

All routes below use the existing authenticated read grant under
`/modules/companions/content/`. Read permission grants no control. Missing,
forbidden and unavailable reads use the shared error body; they are not empty
history. No new sharing destination is selected.

| Reference and query | Document |
| --- | --- |
| `knowledge?view=active` (default) | `knowledge/1.0`: current active entries and revision |
| `knowledge?view=manage` | `knowledge-view/1.0`: current entries and full history |
| `knowledge?view=export` | `knowledge-library/1.0`: entries and history |
| `speech-qualification` | `browser-speech-qualification/1.0`: private selected browser and voice receipt; unavailable when absent or invalid |
| `companion-profiles` | `companion-profiles/1.0`: curated profiles and optional voice refs |
| `companion-history?profile=reachy` | `companion-history/1.0`: permitted conversations; `after` pages the list |
| `companion-history?profile=reachy&conversationId=<id>` | ordered messages; `after` advances creation sequence; optional `latest=microduck` returns latest or empty |
| `companion-context?profile=reachy` | `companion-context/1.0`: selected profile, current entries and explicit context; optional `conversationId` and comma-separated `messages`, `messages2` through `messages6` select records |
| `companion-archive` | `companion-archive/1.0`: knowledge, unchanged preference library, voices, conversations, messages and removals |

Context's optional `destination` accepts `local`, `claude` or `codex` under the
existing sharing choices; other values are refused. This is a read/copy boundary,
not a model sender or a new policy service. Context includes both assistant and
preference revisions and is assembled on demand without a persistent cache.
Split selections into groups of at most three IDs per query field, in the order
listed above. This supports all 16 selected IDs at their maximum 128-character
length without exceeding the gateway's 512-character value or 16-field limits.

Changes stage `knowledge.json` at target `knowledge` through the existing opaque
`assistant-input/2.0` command. Each private input has `expectedRevision`, from the
knowledge view. Actions are `create`, `edit`, `set-active` and standalone `import`
(as preferences, with the knowledge library schema), `fixture`, `correct-message`
(messageId/meaning), `delete-message` (messageId), `set-voice` (persona/voiceRef,
nullable), and `import-archive` (archive). The existing core owns authentication,
Origin, grants and tracked outcomes. Assistant-state metadata invalidates content
reads; preference changes also invalidate explicit context. No polling or prose
in shared state/commands/outcomes/diagnostics is added.

Archive import validates the whole document, then commits one outbox transaction.
Existing knowledge/preferences and their histories remain unchanged; missing
entries arrive inactive, including in an empty store. Existing explicit voice
selections win. Local message corrections win and imported messages stay
historical, with file provenance marked imported. Conflicting identity or
creation order refuses the file. Known removals defeat imported content.

Exported removal metadata contains no deleted text. Use a **current export** for
fresh recovery that must preserve removals: an old standalone file cannot know
about later deletions. Reimporting that old file into a store which already knows
the removals cannot resurrect them. Import does not replace a snapshot, replay
work, rewrite checkpoints or retract content from other clients.

Titles/text retain the preference limits (200/4096 UTF-8 bytes); each retained
entry library including history is at most 8 MiB. Meaning text is at most 8 KiB.
History pages contain at most 16 conversations or messages and 64 KiB; context is
at most 16 explicitly selected messages and 64 KiB. The combined archive is at
most 8 MiB and staging at most 10 MiB, eight requests and five seconds. Capacity
refusal preserves current records and history. If separately growing preferences
or existing assistant history exceed the archive/context bound, those reads
report capacity rather than claiming a complete export or truncating records.

The companions SQLite suite covers legacy migration, additive imports, removals,
source/revision/expiry checks, full disk and rollback. The `companion-knowledge`
catalog scenario exercises public reads through two fake model adapters and a
replacement test client over both transports and a disposable runtime. The
companions browser journey covers keyboard, clipboard, private files, profile
inspection, correction/removal, narrow layout, reader access and disconnect.
All are synthetic source evidence; live providers, installed access paths and
physical acceptance remain separate.

### Duck Home widget

On Companion knowledge, choose a conversation containing Reachy and MicroDuck,
then **Show selected conversation on Home**. This saves one explicit selection
in the companions store; creating or importing conversations never chooses one.
Use Home's **Edit Home → Add card → MicroDuck → Done** to place the card.
The card shows that conversation's label and exactly one latest remaining Duck
meaning with its original timestamp and provenance. Emotional expressions and
unknown meaning remain distinct. Playback stays unknown: an intended message or
opaque delivery reference is not evidence of audio or hearing.

**View conversation** opens the same owner's bounded history on a separate page
with speaker/time labels, Next page and First page controls. The page keeps no
second archive or twenty-message retention limit. The history and Home reads
produce no speech, graph invocation, recording or device command. Correction,
removal and selection updates invalidate previous content; disconnect or denied
access hides it until a current permitted read succeeds. Refresh is explicit
after a failed read. Empty history, no selection and unavailable reads differ.

`/modules/companions/content/duck-widget` returns `duck-widget/1.0`: revision,
selected conversation (or null), messages and next cursor. Default `view=latest`
returns at most one Duck message; `view=history&after=<sequence>` reuses the
existing bounded history reader as Reachy. Only view/cursor appear in the URL.
`select-duck-conversation` knowledge input takes `conversationId` (or null) and
the existing expected revision. It reuses authenticated staging, tracked outcomes
and assistant-state invalidation. One additive singleton row stores the selection
on the same SDK SQLite connection. Archive import leaves that local choice alone;
fresh archive recovery requires explicit reselection. **Clear Home conversation**
clears only this choice, retaining messages and Home placement.

Companion tests, the `companion-knowledge` runtime scenario and companions browser
journey check this source behavior with synthetic records. Installed widget and
real conversation/output acceptance remain separate.

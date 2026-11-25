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
most one waiting in each category. Speech keeps its own waiting candidates, also
in memory: one card and one reply per conversation. Coding attention survives Work/Quiet. A
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

The same coordinator and endpoint speak B.U.N.N.Y.'s and Reachy's replies to
typed requests (Hub #500, first slice); MicroDuck's are never spoken, because
its audio is quacks only (Hub #2026). Open **Voice** in the composer toolbar to enable
spoken replies, mute them, inspect readiness or recover an eligible earlier
operation. Enabling makes this tab the speaker for replies and eligible Reachy
alerts. **Stop speaking** remains available during local playback, including
inside **Details** when it opens as an overlay. Closing Voice or Details,
changing profiles or resizing leaves the selected endpoint in place. The
**Voice requirements and playback evidence** disclosure shows the qualification
and playback report.

When a turn ends with a result, a question for the owner or a refusal, the engine
offers that saved message once; MicroDuck's English text is never offered,
because its audio is quacks only. **Read aloud** beside a saved assistant message
offers it again under its own request identity. The command receipt and playback
report appear separately. A reply ranks with coding
attention: it interrupts a notice or social card after confirmed cancellation
and waits for an active equal. Each conversation keeps one waiting reply (Hub
#2027): a newer reply of the same conversation, a Read aloud replay included,
replaces it, so a stale answer never precedes the current one there. Replies of
other conversations are kept, and a reply and Reachy's waiting card never
replace each other. The voice takes the highest rank first, then the order the
candidates arrived in. Replies honor Quiet and need the
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

A named Wemo read in Conversation includes the plug's maximum-on settings and
the core's current limit status. A running limit includes the observed run
start, shutoff deadline and time remaining as of the read. Observation,
start and deadline times include the runtime's local clock alongside the ISO
instant. A missing or recovering core copy leaves the limit unknown. The Hub
must be running and the plug reachable for enforcement.

The **Conversation** page (`assistant`) is B.U.N.N.Y.'s text conversation beside
Reachy (Hub #46). B.U.N.N.Y., Reachy and MicroDuck all talk to the provider and
model the private section selects (Hub #2026), each with its own curated persona,
under the same per-turn limits, prompt caching and spend limits. Without a
provider, or with `synthetic`, all three use the labelled synthetic provider,
which makes no network call and no paid usage. Activation defaults to off. The three
profiles keep separate conversation histories. Each conversation runs its own
task at the same time as the others (Hub #2027): one unfinished task and one
graph invocation per conversation, all on the module's one SQLite connection.
A new task in a conversation whose own task is unfinished is refused with
`capacity`. While that task works, **Send** steers it instead (see
[Steering a running task](#steering-a-running-task)), and **Queue** saves the
message to start after it (see [Queued messages](#queued-messages)); another
conversation's task never blocks either. A command for one
conversation is refused as stale (`revision-conflict`) only when that
conversation changed after the revision the page read, so another
conversation's step never refuses it; enable and disable keep the
assistant-wide revision; a rename, or a correction or removal of one of its
messages, counts as a change of its conversation, and each start counts every
conversation, a companion exchange included, as changed at the revision it
started with, so a command naming an older revision is refused. A startup recovery
that fails leaves only its own conversation unavailable until the next start,
and that conversation gets a message saying its saved progress could not be
restored, that the task can be cancelled but new messages there can't be sent
until B.U.N.N.Y. restarts, and that the restart tries the recovery again.

Choose B.U.N.N.Y., Reachy or MicroDuck under **Conversations** in the
dashboard's rail, from any page (Hub #1890). On a phone, open the menu button
first. The rail lists each by name, and the page's one header row names the
open profile beside **Details**. A dot on a
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
draft. A draft clears once its message is saved, stays after a refusal or an
uncertain reply, and clears on reload. Another
conversation's unfinished task does not hold this one: switch in the rail and
send to it while the other works or waits.

**Voice** is in the composer toolbar. Open **Spoken replies** to enable output
in this tab, mute it, or inspect requirements and tracked playback evidence.
Use **Close**, Escape, or click outside to dismiss the panel. During playback,
**Stop speaking** stays in the toolbar and moves into the narrow Details
overlay while it is open.

Questions, approvals and task controls appear above the composer. Coding job updates appear in their original exchanges.
A successful task leaves a short **Task completed** cue by the composer.
Open **Details** to inspect the task. Failed, cancelled, paused and uncertain
outcomes remain visible by the relevant controls.
When a turn fails or ends with an uncertain call, the transcript saves a closing reply from the turn’s approved requests, dispatch receipts and recorded results. It can report a known limit even when the model has no calls left. The fallback stays on the page and says when the cause is unknown. Opening the conversation again shows the same reply.
An approval shows the full scope and the revision it applies to. A command
receipt reports what happened to the request separately from task completion.
Disconnected or stale copies retain loaded history and lock mutations.
**Stop speaking** controls audio only.

### Queued messages

The composer stays available while a conversation's task works or waits (Hub
#2030). **Queue**, beside **Send**, saves the message for after the current
task. How the composer behaves depends on the task:

- While the task works or waits on a coding hand-off, Send and Enter steer it
  (see [Steering a running task](#steering-a-running-task)).
- During a clarifying question, Enter answers it. **Skip question and send**
  steers instead, and Queue saves the text as a message.
- During an approval, Enter and Queue queue the text, and **Decline with
  message** declines the proposal and steers.
- While the task is paused or uncertain, only Queue shows.
- With no task to wait for, Queue shows only beside a held queue and adds to
  it.

Queued messages show above the composer in the order they start. Queue takes
a message while fewer than 8 wait. Steers that a stopped or closed task never
read go back to the head of the queue even past 8, up to 16, so nothing you
wrote is dropped (owner decision on #2031); the queue then says so, and Queue
waits until fewer than 8 are left. **Edit** changes one's text, **Move up** and **Move down** change
the order, and **Withdraw** removes one. When the task ends, succeeded or
failed, the first queued message starts as a new task and turn of the same
conversation. It starts in the commit that ended the task before it, so the
session on the status devices reports that turn's end before the next turn's
start. Its recent context holds the finished task. A queued message that
starts runs no title check of its own; the title model already checks the
title after the task before it. A message stays queued while the task waits on
an answer, an approval or the coding worker, and starts only once that task
ends.

Some events hold the queue, and nothing in a held queue starts until the
owner releases it:

| Hold | Cause | Release |
| --- | --- | --- |
| Stop | **Cancel task** while messages are queued (owner decision 5). | **Resume queue** |
| Restart | B.U.N.N.Y. started while messages were waiting (owner decision 6). A start starts no work. | **Start** |
| Refused | The next message could not start: conversation is off or unavailable, or a paid profile's spend limits leave too little for its first call (`capacity`, with the limit's own message). The message stays queued. | **Resume queue**, which tries the start again. If the start is still refused, the command is refused and the queue stays held. |

Send still starts a task at once beside a held queue; when it ends, the queue
stays held. Withdrawing the last message releases a hold. New conversation is
refused with `invalid-state` while the current conversation's queue holds a
message, as it is for an unfinished task, and the page says "Start or withdraw
the queued messages first."

The queue is the module's own state, not a stored command (ADR 0012): the
input command that queues a message completes once the message is saved. A
queued message's ID is that command's request ID, so a repeated command queues
nothing more, before or after the message starts. Its start and its removal
from the queue commit together, so a crash never leaves it both started and
queued, and it starts at most once. Queue and the edit of a queued message are
staged assistant inputs, `{action: 'queue', profile, text, expectedRevision}`
and `{action: 'edit-queued', profile, queuedId, text, expectedRevision}`.
Withdraw, reorder and Resume queue (also Start) are the `withdraw`, `reorder`
and `resume-queue` actions of `assistant-control/2.2`. Each names the
`profile`. Withdraw and reorder also name the `queuedId`, and a reorder names
`beforeId`, which is null for the end.

Each queue command is checked against the conversation's queue revision: the
assistant revision of the queue's last change. The running task's steps never
make a queue command stale. A message that started, moved or changed since
does. New conversation counts both conversations' queues as changed. Each
start counts every saved conversation's queue as changed, and again wherever
the start changed the conversation itself. So a Queue naming a revision read
before New conversation or a start is refused exactly when a Send is. A
command that is refused and rolls back records no change. Editing,
withdrawing and reordering run no work, so they are admitted while
conversation is off.

The page's withdraw, reorder and Resume queue name the revision at which the
shown queue was read, so a move never acts on an order the page no longer
shows. An open edit names the revision of the latest read in which its message
still had the text the edit opened with. Queuing, moving or starting another
message therefore never refuses it, and it cannot overwrite a change made to
its message on another page since. If its message is changed on another page,
starts or is withdrawn first, the edit closes and the page shows the edited
text with **Use in composer**. A refused edit keeps its text and allows Save
again.

`assistant-state/2.2` lists each profile's current conversation whose queue
holds messages, as `queues`: the conversation and profile, how many messages
wait, the hold (`stop`, `restart`, `refused` or null) and a refusal's code. It
carries no message text. While a queue holds more than 8, after returned
steers, the state is `assistant-state/2.3`, which allows up to 16. A state
without such a queue keeps version 2.0, or 2.1 for the full tool list. After each assistant-state revision, the page
reads the texts from
`GET /modules/companions/content/conversation?profile=<profile>&view=queue`.
The answer is `{version: 1, profile, conversationId, revision, current, held,
messages, steers}`. `revision` is the assistant revision it was read at. `held`
is `{reason, code, detail}` or null, and each message has `id`, `text`,
`queuedAtMs` and `updatedAtMs`. `steers` lists the running task's unread
steers, each with `id`, `text` and `savedAtMs` (Hub #2031).

A release before this one did not know the queue, so its New conversation
could leave queued messages in the conversation it replaced (see
`apps/runtime/UPGRADE.md`). They never start and are not in public state. Each
start holds them. Add `conversationId=<id>` to the read for an earlier
conversation's messages, with `current: false`. The earlier conversation's
read-only view lists them, and **Withdraw**, the only action there, removes
them.

The queue is modelled on Codex's durable queue and T3 Code's queue commands;
`THIRD-PARTY-NOTICES.md` names the adapted parts and holds their licenses.

### Steering a running task

**Send** while a task works steers it (Hub #2031, owner decisions 1, 3, 4 and
5): the message joins the task's current turn instead of waiting for it. The
steer is saved at once and shows above the composer under **Steering this
task** until the task reads it. Unread steers and queued messages share one
box there, steers first, which scrolls inside itself so the header and
transcript stay in view. The task reads its steers at its next model
call, after the last call's tool results, so the model sees what the tool
returned and then your message. Once read, the steer appears in the transcript
at that point, marked **Sent while working**. A steer never cuts off the
running call, starts no title check and reports no session turn of its own.

- **A forced call.** If the model was about to finish when the steer arrived,
  the task makes one more model call so the model reads it. The earlier answer
  is saved, marked **Earlier reply, before your next message**, and is not
  spoken; only the turn's final reply is.
- **A late steer.** A steer that arrives after the last model call becomes the
  next queued message. The commit that closes the turn decides this, so the
  message starts as its own turn right after, before the messages already
  queued. A steer that reaches a turn that has already ended, while it is
  still the conversation's latest, is queued the same way, and like a returned
  steer may take the queue past 8, up to 16; after **Cancel task** it waits in
  the held queue.
- **Questions.** During a clarifying question the composer answers it, and
  **Skip question and send** sets the question aside and steers in one step.
  During an approval, text is queued, and **Decline with message** declines
  the proposal and steers in one step; the declined command is never sent.
- **Coding jobs.** A coding job continues while the conversation takes new
  messages. A steer applies to the conversation turn.
- **Limits.** When fewer than two model calls remain in the turn's limits, by
  model calls, active time or usage units, the message is queued instead. A
  task holds at most 8 unread steers, and its steers and the queue together at
  most 16.
- **Stop.** **Cancel task** returns unread steers to the head of the queue,
  which it then holds; a failed turn returns them the same way, and the first
  starts next. A restart starts no work: a task waiting on a question keeps
  its steers, and unread steers a start finds on a task that already finished
  go back to the head of the queue, held until **Start**.

A steer is a staged assistant input, `{action: 'steer', profile, text,
expectedRevision, taskId, questionId?}`. `taskId` names the turn the page
expects, as Codex's `expected_turn_id`: a steer aimed at a turn that a newer
turn followed, another conversation's turn or a paused or uncertain task is
refused with `invalid-state`, and nothing retries it. Only a revision the
assistant has not reached is a revision conflict; the task's own steps never
make a steer stale. With `questionId`, the input is Skip question and send for
a clarification, which answers it with a fixed skipped result, or Decline with
message for an approval. Unread steers are kept in `assistant_steers`, keyed by
the steering command's request ID. A model call takes them into the task's
transcript in its own admission transaction, so a call the limits refuse
leaves them unread and a replayed graph step never reads one twice. An unread
steer's text reaches only its own task's model calls and is stored only in the
queue store. Once the task reads it, it is a saved owner message of the
conversation like any other, and a superseded reply a saved assistant message:
later turns' recent context and the conversation's title checks read them.
Steer text never appears in logs, published state or session reports.

Steering follows Codex's pending input and turn close;
`THIRD-PARTY-NOTICES.md` names the adapted parts and holds the license.

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

- **Capabilities** lists the provider, the model, the tools the open profile's
  model is offered, any listed tools that are B.U.N.N.Y.'s only, unavailable
  tools, the coding worker's availability and slots, this companion's coding
  slot and the plan usage windows.
- **Task activity** shows the task, conversation and run IDs, status, counters,
  bounds, diagnostic code, saved question and answer, and settled successful
  control receipt. Pending and failed receipts stay beside the controls.
- **Usage** shows reported usage and the reservation against the task limit.
  A synthetic task may show **Unknown** usage alongside `0 / 1000000 units`
  reserved. Hosted tasks use reported tokens and leave the task's billed cost
  unknown. **Spend today** shows the shared spend of every profile against
  the $20 daily limit. **Spend this month (estimate)** shows the local
  estimate against its monthly guard, $150 unless `assistant.monthlyLimit`
  sets it ([Spend limits](#spend-limits)), and the line under it says that the
  Anthropic Console holds the real monthly limit and spend
  ([Spend limits](#spend-limits)). Both name any reservation still counted
  for a call without reported usage. **Prices** says whether the paid model's
  prices are configured, built in (with the table's date) or the dearest known
  rate. When a paid profile's new message would be refused, its composer says
  which limit is reached.
- **Conversation settings** explains where submitted text goes and links to
  **Preferences** and **Companion knowledge**. Enable and disable are one
  switch for every conversation, so an unfinished task in any of them keeps
  **Disable conversation** unavailable (`invalid-state`). The section lists a
  **Go to <name> task** link for each such conversation.

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
  "titleModel": "claude-haiku-5-5", "tools": ["read_sessions", "set_mode"]},
  "secrets": {"anthropic-api-key": "/run/secrets/bunny/anthropic-api-key"}}}
```

The key file holds an API key created in B.U.N.N.Y.'s own Console workspace,
which carries the monthly spend limit ([Spend limits](#spend-limits)).

- `assistant.provider` is `synthetic` (the default), `anthropic` or `openai`. The Anthropic
  provider needs `secrets.anthropic-api-key`, the owner-only file holding the
  API key. The module reads it once at start, holds it only in the provider,
  sends it only as the request header and never stores, publishes or logs it;
  the runtime redacts it from its own records. `model` defaults to
  `claude-opus-5-5` and `effort` to `medium` (`low`, `medium` or `high`).
  `titleModel` names the small model that writes conversation titles (see
  [Conversation titles](#conversation-titles)) and defaults to
  `claude-haiku-5-5`. The synthetic provider takes none of the three.
- To offer both hosted supervisors, keep `assistant.provider` set to
  `anthropic` and add `"openAI": {"model": "gpt-6.2-sol", "effort": "medium"}`
  under `assistant`. Add the owner-only OpenAI API key file as
  `secrets.openai-responses-api-key`. With only OpenAI, set the provider to
  `openai` and put `model` and `effort` directly under `assistant`.
  OpenAI tasks and titles use the same published model. The available choices
  appear in the Conversation composer. Send and Queue preserve the selected
  provider on their own task. Answer and Steer use the active task's provider.
  If a configured key cannot be read, the composer offers the available
  supervisor for new tasks. History stays readable. Tasks already pinned to
  the unavailable supervisor stay paused. Coding workers have their own
  configuration and approval.
- OpenAI receives the current owner request and selected relevant data under
  [ADR 0011](../../docs/decisions/0011-private-personal-data-retention.md).
  Device reads resolve the opening affirmative target to an exact configured
  ID or label. Ambiguous matches or later clauses add no device facts. For an explicit reference to a
  previous request, the supervisor can receive a bounded excerpt from the
  same conversation. A title for an untitled conversation uses only the
  current request. Provider-native reasoning and tool items replay within
  their original task and current subject. A steer submits the new request
  with only relevant excerpts from an earlier subject. A missing or changed
  provider leaves the task readable and paused. An earlier task with no
  saved supervisor stays paused, and its unpinned queued work stays held.
  Cancel the paused task and withdraw any unpinned messages to start a new
  conversation. Worker results remain in the private conversation.
- Responses calls use Standard service and a 30-minute prompt cache. The
  published `gpt-6.2-sol` rates on 2026-11-24 are $2 per million input tokens,
  $2.50 for cache writes, $0.10 for cache reads and $10 for output, which
  includes reasoning tokens. Above 272,000 input tokens the rates are $4,
  $5, $0.20 and $15 respectively. The Responses price schedule is pinned in the
  task and in each reservation. Unknown model pricing prevents a request.
  Both supervisors and their title calls draw from the same local spend
  guards. Usage the provider does not report keeps its full reservation.
  [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- `assistant.prices` is optional. It maps each model to its `input`,
  `output`, `cacheWrite` and `cacheRead` prices in US dollars per million
  tokens, to override the built-in table below. Each entry needs all four
  prices, from 0 to 1000, for at most 16 models. `cacheWrite` is the
  five-minute Anthropic cache write. Responses uses its published schedule.
  The synthetic provider takes no prices.
- `assistant.monthlyLimit` is optional (Hub #2102). It sets the local monthly
  spend guard in US dollars, a number from 0.01 to 10000. The default is 150.
  Set it to the B.U.N.N.Y. workspace's monthly spend limit in the Anthropic
  Console, such as `"monthlyLimit": 200` for a $200 limit, so the local
  estimate follows the desired guard for the installation
  ([Spend limits](#spend-limits)). Any other value refuses the section with
  `invalid-request` and the detail "assistant.monthlyLimit is the local
  monthly spend guard in US dollars, from 0.01 to 10000". The daily limit
  stays $20. The synthetic provider takes no monthly limit.
- **Built-in prices** (Hub #2047), read from the
  [Anthropic price list](https://platform.claude.com/docs/en/about-claude/pricing)
  on 2026-11-22, in US dollars per million tokens:

  | Model | Input | Five-minute cache write | Cache read | Output |
  | --- | --- | --- | --- | --- |
  | `claude-opus-5-5` | 4 | 5 | 0.20 | 20 |
  | `claude-haiku-5-5`, prompt up to 100,000 tokens | 0.10 | 0.125 | 0.01 | 0.50 |
  | `claude-haiku-5-5`, prompt over 100,000 tokens | 0.50 | 0.625 | 0.05 | 2.50 |

  A Haiku prompt counts its cache reads and writes. A call is reserved at the
  tier of its input bound, which is never below its real prompt, and settled
  at the tier its reported prompt falls in. A model the table does not know
  is priced at the dearest known rate for each class, across this table and
  any configured prices. A configured price overrides the table. With no
  prices configured the assistant runs with daily pacing, and title calls on
  the default title model are priced at Haiku's built-in tiers. No job fetches
  prices: the price list is not an API, and a price change needs a release or a
  configured price.
- `assistant.tools` lists the permitted tools by name, each once:
  `read_sessions`, `set_mode`, `delegate_coding`, `read_lifx`, `set_lifx_power`, `set_lifx_brightness`, `read_wemo` and `set_wemo_power`.
  The engine builds the model's tool
  definitions from the list at start and checks membership again when a call
  executes, so a changed section cannot widen an effect. The built-in
  `ask_owner` is always available; the synthetic fixture read is never listed.
  Device and catalog tools stay B.U.N.N.Y.'s (Hub #2026): Reachy's and
  MicroDuck's models are offered only the listed tools that are neither, such
  as `read_sessions`, `set_mode` and `delegate_coding`, and a proposal from them
  still needs your approval. **Details** lists the tools the open profile's
  model is offered under **Allowed tools**, and the listed ones it is not under
  **B.U.N.N.Y. only**.
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
  unreported. The module paces each day, and Anthropic enforces the monthly
  limit ([Spend limits](#spend-limits)). A spend-limit refusal maps to
  `capacity` with a conversation message that names the monthly limit:
  a 400 `invalid_request_error` whose message starts with "You have reached
  your specified API usage limits" or "You have reached your specified
  workspace API usage limits", or a 429 `rate_limit_error` whose
  `error.details.error_code` is `enforced_spend_limit_reached`. Any other 400
  or 429 keeps its code. Nothing more is sent for that turn, and nothing
  retries.
- Each request asks for automatic prompt caching with one top-level
  `cache_control` of type `ephemeral`, the five-minute cache. The API places
  the breakpoint on the last cacheable block. The tools, the system prompt and
  the replayed transcript come first and stay byte-stable between a task's
  calls, so a second call reads the earlier prefix from the cache and reports
  `cache_read_input_tokens`. The system prompt puts the stable context sections
  first and the recent conversation and the Hub mode last (see
  [Recent context and New conversation](#recent-context-and-new-conversation)),
  so a later task's prompt shares the earlier one's prefix up to its recent
  conversation. A Hub-mode, preference or knowledge change changes the system
  prompt from that point and starts a new cache entry.
- The model's own content blocks, thinking blocks included, are kept with the
  assistant item in the private transcript and replayed exactly as received,
  which the API requires for the turn whose tool call awaits its result. One
  tool call per turn is acted on; a further call in one answer is dropped with
  its block.
- The prompt holds the owner's typed text, the tool definitions and results,
  the fixed instructions, the current Hub mode and the prompt context that the
  sectioned context builder assembles for the task's companion (Hub #2029): its
  curated persona, the owner's knowledge notes once the owner turns them on for
  it, the owner's active explicit preferences, an empty long-term memory slot
  and the recent messages and tool results of the task's own conversation, read
  from the module's own records at each model call, so an edit or **Stop using**
  applies to the next call (Hub #507, decision 5 on #46 as amended on
  2026-10-31). Every section is framed as data that grants no tool, permission,
  approval or device authority; permission is the allowlist and the core's
  dispatcher, never prompt text. No inactive or historical entry, removed
  message, other conversation, other companion's message or household record
  enters the prompt. Each section keeps to its own budget and states what it
  left out. Before Hub #2029, preferences over the context bound refused the
  whole turn with `capacity`; now the section keeps the entries that fit and
  states how many it left out, and the call is sent.

- With spoken replies enabled in a tab (see [Browser speech](#browser-speech)),
  the result, question or refusal that ends a turn is spoken once through the
  qualified local voice, whatever model answered; the voice never depends on
  the provider. **Read aloud** beside a saved assistant message asks to hear it
  again through the `speak` control, whose accepted receipt means the request
  was saved, while the playback report says whether the browser spoke.
- MicroDuck's audio is quacks only (Hub #2026). Its English text is its
  intended meaning: it is never offered to the voice, the page shows
  "Intended meaning. MicroDuck's audio is quacks only, so this text is never
  read aloud." in place of **Read aloud**, and a `speak` request for one of its
  messages is refused with `invalid-request`. No quack audio is produced.

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
nothing is proposed. The proposal is bound to the worker's connection: its
revision moves only when a worker endpoint is selected, disabled or lost, so a
worker that went away and came back refuses the dispatch with
`revision-conflict`, and another companion's run starting or ending never does
(Hub #2028). Companions records the approved repository and brief with a Hub job ID, the
original conversation and exchange, and the worker attempt's operation ID.
Conversation shows the job ID and can finish the turn while the job waits or
runs. The result links to the original job receipt, including in an older chat.

The coordinator sends the attempt through the core's tracked dispatcher as
`coding-dispatch`, then `coding-run`, and records responsibility before
sending one `coding-work` start. The tracked outcome reports a start only
after the worker says it started. A refused start fails the operation. A start
without evidence after twenty seconds is uncertain. The worker's eventual
result records its outcome, git facts, checks, findings, limitations and usage
when supplied. A worker result does not verify installation. The dispatch
carries twenty minutes, sixty turns and five dollars as bounds.

The worker holds one slot per companion. A worker that declares no slots
shares one slot across companions. An approved job may wait for its slot.
At most 32 attempts wait at once, and each slot takes its oldest waiting
attempt first. A restart preserves unsent jobs and reports an ambiguous start
as uncertain without reissuing it. A result saved before an interruption can
still reach its original exchange.

**Cancel task** ends the Conversation turn. **Stop coding job** on the saved
job receipt targets one attempt. It removes a known unsent attempt, or asks the worker to stop a
running attempt. A stop stays unconfirmed until the worker reports a terminal
observation. The coordinator still handles saved pre-change delegation
interrupts, including their task cancellation behavior.

The page shows the worker's availability beside the provider: how many of its
slots are busy and how many hand-offs wait, the conversation companion's own
slot, and the plan usage windows. The worker's readiness (Hub #1743: tool
version, signed in or not, plan and the latest limit windows, each unknown
where the tool did not say) arrives on its enable and is published in
`coding-state/2.2`, which also lists the declared slots, every active run with
its companion and the waiting hand-offs (`active` stays the oldest run); a
readiness report from the selected worker does not move the revision a proposal
is bound to. The plan usage windows are shared by every run, and the worker
reports them only after a run. A result may also end `usage-limit`, with the
limit's window and reset time or unknown, or `waiting-for-owner`, with the
worker's question among the findings; neither is retried.

### Turns, tools and approval

A task can answer, read, ask a clarifying question or execute a control. The
three companions use the same configured tool allowlist. Conversation Details
shows which tools the runtime allows and which it refuses. A missing
permission or capability refuses the action at execution too.

An explicit owner instruction authorizes a configured Hub or device control
once Conversation resolves the target and setting. “Turn off the shelf lamp”
and “Set the Hub mode to quiet” send directly. Conversation asks for an exact
choice when names match more than one device. Earlier owner messages can
identify a reference such as “it.” A status question or model suggestion
cannot authorize a write. Paid artwork and coding delegation still use an
approval question.

The task saves the authorizing message IDs, exact target and setting, current
revision, and request ID before dispatch. The core routes the existing typed
command through its designated writer. A changed revision or device hold
refuses the request. A lost reply stays uncertain and the task never resends
the command after restart. A receipt reports whether the command was
accepted. The tracked operation and correlated owner readback report its
effect.

`read_sessions` reports bounded session labels, shared status, work evidence
and attention from the current core copy. It reports when that copy is
unsynced. The synthetic provider exercises the direct control, question and
read paths without network or paid calls. The `assistant-task` and
`assistant-mode-approval` catalog scenarios and the companions browser journey
cover these paths.

Conversation checks sharing before it builds a page, provider transcript,
title prompt or coding brief. The private Companions section accepts
`sharing` rules with `caller`, `companion`, `destination`, `purpose`, `source`,
`field`, optional `record` and `allow`. A matching denial takes precedence.
Changing a tool allowlist does not grant sharing. The current policy and
OpenAI supervisor grant are recorded in
[ADR 0011](../../docs/decisions/0011-private-personal-data-retention.md).

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
with its code. The graph is `conversation-2` (Hub #2031), whose model step has
an edge back to itself for a steer that supersedes a final answer. Each start
upgrades an unfinished task saved under `conversation-1`, which has the same
steps and checkpoints, before reconciling it. Tasks saved by the earlier fixed
graph (`synthetic-1`) retain readable history and refuse resume. There is no execution queue: a queued
message is the owner's saved message, not saved work, and it starts only as a
new task when the task before it ends or the owner releases its queue (see
[Queued messages](#queued-messages)).

| Bound | Per task or request |
| --- | --- |
| Calls and questions | 50 model calls, 40 tool calls, 10 questions |
| Active time | 40 minutes; human waits and downtime excluded |
| Deadlines | Model 6 minutes, tool 30 seconds, control admission 5 seconds |
| Text and working state | Owner message 32 KiB, context sections as in [Recent context and New conversation](#recent-context-and-new-conversation), result 8 KiB, a model reply with its blocks 16 KiB, working transcript 1 MiB, staged input 193 KiB, serialized graph and pending writes 256 KiB each |
| Usage | 1,000,000 units per turn; each model call reserves its request's UTF-8 bytes plus 8,192 framing units and 16,384 output units before it is sent; a unit is one provider token or one fake synthetic unit |
| Private read | At most 16 messages and 512 KiB per page, advancing cursor |
| Spend | $20 a day, and a local monthly guard of $150 or `assistant.monthlyLimit`, across all profiles; see [Spend limits](#spend-limits) |

A turn is one task: one owner message and everything it causes. A call that
would pass a limit is refused before anything is sent. The task ends with
`capacity`, and the conversation shows a message that names the limit, such
as "This turn reached its limit of 50 model calls." A request's bytes bound
its input tokens because each token encodes at least one byte of text.

### Spend limits

Spending is bounded in two layers (owner decision on #2024, Hub #2047):

- **The month, at Anthropic.** A dedicated Console workspace for B.U.N.N.Y.
  has a monthly spend limit that the owner chooses. Anthropic enforces it on
  real billing, so the month cannot overrun. When it is reached, the provider
  refuses the call: the task ends `capacity`, and the conversation says "The
  monthly spend limit at Anthropic is reached, so the model call was refused
  and nothing more was sent for this turn. The Anthropic Console shows the
  limit, this month's real spend and when access resumes." The Console holds
  the real monthly limit and spend.
- **The day, locally.** The module paces the assistant's paid calls at $20 a
  day across all profiles, from reported usage at the configured or built-in
  prices. It also keeps a local estimate of the month, with a guard that
  refuses calls as the daily limit does. The guard is $150 unless
  `assistant.monthlyLimit` sets it to the workspace's limit (Hub #2102). The
  estimate is not billing: it counts unreported calls at their reservations
  and uses list prices, so Anthropic's limit stays the real ceiling.

The day and the month are the runtime host's local ones and start at local
midnight. A call counts on the day it was reserved. Coding-worker runs use the
coding worker's own sign-in, and other providers, such as the art module's,
have their own allowances. Neither is in this ledger or the workspace's limit.

#### One-time setup at installation

The owner does this once, in the Anthropic Console, before the hosted provider
goes live:

1. Create a dedicated workspace for B.U.N.N.Y. Do not use the default
   workspace: Anthropic's rate-limit documentation says a limit on the
   default workspace might not count or stop some usage there, and on some
   platforms it cannot be set at all.
2. Set the workspace's monthly spend limit at
   [Spend limits](https://platform.claude.com/settings/spend-limits)
   (`platform.claude.com/settings/spend-limits`). The local guard defaults to
   $150. For any other limit, set `assistant.monthlyLimit` to the same amount
   in US dollars.
3. Create an API key in that workspace and store it in the private key file
   that `secrets.anthropic-api-key` names, through the established private
   configuration route. No Admin API key or other credential is needed.

- **Reservation before dispatch.** In the transaction that saves a paid call's
  receipt, the module reserves the most the call can cost in its private
  SQLite ledger (`assistant_spend`). Every input unit is priced at the dearest
  input class, and every output unit at the output price. When that
  reservation would pass the daily limit or the month's guard, the call is refused
  with `capacity` and nothing is sent. The conversation then shows the
  limit, for example "The daily spend limit of $20.00 would be passed: $19.80
  is counted today and this model call could cost up to $0.42. The next model call was
  not sent."
- **Reported usage.** The answer's reported tokens, priced by class at the
  configured or built-in prices, replace the reservation in the same transaction that
  saves the answer. An answer that arrives after the call's deadline, while
  the module still runs, also replaces it.
- **Unreported usage.** A call whose usage is never reported keeps counting
  its full reservation, never zero. Examples are a lost answer, a deadline, a
  crash or an error status. Its turn usage also stays unknown.
- **New turns.** A new message to a paid profile is refused with `capacity`
  and a detail that names the limit when what remains of today's limit or of
  the month's estimate is below the smallest possible first call: 8,192 framing units at the model's dearest input price plus 16,384
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
reservations without reported usage. It also names the paid model that all
three profiles share, where its prices come from (`configured`, `built-in` or
`dearest`) with the built-in table's date, and its smallest possible call. It
is null for the synthetic provider. It carries no text, call or task identity.

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
exists: `B.U.N.N.Y.`, `Reachy` or `MicroDuck`. Apart from the title, each
observation names the conversation's companion in `companions`, its profile ID
and persona name, such as `{id: 'reachy', name: 'Reachy'}` (Hub #2054). No
title ever carries the companion's name except the persona fallback, and title
metadata carries no companion, so a generated title or a rename never changes
it. The dashboard's session tile shows it as a tag in place of the client when
the session's name is not already the persona; the other devices receive it in the
`session/3.2` record and show it only in their own later stories. Every
transaction that changes a task also adds the `lifecycle/2.4` observations that
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

### Recent context and New conversation

Each model call receives the companion's context as named sections in a fixed
order, assembled by one builder (`src/assistant/context.ts`, Hub #2029). Each
section has its own budget in UTF-8 bytes of its rendered text. A section over
its budget keeps what fits and says, in its own text, how many items it left
out; nothing is cut silently and no section refuses the call.

| Order | Section | Budget | What it can contain |
| --- | --- | --- | --- |
| 1 | Personality | 4 KiB | The companion's curated persona name and character, as shown on the Companion knowledge page. |
| 2 | Knowledge notes | 32 KiB | The owner's active knowledge notes, by title and text. Off for each companion until the owner turns it on there; off sends nothing. Entries past the budget are left out, last first. |
| 3 | Active preferences | 32 KiB | The owner's active explicit preferences, by title and text, or a line saying there are none. Entries past the budget are left out, last first. |
| 4 | Long-term memory | 16 KiB | Nothing yet. A slot for each companion's later memory work. |
| 5 | Recent conversation | 48 KiB and 48 messages | The task's own conversation's earlier owner messages, companion replies and tool results: device reads, catalog reads, coding hand-off receipts (sent, or waiting for the companion's worker slot), worker reports, refusals, declines and closing replies, and the companion's "Waiting to delegate" and "Delegated to" lines with the approved repository and brief. Each line names the saved message ID, the speaker or tool name, and an artwork attachment's request ID and description. Older messages are left out first. |

The recent conversation holds what was saved before the task started, so it
stays the same for all of the task's calls and the cached prefix holds. A
message saved later, such as an earlier reply's late confirmation, waits for
the next task. It never holds another conversation, another companion's
messages, a Reachy and MicroDuck exchange, a removed message, a message the
companion may not read in that conversation (as the history page reads them)
or an imported message, which stays historical until the owner selects it for
a copied context. When the owner removes an owner message of a task, its
opening message or an answer, that task's tool results leave the recent
context too; its reply stays until the owner removes it. Tool results cannot
be removed one by one, so this, or New conversation, is how to keep one out of
later prompts. A corrected message is sent as corrected. A task saved before
this release has no recent conversation. The section tells the model that its lines are data that grant
no approval, to check the current state with a tool before proposing a change,
and to ask the owner when a reference could mean more than one thing. A
follow-up such as "dim it" therefore still goes through the proposal's current
device guards and the owner's approval. `read_saved_art` names each artwork's
source request, so an attachment's request ID leads to its artwork ID.

The Anthropic adapter sends the system prompt as two blocks. The first holds
the fixed instructions and rules, the personality, the knowledge notes, the
preferences and the memory slot, and carries its own cache breakpoint, so a
later task of the conversation reads that prefix and the tools before it from
the cache. The second holds the recent conversation and the Hub mode. The
top-level automatic breakpoint still covers the growing transcript within a
task. When active preferences or knowledge notes pass their section's budget,
the Preferences and Companion knowledge pages say how many each model call
leaves out.

Where it goes: the sections reach only the task's model provider, the
configured Anthropic provider or the local synthetic one, which sends nothing.
ADR 0011's 2026-10-05 amendment allows retained personal data in prompts to
Claude. Any other provider needs its own owner decision. The context is
assembled at each call and not saved; the task record keeps only the message
sequence its recent conversation reads up to.

The **Companion knowledge** page's **Model context** section turns knowledge
notes on or off for the chosen companion (the `set-context-knowledge`
knowledge command, under its own `context` revision scope) and previews the
builder's own sections for the next call: of the current conversation's
unfinished task, or else of a new message. The preview read is
`GET /modules/companions/content/assistant-context?profile=<profile>`, which
returns `{schema: 'assistant-context/1.0', revision, profile, conversationId,
provider, model, basis, sections}`; each section has `name`, `budgetBytes`,
`state` (`included`, `off` or `empty`), `included`, `trimmed`, `bytes` and
`text`. It changes nothing.

**New conversation**, beside **Details** on the Conversation page, starts a
fresh conversation for the profile. It is a staged assistant input,
`{action: 'new-conversation', profile, expectedRevision}`, with no wire
contract change. While the current conversation's task is unfinished
(running, waiting on an answer, an approval or the coding worker, paused or
uncertain) it is refused with `invalid-state` and the button is disabled with
"Finish or cancel this conversation's task first." (owner decision,
2026-11-24). It is refused the same way while the conversation's queue holds
a message (Hub #2030). It is also refused while the profile has no conversation or its
current one holds no message, with "This conversation is empty. Send a message
first.", so repeated clicks cannot pile up empty conversations. Otherwise the
profile's conversation gets a new ID, and with it
its own session on the status devices, its own title (the persona name until
the title model writes one), its own running slot and its own change revision;
both conversations count as changed. Its recent context starts empty. Public
assistant state lists each profile's latest task in its current conversation
only. The earlier conversation keeps its messages, title and last session
report; its session goes idle. **Details** lists the profile's conversations,
the current one first and then the others by their last message, newest
first, 16 at a time with **Show older conversations**, and **Open** shows an
earlier one read only, without a composer, until **Back to current
conversation**. The Duck widget's selection of a Reachy and MicroDuck exchange
is unaffected. An archive export lists each profile's current conversation
after its earlier ones, so restoring the export into an empty store makes the
same conversation current; an import never moves a current conversation.

### Conversation titles

Each conversation gets a short title that a title model writes, led by the
GitHub issue it is about, such as `#1896 Session tracking` or `pixoo#14 Boot
channel` for an issue in another repository (Hub #2025). The title follows the
conversation's topic: the model checks it as the conversation goes on and
either keeps it or writes a new one (Hub #2075). Until a title exists, the
persona name stands.

Every profile on the Anthropic provider gets titles from
`assistant.titleModel`: B.U.N.N.Y., Reachy and MicroDuck alike (Hub #2026),
each title check a paid call in the shared spend ledger. On the synthetic
provider no profile makes a title call, and each keeps its persona name until
the owner renames it. A test or harness can inject `SyntheticTitleProvider`,
which writes the fixed title `Synthetic conversation`.

- **When.** An untitled conversation is checked after its first message, so
  it gets its first title while the task runs. After that, the model checks
  the title after each finished task (succeeded, failed or cancelled) and after
  each major event the module knows about:
  - an answered approval, approved or declined;
  - a tool call that changed state, that is, a command the core accepted, such
    as a Hub mode set;
  - an accepted coding hand-off, so an issue named only in the brief can lead
    the title;
  - a coding hand-off's result arriving.

  No count of tasks and no time since the last message starts a check. A task
  that starts after a day without lifecycle evidence is checked only when it
  finishes. A start of the module starts no check: neither startup
  reconciliation nor the settlement of a coding hand-off left pending at the
  last stop, which reaches its task as an uncertain result. A result that
  arrives after the start is checked. The check runs beside the task and never
  delays, fails or rolls it back.
- **One call at a time.** A conversation has at most one title call in flight.
  Triggers that arrive during it are coalesced into one follow-up check, which
  starts when the call settles and carries each distinct event once, oldest
  first, up to the latest four (`TITLE_EVENTS`). Other conversations' calls
  run independently.
- **What the model sees.** The fixed title instruction as the system prompt.
  The prompt gives the current title and who set it (`Current title, written
  by the title model: …`, `Current title, set by the owner: …` or `Current
  title: none`), the fixed labels of the events that asked for the check, and
  the conversation's last eight owner and assistant messages, escaped and cut
  so the whole prompt stays within 2 KiB. A label is the module's own text with
  at most a tool identifier, a decision or an outcome word, for example `The
  owner approved set_mode.`, `A tool call changed state: set_mode was
  accepted.` or `A coding hand-off's result arrived: completed.`. The prompt
  carries no tool result, dispatch receipt or worker report. It also carries
  no preference, knowledge entry or failed turn's closing reply, which is the
  module's own status text about the turn.
- **What the model answers.** `KEEP` when the current title still fits, or a
  new title. The instruction tells the model that a title the owner set is
  their choice, to keep unless the topic has clearly changed since. `KEEP`, in
  any case and with quotes or trailing punctuation, publishes nothing. Neither
  does a new title equal to the current one. With no current title, `KEEP` leaves the persona
  name.
- **What is kept.** After the issue reference, the description is cut to 40
  characters at a word boundary. Quotes, markdown, a `Title:` label and
  trailing punctuation are removed. An answer that is empty, a placeholder such
  as `Title`, or not session display text (a control character or a
  recognizable credential) is no title. So is an echo of the prompt. The
  answer and its title are compared with the prompt's `&lt;`, `&gt;` and
  `&amp;` escapes undone, ignoring case, spacing, surrounding quotes and
  trailing punctuation:
  - An answer equal to any message, or to a coding hand-off's brief without
    its fixed wrapper, is refused.
  - Against your messages and hand-off briefs, the description after any
    issue reference may not share a run of 6 consecutive words
    (`ECHO_RUN_WORDS`), wherever the message named its issue.
  - Against B.U.N.N.Y.'s other replies, which naturally reuse the topic's
    words, only an answer long enough to be cut that appears inside a reply,
    whole or as its description after any issue reference, is refused.

  A hand-off brief is found in both the approval question ("Delegate to the
  coding worker in …") and the accepted hand-off ("Delegated to …"). The guard
  catches verbatim text only. A paraphrase, a reordered or reworded message, a
  shorter shared run, or a short title repeating part of a reply behind a new
  issue reference is not detected, and a message of yours that is already
  exactly the right title is refused. A failed, refused or invalid first
  title leaves the persona name; a later failed check keeps the earlier title.
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
  most 1 KiB, and the labels of the events it answered, privately in
  `assistant_title_calls`, so an outcome can be explained: `applied`,
  `unchanged`, `kept`, `invalid` or `dropped`. It reaches no log, trace, diagnostic or published record.
- **Rename.** Open **Details**, then **Conversation settings**, and enter a
  name under **Rename conversation** (at most 80 characters). The page sends
  the `rename` action of `assistant-control/2.1`. The owner's name replaces any
  generated title. It is not permanent: later checks tell the model the title
  is the owner's, and only when the model judges that the topic clearly
  changed does a generated title replace it, with source `provider`. A title
  call still in flight is abandoned with the follow-up check waiting behind
  it, and an answer that arrives after the rename is dropped. Each admitted
  check also advances the conversation's title generation, so an answer that
  settles after a newer check, such as one past the 30 second deadline, is
  dropped too. A name that is not display text is refused with
  `invalid-request`.
- **Spend.** Each check is a paid title call, `KEEP` included. It reserves its
  most expensive cost in the shared spend ledger as a conversation-level call
  before it is sent, and its reported usage replaces the reservation; a lost or
  failed answer keeps the reservation counting. A call that the spend limits
  refuse is not sent, and the persona or earlier title stays; the next check
  waits for the next trigger. Title calls count toward the shared
  spend limits and toward no task's limits. The default title model,
  `claude-haiku-5-5`, is priced at its built-in tiers, and a title model the
  table does not know at the dearest known rate, so no title call is refused
  for want of a price (Hub #2047). A title call that Anthropic's monthly spend
  limit refuses fails with `capacity`, is not retried, and keeps the earlier
  title or the persona, as any failed title call does. Each call is also recorded on its conversation in
  `assistant_title_calls` with its model, status, outcome and reported usage.

The title instruction, prompt and normalization are adapted from OpenAI Codex
(Apache License 2.0) and T3 Code (MIT License); see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

### LIFX status and controls

Allow `read_lifx`, `set_lifx_power`, or `set_lifx_brightness` in the private
Conversation tool list. Read status by a configured light name or routing ID.
A read reports the last observation and supported controls. Conversation labels an observation stale after 30 seconds or when it predates a command. An explicit stale read requests the owner's rate-limited refresh. An unchanged result can retain its original observation timestamp. If several lights
match a write, Conversation asks for the exact ID. It binds the setting to the
selected light's configuration revision and generation. The core tracks the
operation. Expand **Tool result** to inspect its receipt and evidence.

### Wemo status and power

`read_wemo` reports the plug's observed power, freshness, and hold state.
`set_wemo_power` switches the named plug to the requested state. An explicit
request for “all Wemo plugs” binds the current eligible set and gives each
plug its own operation ID. The Wemo owner checks each plug's configuration,
generation, queue and hold. The existing maximum-on policy applies.

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
permissions keep their original names. The existing owner command checks
device revisions, generation and capability. The tracked operation shows
acceptance and available effect evidence.

| Configured owner | Conversation operations |
| --- | --- |
| LIFX and Wemo | Device reads, power, LIFX brightness and color, Wemo hold release |
| Nanoleaf | Power, brightness, operating mode, scenes, moments, animations, wall and machine edits, favorites, notice acknowledgment, reactive presets and saved show versions |
| Pixoo and Tidbyt | Supported display power, brightness, operating modes, moments and saved artwork. Pixoo also offers Monitor, Media, now playing, playlists, assets and notices |
| Playback and Volcano | Playback controls and the Volcano software session-gap setting |
| Core | Hub mode, device mode overrides, session labels, notice clearing, Inbox handling, layouts and tracked light show playback |
| Art | Saved artwork edits and presentation. Paid generation keeps its explicit approval |

Roborock offers status only. ONN is hibernated. Conversation's Inbox Send
again follows the existing requester and replay rules for the saved command.

For Pixoo brightness and Wemo power, Conversation waits up to a second within the tool budget
for the owner's reading for that request. The original reply reports the
observed setting when it has arrived. If confirmation is pending when the
reply is saved, a later result appears once with a link to the earlier reply.
The saved dispatch receipt lets Companions resume observation on restart. A
follow-up expires after one day.

`read_saved_art` offers saved artwork IDs and compositions.
`control_art_show` uses the existing `art-show` preparation and presentation
path. `read_art_show_effects` uses the tracked request ID to show each
display's preparation and presentation evidence. A skipped phase shows its owner refusal.
If the evidence is unavailable, the phase reports that separately.

For light shows, `create_light_show_draft` uses a Nanoleaf starter timeline.
`edit_light_show_cue` applies edits against the current draft revision.
`preview_light_show_draft` shows cue timing, colors and intensity.
`save_light_show` writes the requested version to the existing Nanoleaf catalog. Each immutable version can confirm its save by request
identity after a lost reply. If the save expires without a matching version,
the owner can make a new save request against the catalog's current revision.
`read_light_shows` pages through drafts, saved versions and lighting sessions.
Supply an exact ID for its records, or leave it empty to list a category.
`control_music_lighting_control` starts playback of one exact saved version
on an eligible light. Stop, pause, resume and seek bind the active generation.
Drafting, editing, previewing and saving send no lighting command.

### Conversation history contract

The existing authenticated `GET /modules/companions/content/conversation`
read accepts `profile=bunny`, `profile=reachy` or `profile=microduck`. A
conversation ID that is not one of the profile's own is `not-found`. With
only `profile` and optional `after` it returns version 1, in ascending order
after that sequence (default 0). The first page includes `currentTask`; later
pages return `currentTask: null`. The existing panel still uses version 1.

For version 2, add `view=recent` and omit `after`:

| Request | Result |
| --- | --- |
| `profile=bunny&view=recent` | Newest saved window and latest task/question |
| `profile=bunny&view=recent&before=<older>` | Older window, with `currentTask: null` |
| `profile=bunny&view=recent&conversationId=<id>` | Newest window of one of the profile's earlier conversations (Hub #2029), with `currentTask: null`; add `before` to page it |
| `profile=bunny&view=queue` | The current conversation's queued messages and hold (Hub #2030); see [Queued messages](#queued-messages) |
| `profile=bunny&view=list` | The profile's conversations, 16 a page, the current one first and then the others by their last message, newest first: `{version: 1, profile, conversations, older}`, each with `conversationId`, `current`, `messages`, `firstAtMs`, `lastAtMs` and its published `title`; pass `older`, a keyset cursor (`<last message time or -1>:<row>`), back as `after`, so a conversation that changes between page reads never repeats or skips an unchanged one |

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

After the root build, run `node apps/runtime/dashboard/tests/failed-turn.browser.ts` for the scripted clarification, failure and reload journey.

After the root build, run `node apps/runtime/dashboard/tests/conversation-context.browser.ts` for a follow-up's recent context, New conversation held while a task waits, the fresh conversation, an earlier conversation opened read only from Details and the model context preview, at 1280 and 390 px.

Run the root build and `npm run test:companions:built` for abrupt process exits,
pending-write fidelity, unknown-call recovery, cancellation, budgets, full disk,
outbox replay and private pagination, plus `assistant.test.js` (approval,
decline, stale approval, uncertain dispatch, allowlist refusal, refusal,
truncation and fault codes, profile isolation), `assistant-sessions.test.js`
(each conversation's shared-session observations across its tasks, restart and
baseline, Hub #505), `conversation-titles.test.js` (title normalization,
prompt, event labels, the title call, keep and new titles after finished tasks
and major events, coalescing, late answers, rename then topic change, spend
refusals and failures, Hub #2025 and #2075), `conversation-context.test.js`
(the context builder's sections, budgets and stated trims, recent context
fixed at task start, New conversation and earlier conversations, the
knowledge switch, the preview and the follow-up cases, Hub #2029),
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

**Model context** turns knowledge notes on or off for the chosen companion's
model and previews exactly what its next model call sends, as
[Recent context and New conversation](#recent-context-and-new-conversation)
describes. Knowledge notes reach no model until the owner turns them on for
that companion.

To copy context elsewhere, choose a persona, optionally choose a conversation
and up to 16 messages, then **Preview context to copy** or **Copy current
context**. Each click reads current active knowledge/preferences and the
selected permitted messages. Other personas' private conversations, inactive
entries and historical knowledge snapshots are excluded. Corrections and
removals affect the next read. A large copy is refused rather than silently
truncated. Copying sends nothing to a model. Copied data grants no permission
or current location evidence.

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

A knowledge command is refused as stale (`revision-conflict`) only when the state
it changes changed after the revision it names, or when that revision is ahead of
the assistant's (Hub #2056). A running conversation's steps never refuse it.

| Action | Checked against and recorded as changed |
| --- | --- |
| `create`, `edit`, `import`, `set-active`, `set-voice`, `fixture` | the library |
| `import-archive` | the library, and each conversation it adds to: a conversation or profile binding not yet saved, a removal not yet known, or a new message |
| `select-duck-conversation` | the Duck widget selection |
| `correct-message`, `delete-message` | the message's conversation, found through its removal record once removed |

The library and the Duck widget each keep the assistant revision of their last
change in `companion_scope_changes`. Conversations use the per-conversation
change revision of Hub #2027, so a correction or removal also counts as a change
of that conversation for its own task commands. A correction of an earlier
message is still refused when its own conversation's running task took a step
after the page's read. An archive whose records are all present changes no conversation. Each start
counts both scopes as changed at the revision it started with. The page keeps
sending the one revision it read.

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
the existing expected revision, checked only against the selection's own last
change. It reuses authenticated staging, tracked outcomes and assistant-state
invalidation. One additive singleton row stores the selection
on the same SDK SQLite connection. Archive import leaves that local choice alone;
fresh archive recovery requires explicit reselection. **Clear Home conversation**
clears only this choice, retaining messages and Home placement.

Companion tests, the `companion-knowledge` runtime scenario and companions browser
journey check this source behavior with synthetic records. Installed widget and
real conversation/output acceptance remain separate.

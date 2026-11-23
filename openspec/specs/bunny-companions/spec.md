## Purpose

Provide attributed fixed-text virtual Reachy cards in the existing dashboard from qualified coding occurrences and clearly isolated synthetic scenarios.

## Requirements

### Requirement: Qualified live coding cards
The system SHALL reduce supported Codex and Claude metadata once in the core and admit at most one companion opportunity from the first live publication. Each card SHALL preserve source/event, source revision and generation, known session/turn/attention identity, evidence, occurrence time and validity deadline. Unknown identity SHALL remain unknown.

#### Scenario: Attention requests a person
- **WHEN** a current qualified question, input or approval occurrence arrives with companions enabled
- **THEN** Reachy identifies its session and requests human attention without answering, recommending approval or launching a worker
- **AND** required coding attention remains eligible in Work and Quiet

#### Scenario: A turn ends without content
- **WHEN** a qualified current turn-ended occurrence arrives
- **THEN** the quiet card states only that the turn ended and content is unavailable
- **AND** it invents no success, summary, test result or next prompt

#### Scenario: Recovery and duplicates
- **WHEN** input is duplicated, stale, out of order, recovered from an outbox, synced, reconnected or restarted
- **THEN** it creates no new reaction admission
- **AND** restart or return to Free never replays missed opportunities

### Requirement: Final validity and bounded arbitration
The system SHALL retain one active reaction and at most one waiting candidate per coding-attention, coding-notice and simulated-social category. It SHALL coalesce source/session candidates, discard obsolete or expired evidence and give coding attention precedence within its question window. It SHALL recheck enablement, mute, mode, the opportunity's match to its session (generation, identity, turn, and the attention item or notice it names), output availability and expiry after asynchronous waiting and immediately before presentation. No session freshness, restart or session-age term SHALL refuse a live card.

#### Scenario: State changes during delivery
- **WHEN** a delivery waits and attention clears, a turn is superseded, mode changes restrictively, a category is muted, companions are disabled or evidence expires
- **THEN** the final validity check refuses the obsolete presentation with an inspectable reason
- **AND** core attention remains usable

#### Scenario: Output cannot complete
- **WHEN** input is malformed or refused, or presentation is unavailable, fails or times out
- **THEN** the result truthfully reports refusal or unavailable presentation
- **AND** no second endpoint is tried and emitted state is never claimed to have been seen

#### Scenario: A quiet session's notice
- **WHEN** a turn-ended opportunity arrives for a session that was silent for six minutes before the turn ended
- **THEN** the card is admitted while its opportunity matches and is valid

### Requirement: Isolated simulated social decisions
The system SHALL label arrival and visit fixtures as synthetic, with identity and location explicitly unknown, and route them through the same admission, text and presentation functions. Social admission SHALL require fresh Free mode, known non-busy/non-media facts, no open question priority window, no snooze, and one shared allowance of three episodes per local day with at least three hours between episodes. Scenario facts, repetition and allowance SHALL remain isolated from live household facts and records. Seeded variation and fixed-clock decisions SHALL be repeatable.

#### Scenario: Mixed synthetic priorities
- **WHEN** a simulated arrival and coding question compete in a labelled scenario
- **THEN** coding attention wins and synthetic arrival cannot become real perception, memory, speech or physical output

#### Scenario: Budget and snooze
- **WHEN** a scenario exceeds repetition, the shared social budget or spacing, has unknown busy/media evidence, or is snoozed
- **THEN** it produces no social reaction and exposes the corresponding decision reason
- **AND** scenario admission spends no live social slot

### Requirement: Persistent optional dashboard presence
The module SHALL persist only settings and bounded admission/repetition/presentation records privately. It SHALL sync authoritative core state, keep pending candidates in memory only, preserve a saved card as history without another reaction, and default to disabled. The authenticated React page SHALL expose enablement, category mute, social snooze, source/session, real versus simulated metadata, evidence, selected text and a code-owned reason. Existing hook and session attention behavior SHALL remain usable independently of this module. The default implementation SHALL perform zero model calls, audio output or device commands.

#### Scenario: Controls and restart
- **WHEN** an authorized operator changes enablement or category controls and restarts
- **THEN** controls persist and no pending or missed reaction is replayed
- **AND** a saved card is explicitly history, not newly observed activity

#### Scenario: Legible and read-only interface
- **WHEN** a reader opens the page or a keyboard user operates it
- **THEN** source metadata and decision reasons are legible
- **AND** reader authority cannot change controls or submit fixtures

### Requirement: Deliberate grounded coding suggestions
The Reachy page SHALL accept a bounded owner-supplied form for one known synced coding session and named task, with explicit check statuses, observation time, evidence references and owner-reported current and evidence revisions. Passed, failed, skipped, unrun and unknown SHALL remain distinct. Unknown turn, base or repository SHALL remain unknown. Input and preview SHALL remain transient browser data, without capture, persistence or provider calls.

#### Scenario: Tests pass and browser is unrun
- **WHEN** the owner supplies fresh matching-head evidence for passed tests and an explicitly unrun browser check
- **THEN** a deterministic inspect/copy prompt proposes the browser check and shows both statuses, references, attribution, target task/session/turn, known revisions and expiry
- **AND** the result makes no independent claim that tests passed

#### Scenario: Insufficient or ambiguous evidence
- **WHEN** only turn-ended metadata exists, task identity is absent, a claim is unsupported, evidence is stale/future, a result is ambiguous or head revisions differ
- **THEN** the page shows no proposal or an explicit evidence gap without invented success

#### Scenario: Isolated supersession without replay
- **WHEN** task/session/context changes, newer evidence replaces the form, older evidence is submitted, or a disconnect/reconnect/sync occurs
- **THEN** the old proposal cannot be copied or contaminate the new task/session, older evidence cannot restore it, and sync never admits a proposal
- **AND** identical repeated inspection creates no additional admission

### Requirement: Policy guarded inspect and copy
Suggestions SHALL reuse Reachy enablement/category mute, the exact synced session, revision, generation and turn, the suggestion's own evidence window and the question priority window. The page SHALL recheck policy, source context, input and expiry immediately before copy. Copy SHALL occur only on the owner's explicit action; it SHALL change only the clipboard. Keyboard and narrow viewport inspection SHALL be supported.

#### Scenario: Policy or source changes
- **WHEN** Reachy is disabled/muted, output/core is unavailable, a question's priority window is open, the selected session/turn changes or evidence expires
- **THEN** the suggestion is unavailable with a reason and cannot be copied
- **AND** normal session attention remains independent

#### Scenario: Explicit clipboard and safe failure
- **WHEN** the owner inspects without copying, explicitly copies, or clipboard access fails
- **THEN** inspection changes no clipboard, a valid explicit copy contains the attributed prompt, and failure reports that copying could not be confirmed
- **AND** no composer typing, harness API, submission, approval, task continuation, audio or device command occurs

#### Scenario: A session quiet after its turn
- **WHEN** the owner inspects a suggestion for a session whose turn ended ten minutes ago, with fresh matching evidence
- **THEN** the session's silence does not make the suggestion unavailable

### Requirement: Explicit browser speech availability
Speech SHALL default to off. Enabling text companions SHALL NOT enable speech. An authorized operator SHALL explicitly select one qualified browser endpoint and declare availability for its current connection. The UI SHALL explain that calls and other applications are not detected and that the operator must mute before interruption-sensitive activity. Quiet, category mute, stale or cleared attention, missing live state and unavailable output SHALL prevent new unsolicited speech. Work and Free SHALL permit a fresh eligible coding question after explicit enablement.

#### Scenario: Independent enablement
- **WHEN** text companions are enabled but speech has not been enabled on the current connection
- **THEN** eligible coding attention remains visible and produces zero audio

#### Scenario: Current question with permission
- **WHEN** the selected endpoint receives a fresh coding question in Work or Free with live evidence, enabled text and speech, manual availability and an unmuted category
- **THEN** it can speak the existing fixed phrase once after a final policy check
- **AND** Quiet, mute or cleared attention before playback suppresses the output

#### Scenario: Availability ends with the endpoint
- **WHEN** the selected endpoint reloads, disconnects, is lost, unmounts or observes runtime restart
- **THEN** its availability is invalidated and any local speech is cancelled
- **AND** reconnect requires explicit enablement, admits only new opportunities and never selects another tab

#### Scenario: Presentation changes during browser speech
- **WHEN** the selected Conversation tab changes profile, resizes, or opens or closes Voice or Details
- **THEN** it keeps the same selected endpoint and any eligible playback continues
- **AND** the controls explain when Enable is unavailable, another tab remains excluded, and reload or reconnect requires a fresh Enable

### Requirement: Qualified local voice and bounded playback
Missing installation qualification, an unavailable browser identity or a browser other than Google Chrome on macOS SHALL leave speech unavailable while preserving text companions. The receipt's browser version SHALL remain historical qualification metadata; a different Chrome version SHALL NOT invalidate qualification. Each enable action SHALL re-enumerate voices with a five-second bound and require an exact qualified local English voice. The driver SHALL select that voice explicitly on each utterance without changing defaults or falling back to a default, remote or changed voice. It SHALL perform no microphone, recording, cloud synthesis or automatic retry. Playback SHALL have a finite deadline and SHALL report completion only after an ordered start and end callback. Callback completion SHALL NOT mean heard.

#### Scenario: Browser qualification unavailable
- **WHEN** the installation has no valid private qualification receipt or the page cannot identify Google Chrome on macOS
- **THEN** speech remains unavailable without disabling text companions or selecting a replacement route

#### Scenario: Chrome updates after qualification
- **WHEN** Google Chrome on macOS reports a different version from the valid private qualification receipt
- **THEN** the version difference does not prevent explicit speech enablement
- **AND** the exact local English voice and all current connection, authority and availability checks still apply

#### Scenario: Voice unavailable
- **WHEN** the qualified voice is absent, changed or not local after the bounded enumeration
- **THEN** speech remains unavailable and zero utterances are submitted

#### Scenario: Ambiguous output
- **WHEN** an end arrives without a start, callbacks are lost, a deadline passes or the endpoint connection is lost after submission
- **THEN** the operation remains uncertain and no utterance is replayed

#### Scenario: Stop and mute
- **WHEN** the operator stops or mutes active speech
- **THEN** local cancellation runs immediately, pending speech is discarded and the UI distinguishes a confirmed stopped state from uncertain cancellation
- **AND** partial playback remains recorded and stopping does not cancel a coding task or grant permission

### Requirement: Single speech coordinator
The companions owner SHALL reserve one browser endpoint, admit one active announcement and, waiting, at most one card and one reply per conversation, and reuse its existing opportunity, deduplication, admission and fixed-text rules. It SHALL also admit a saved assistant reply as a candidate: the result, question or refusal that ended a task turn, or a saved assistant message the owner asked to hear again, each identified by its message and, for a replay, the owner's request. A reply SHALL rank with actionable coding attention: above notices and social speech, never above an active equal. Actionable coding attention SHALL take priority over social speech. A newer card of equal or higher rank SHALL replace the waiting card. A newer reply of the same conversation, a replay included, SHALL replace that conversation's waiting reply, while replies of other conversations SHALL be kept, and a reply and a card SHALL NOT replace each other. The voice SHALL take the waiting candidate of the highest rank first, then the earliest arrival; each SHALL still be dropped when it passes its deadline, 60 seconds for a reply. Only a strictly higher rank SHALL cut off an active announcement. Replacement SHALL wait for confirmed cancellation and SHALL recheck current policy after every asynchronous wait and immediately before submission. A reply SHALL be refused in Quiet, without the synced Hub mode, or after its deadline, and SHALL NOT depend on Reachy's text enablement or category mutes. Uncertain output SHALL prevent automatic replacement. Speech suppression SHALL NOT suppress ordinary visual coding attention. Existing synthetic scenario controls SHALL produce zero audio.

#### Scenario: Competing candidates and tabs
- **WHEN** two tabs enable speech or duplicate and competing opportunities arrive
- **THEN** one reserved endpoint receives at most one active command, with at most one waiting card and one waiting reply per conversation
- **AND** a second tab cannot take over and duplicate opportunities cannot speak again

#### Scenario: Separate social allowance
- **WHEN** a social candidate is blocked by its Free-only, busy, media, snooze, daily or spacing policy
- **THEN** it cannot consume coding admission or hide visual coding attention
- **AND** manual coding availability does not qualify unknown social inputs or make scenario fixtures audible

#### Scenario: Durable result without replay
- **WHEN** an accepted speech operation restarts before its receipt is committed
- **THEN** the owner reports uncertainty through its existing outcome path without restoring availability or executing the utterance again

#### Scenario: Reply among other candidates
- **WHEN** a saved reply is offered while a notice is playing, then a second reply of the same conversation arrives while the first reply is waiting
- **THEN** the notice is stopped and the newest reply alone plays after confirmed cancellation, a coding question offered during the reply waits for it, and the same reply key never speaks twice

#### Scenario: Reply refused by policy
- **WHEN** a reply is offered in Quiet, without a synced Hub mode, after its deadline or before the endpoint was enabled
- **THEN** no utterance is sent and nothing is caught up when speech is enabled later

#### Scenario: Replies from several conversations
- **WHEN** one reply is speaking and, while it plays, replies from two other conversations, two replies from the speaking reply's conversation, a coding question card and a reply that goes stale arrive
- **THEN** nothing of equal rank interrupts, and afterwards the voice speaks the other two conversations' replies, the card and the newest reply of the first conversation in arrival order, while the replaced and the stale replies never speak

#### Scenario: Highest rank first
- **WHEN** a notice card and then another conversation's reply wait behind a speaking reply
- **THEN** the reply speaks before the earlier notice, which then still speaks

#### Scenario: Stop clears every waiting candidate
- **WHEN** the owner stops speech while replies from several conversations and a card wait
- **THEN** none of them speaks afterwards

### Requirement: Explicit recovery of orphaned speech
After restart, an authorized operator SHALL be able to release an orphaned uncertain speech reservation by naming the current operation and revision and confirming that playback in earlier voice tabs is stopped or those tabs are closed. The UI SHALL also cancel local synthesis and refuse recovery while local output remains active. Recovery SHALL preserve the original uncertain playback and tracked outcome, retain consumed candidate identities and require a separate fresh enable action. It SHALL NOT replay an utterance, claim completion or automatically release a later uncertain operation.

#### Scenario: Recover after restart
- **WHEN** uncertain speech survives restart and the operator explicitly recovers the advertised orphan after stopping earlier playback
- **THEN** the acknowledgement survives another restart, speech remains off until enabled, and a new eligible reply can speak without replaying the old candidate

#### Scenario: Unsafe or stale recovery
- **WHEN** a recovery names stale state, lacks confirmation, lacks control authority, or an endpoint or live attempt is still reserved
- **THEN** it is refused without releasing a reservation or producing speech

#### Scenario: Recovery cannot be saved
- **WHEN** the acknowledgement or state revision cannot commit
- **THEN** recovery is refused with the shared storage error code and the old reservation remains blocked

#### Scenario: Browser recovery loses its connection
- **WHEN** the browser disconnects, navigates away or receives an ambiguous reply during recovery
- **THEN** it submits no automatic retry and enables no speaker

### Requirement: Thirty-second question priority
An unanswered question, input request or approval SHALL take priority over background cards, simulated social cards, suggestions and automatic speech for 30 seconds from its own evidence instant on the reporting host's clock, as the existing opportunity's validity sets it. The companions module SHALL hold the window in memory from every admitted coding-attention opportunity it receives, whether or not its card is shown, and the window SHALL end early when the attention item clears. The browser's suggestion and final speech checks SHALL take the window only from the live question card Reachy presents, so a muted question, or a presented question that a later question replaced, SHALL NOT hold the suggestion page, while the module's check still holds background cards and automatic speech. The question SHALL stay visible afterward. Unrelated progress SHALL NOT renew the window, and a restart SHALL start no new window. Explicitly requested assistant answers SHALL stay outside this rule. When the reporting host's clock runs ahead of the hub's, or 30 seconds or more behind it, the core SHALL drop that question's opportunity as today, so the question gets no priority window while status devices still show it; a host clock behind by less SHALL shorten the window.

#### Scenario: Inside and after the window
- **WHEN** a question is raised and a background card waits, and the clock moves to 29 s and then 30 s after the question's evidence instant
- **THEN** the card is refused with `attention-priority` at 29 s and admitted at 30 s, while the question stays shown

#### Scenario: Progress and restart
- **WHEN** unrelated progress arrives 20 s after a question, and the runtime restarts while the question is still open
- **THEN** progress does not extend the window, and after the restart no window is open and no card or speech replays

#### Scenario: A muted question
- **WHEN** the coding-attention category is muted and a question is raised, and a background card waits and the owner inspects a coding suggestion 10 s later
- **THEN** the module refuses the card with `attention-priority`, and the suggestion page, which sees no presented question card, is not held

#### Scenario: A replaced question
- **WHEN** question A is presented, question B replaces it 5 s later and B is answered at 10 s, while A is still open
- **THEN** until 30 s after A's evidence instant the module still refuses background cards and automatic speech with `attention-priority`, and the suggestion page, whose presented card is B's, is not held

#### Scenario: A host clock ahead of the hub
- **WHEN** the reporting host's clock runs a minute ahead of the hub's and the host reports a question
- **THEN** the core raises no opportunity for it, no priority window opens, and the session still needs the owner on every status device

#### Scenario: A host clock behind the hub
- **WHEN** one host's clock runs 40 seconds behind the hub's and another's runs 10 seconds behind, and each reports a question
- **THEN** the core raises no opportunity for the first, and the second's priority window ends 20 seconds after the hub received it

# chompi-task-routing Specification

## Purpose

Define how the CHOMPI bridge maps stable task keys to Codex and Claude Desktop tasks from the Hub feed: slot assignment and release, light states, the fail-closed focus and composer checks, Wispr dictation, explicit Send, wheel scrolling and the versioned JSON profile.

## Requirements

### Requirement: Stable first-free task slots
The bridge SHALL assign root Codex Desktop threads (keyed by thread ID) and root Claude Desktop sessions (keyed by `hostSessionId`) to the lowest free of slots 1-15, keyed by the full provider, client, host, source and task identity. Simultaneous discoveries SHALL be placed in provider, client, host, source and task ID order. Assigned slots MUST NOT move. When all slots are full the bridge SHALL report overflow without moving or evicting a slot. Slots SHALL persist in a private bridge file written atomically, separate from Hub retention, and an invalid file SHALL stop start-up rather than reassign slots. Sessions with a known parent SHALL NOT receive slots.

#### Scenario: First free slot after a release
- **WHEN** slots 1 and 2 hold tasks A and C, slot 1 is released, and tasks B and D appear in one snapshot
- **THEN** B takes slot 1 and D takes slot 3, and C stays in slot 2

#### Scenario: Restart and reconnect
- **WHEN** the bridge restarts, the controller reconnects or the Hub restarts and omits the Desktop ID until the next event
- **THEN** every task keeps its slot and its key still shows that task's state

#### Scenario: Full capacity
- **WHEN** a sixteenth task appears
- **THEN** it is reported as overflow, no slot changes, and the next freed slot goes to the first overflow task in sort order

#### Scenario: Duplicates
- **WHEN** two tasks share a title, one thread ID appears from two sources, or one Claude Desktop ID has two Hub records after `/clear`
- **THEN** distinct identities get distinct slots and one Desktop ID is one slot shown from its newest record

### Requirement: Release only on explicit evidence
The bridge SHALL release a slot only when the adapter reports the Codex thread archived, the Claude Desktop record archived, or the owner's Claude release gesture (slot key held for the configured hold, then Loop) is used. Absence from the feed, Hub retirement or expiry, idle, a stale feed, a missing Desktop record and unknown observations MUST NOT release a slot. A released task SHALL stay out of the slots until it shows lifecycle evidence newer than its release. The gesture on a Codex slot SHALL only light the error state.

#### Scenario: Hub retires a session after idle
- **WHEN** the Hub drops a slotted session
- **THEN** the slot is kept, its key shows ended and pressing it opens the same task

#### Scenario: Claude release gesture
- **WHEN** the owner holds a Claude slot's key past the hold time and presses Loop
- **THEN** that slot is released and persisted, and the Claude session is not placed again until it shows new activity

### Requirement: Distinct state lights
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse. Slot keys SHALL show task state only: no key marks a selected or targeted task, so focusing a task never looks like acknowledging it. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused slot press SHALL light that key's error state briefly. The big-wheel LEDs SHALL stay off, because Send and card answers are decided at the press and nothing polls the window in front. The renderer SHALL provide a state label for every slot.

#### Scenario: Unknown never looks completed
- **WHEN** a session's freshness is uncertain or the feed is stale while a completion notice is unacknowledged
- **THEN** its key shows unknown or stale, not the completion color

#### Scenario: Attention is not acknowledged by a key press
- **WHEN** the owner presses a pulsing key
- **THEN** the task is focused, its key keeps pulsing with the attention color and the bridge sends nothing to the Hub

### Requirement: Fail-closed exact-task focus
A slot key press SHALL cancel any focus still in progress, release every held key and run, in order: the target check (slot assigned, client version qualified, Codex thread not archived, Claude Desktop record present and not archived), the fixed deep link for that task, verification of the foreground package family and the selected task, and composer focus. Codex selection SHALL require the selected row to match the thread's name with exactly one row of that name, where the name is the one Codex keeps for the thread in its local session index, or the slot's last-known Hub title when Codex has never named the thread; with neither, verification SHALL fail closed as `title-missing`, and when any other thread in that index currently has the name, rendered or not, it SHALL fail closed as `title-not-unique`, in both cases without typing. Claude selection SHALL pass only when either (a) only the target's `lastFocusedAt` advanced past the press, or (b) before the link Claude Desktop owned the foreground and a complete read of every known Desktop ID showed the target's `lastFocusedAt` strictly greater than every other known session's, and after the link the target's is still strictly greatest and no other session's `lastFocusedAt` moved past the press; otherwise it SHALL fail closed. Both are checked against every known Claude Desktop ID read in bounded calls, never a truncated subset. Rule (b) exists because Claude Desktop advances `lastFocusedAt` only when the selection changes; a tie, a foreground that is not Claude or is unknown, or any unknown or failed read before the link SHALL give no (b) evidence. Verification SHALL poll observations within a bounded time and SHALL NOT repeat the link or any keystroke. An unqualified or unknown client version SHALL disable that client's routing and leave the other client unaffected, because UI selectors (and Claude's undocumented link) depend on the version, and the log SHALL name the observed version. The version gate SHALL apply before any input, not only before opening: it SHALL run again after verification and before the composer shortcut. At start-up the bridge SHALL warm the adapter, when it offers a warm-up, before the controller connects. Any failure or unknown SHALL light the key's error state and log the step and reason without titles. A successful focus leaves the task in front with its composer focused and arms nothing: Send and Record never depend on an earlier slot press. A task key press MUST NOT acknowledge, approve or dismiss anything.

#### Scenario: Foreground alone is insufficient
- **WHEN** Codex comes to the front but keeps another task selected
- **THEN** verification fails, nothing is typed and the key lights its error state

#### Scenario: Codex thread without a Hub title
- **WHEN** the Hub has no title for a Codex slot's thread and Codex's session index names it
- **THEN** verification compares the selected row with Codex's name and focus can succeed

#### Scenario: Codex thread with no name anywhere
- **WHEN** neither Codex's session index nor the Hub has a name for the thread
- **THEN** verification fails as `title-missing`, nothing is typed and the key lights its error state

#### Scenario: Codex name shared with a hidden thread
- **WHEN** another thread in Codex's session index has the target's name but its sidebar row is collapsed, archived or deleted
- **THEN** verification fails as `title-not-unique` and nothing is typed

#### Scenario: Duplicate Codex titles
- **WHEN** two open Codex tasks share the slot's title
- **THEN** Codex verification fails closed, while Claude tasks still verify by Desktop ID

#### Scenario: Many Claude sessions
- **WHEN** more than 63 Claude Desktop sessions are known and one of them besides the target also became visible
- **THEN** verification reads all of them and fails as ambiguous

#### Scenario: Claude session already selected
- **WHEN** Claude Desktop is in front showing the slot's session, whose `lastFocusedAt` is strictly the newest of every known Desktop session, and the link leaves every `lastFocusedAt` unchanged
- **THEN** verification passes without repeating the link or adding a keystroke, while a tie, a newer or newly moved other session, an incomplete read before the link or Claude not in front before the link fails closed

#### Scenario: Unqualified client
- **WHEN** the installed Claude Desktop or Codex version is not listed
- **THEN** that client's slots open nothing and the other client's routing is unaffected

#### Scenario: Client update noticed after the link opens
- **WHEN** the gate passes on a cached version and the adapter reports an unlisted or unknown version once the updated client is in front
- **THEN** nothing is typed, not even the composer shortcut, the key lights its error state and the log names the observed version

### Requirement: Dictation like a keyboard shortcut
Record SHALL hold the profile's dictation chord when it is pressed and release it on the Record release, including a synthetic one, with no foreground, card or composer check, so Wispr dictates into whatever is in front, a card's free-text field included. Record SHALL be refused only while a Send is typing. If the chord cannot be pressed, the bridge SHALL release every key it holds. Releasing Record MUST NOT send.

#### Scenario: Record then release
- **WHEN** the owner holds Record with any app in front and releases it
- **THEN** the chord goes down and up once and no Enter is typed

#### Scenario: Record while a card is open
- **WHEN** the owner holds Record while a Claude card is open
- **THEN** the chord goes down, because Record makes no card check

### Requirement: Explicit single Send
Send SHALL be evaluated when a Send control is pressed, against the foreground window at that moment, and SHALL type exactly one Enter only when the foreground app's package family is Codex or Claude Desktop, that client's version is qualified, the adapter reports composer focus as known `true` and approval visibility as known `false`, the repeat window since the last Send or card press has passed, no other Send or card press is running and Record is not held. Anything else SHALL refuse with a reason code and type nothing; with any other app in front, or no window, Send SHALL refuse as `not-agent-client`. Send SHALL NOT depend on an earlier slot press and SHALL NOT consult the Hub: neither Hub `approval` attention nor a stale or unavailable feed blocks it, and the adapter's card check, which reports Claude question and permission cards alike, is its only approval guard. An uncertain keystroke MUST NOT be retried. Small-knob clicks, the volume click, encoder turns, slot keys, Record and Back MUST NOT send, and the profile MUST NOT be able to map them to Send. While a card is open the big-wheel click SHALL answer the card instead of sending, and Play MUST NOT press a card button.

#### Scenario: Send to the task in front
- **WHEN** the owner clicks into a Codex or Claude task with the mouse, with its composer focused and no card open, and presses Play
- **THEN** one Enter is typed without any slot press

#### Scenario: Repeated wheel click
- **WHEN** the big-wheel click or Play arrives again within the repeat window after either one sent
- **THEN** one Enter is typed

#### Scenario: Another app in front
- **WHEN** a Send control is pressed while an app other than Codex or Claude Desktop is in front
- **THEN** Send is refused as `not-agent-client` and nothing is typed

#### Scenario: Pending approval
- **WHEN** Play is pressed while the adapter reports an approval card visible in the client in front
- **THEN** Send is refused as `approval-visible` and no card button is pressed

#### Scenario: Claude question card open
- **WHEN** a Claude question card is open, which carries the same class token as a permission card, and a Send control other than the big-wheel click is pressed
- **THEN** Send is refused and no Enter is typed

#### Scenario: Approval visibility not qualified
- **WHEN** the adapter answers approval visibility as unknown, as the Windows adapter does when Codex shows no composer
- **THEN** Send is refused and no Enter is typed

#### Scenario: Task switch before Send
- **WHEN** another slot key is pressed after Record and before Send
- **THEN** the press ends dictation and releases the chord, and the next Send is evaluated against the window in front at its own press

#### Scenario: Hub approval is not consulted
- **WHEN** the Hub shows `approval` attention for a task, or the feed is stale, while the client in front has its composer focused and no card visible
- **THEN** Send types one Enter, because the card check is Send's only approval guard

### Requirement: Big-wheel scrolling
Outside a card, a big-wheel turn SHALL scroll the foreground Codex or Claude conversation through the adapter's mouse-wheel primitive, by the profile's notches per encoder count, in the profile's direction, and SHALL do nothing for any other app. Before a qualified client scrolls, the router SHALL observe its card state, reusing an observation for at most 500 ms: a card turns the wheel into card navigation and an unknown card state makes the turn do nothing. A client at an unqualified version SHALL scroll without card navigation. Scrolling MUST NOT type, send, select a task or change anything Send depends on, MUST NOT run while Record is held, and a `false` or unknown result MUST NOT be retried. Outside a card the big-wheel click remains Send.

#### Scenario: The wheel scrolls and its click sends
- **WHEN** the owner turns the big wheel with Codex in front and no card open, and then clicks it
- **THEN** the conversation scrolls without any keystroke, and the click types one Enter

#### Scenario: Scroll without a selected task
- **WHEN** no slot key was pressed and Claude is the foreground app with no card open
- **THEN** the turn scrolls Claude, and with any other app in front it does nothing

#### Scenario: Scroll during dictation or with an unknown result
- **WHEN** Record is held, or the adapter answers unknown
- **THEN** nothing scrolls or is retried

### Requirement: Release on loss
A bridge `stale`, `session-restart` or `disconnected` event, an overflowed event subscription, Back, a profile swap and shutdown SHALL cancel any focus in progress and pending wheel steps, end dictation and release every key the adapter holds. No earlier input SHALL be replayed: after recovery, each control acts only on a fresh press, evaluated at that press. SIGINT, SIGTERM, SIGHUP and SIGBREAK SHALL stop the bridge the same way. On any process exit the adapter's synchronous release SHALL run when the adapter offers one, and an uncaught exception or unhandled rejection SHALL release keys, report the error and exit non-zero.

#### Scenario: Disconnect during Record
- **WHEN** the controller disconnects while Record is held, and then reconnects
- **THEN** the chord is released, no draft is sent and nothing is typed by the reconnect, and a Send pressed after the reconnect is a new press evaluated against the window then in front

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings, optional card-navigation settings and qualified versions for both clients, and no URIs, paths, commands or package identities. Fields added after the first release SHALL be optional with documented defaults: `cards.stepCounts` (encoder counts per card step, 1-96, default 6) and `cards.clickStillMs` (wheel stillness before a card press, 0-2000 ms, default 250). Colors that no longer have a meaning (`selected`, `sendReady` and `sendBlocked`) SHALL be accepted when present and ignored, so an existing profile keeps loading. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL cancel pending actions and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

#### Scenario: Invalid edit
- **WHEN** the profile is edited to map Send to a small-knob click, or to use a key name the adapter cannot type
- **THEN** the bridge reports the field and keeps the previous profile

#### Scenario: Profile from an earlier release
- **WHEN** the profile has the `selected`, `sendReady` and `sendBlocked` colors and no `cards` section
- **THEN** it validates, the old colors are ignored and card navigation uses the default step and stillness

### Requirement: Read-only Hub feed
The bridge SHALL read `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and follow `GET /api/monitor/v1/changes` on a numeric loopback origin with a bearer token from a private file, refetching a snapshot for every change or resync notification. It SHALL send no other request. Requests SHALL be bounded in time and size, a silent stream SHALL be dropped and reconnected, and failures SHALL mark the feed stale while keeping the last snapshot for display. A Hub without snapshot 1.3 SHALL be read at 1.2, where Claude routing stays disabled, and the bridge SHALL ask for 1.3 again periodically and on every reconnect. The token MUST NOT appear in output.

#### Scenario: Hub unreachable
- **WHEN** snapshot requests fail or the stream goes silent
- **THEN** the feed is stale, every assigned key shows stale and the bridge retries, while Send, which does not read the feed, still acts on the window in front

#### Scenario: Hub upgraded in place
- **WHEN** the Hub starts serving snapshot 1.3 while the bridge reads 1.2
- **THEN** within the retry period, or at the next reconnect, the bridge reads 1.3 and Claude Desktop IDs reach the slots without a restart

#### Scenario: Notification burst
- **WHEN** several change notifications arrive together
- **THEN** at most one snapshot is in flight and one more pending, and no notification is replayed as input

### Requirement: Card answers with the big wheel
While the adapter reports a card in the foreground Codex or Claude window at a qualified version, big-wheel turns SHALL move keyboard focus between the card's actionable buttons, in the order the adapter reports them. One step SHALL take `cards.stepCounts` encoder counts, counted in a single accumulator that restarts at zero on a direction reversal, so a small reversal never steps back. Clockwise steps SHALL move to later buttons and steps SHALL stop at the first and last button. With no card button focused, the first clockwise step SHALL focus the first button and the first counter-clockwise step the last. A big-wheel click SHALL press the focused card button only when the wheel has not turned for `cards.clickStillMs` before the press, no step is in flight, the repeat window has passed and Record is not held. Rotation while the click is held SHALL be discarded, and the press SHALL clear partial rotation and steps not yet sent. The press SHALL go through the adapter, which presses the button only if it still has keyboard focus and the card still has the same number of actionable buttons. An uncertain press MUST NOT be retried. When the card state or the Codex card container is unknown, turns and clicks SHALL do nothing: they neither scroll nor send. Play MUST NOT press a card button. This deliberately relaxes the rule that a PROMPTI action never approves anything, for this one gesture only: a still big-wheel click on a focused card button may approve a permission request. It is a client UI action and never a Hub acknowledgement, and slot keys, Play and Record still approve nothing.

#### Scenario: Step through a card
- **WHEN** a Claude permission card is open with the composer focused and the owner turns the wheel clockwise by one step's counts, then by fewer counts than a step
- **THEN** the first card button gets keyboard focus, and the smaller turn moves nothing

#### Scenario: Small reversal
- **WHEN** the owner steps forward and then turns back by fewer counts than a step
- **THEN** focus stays on the button it reached

#### Scenario: Still click presses the focused button
- **WHEN** the wheel has been still for the stillness time and the owner clicks it while a card button has focus
- **THEN** the adapter presses that button once and no Enter is typed

#### Scenario: Click while turning
- **WHEN** the wheel click arrives within the stillness time after a turn, or while a step is in flight
- **THEN** no button is pressed and nothing is typed

#### Scenario: Play on a card
- **WHEN** Play is pressed while a card is open
- **THEN** no button is pressed and Send is refused as `approval-visible`

#### Scenario: Card closes
- **WHEN** the card closes after a press or with the mouse
- **THEN** within the observation reuse time the wheel scrolls again and its click is Send

#### Scenario: Codex card container unknown
- **WHEN** Codex shows no composer and its card container cannot be established
- **THEN** wheel turns and clicks do nothing: nothing scrolls, nothing is focused or pressed and no Enter is typed

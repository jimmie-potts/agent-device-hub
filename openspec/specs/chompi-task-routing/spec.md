# chompi-task-routing Specification

## Purpose

Define how the CHOMPI bridge maps stable task keys to Codex and Claude Desktop tasks from the Hub feed: slot assignment and release, light states, the fail-closed focus and composer checks, Wispr dictation, explicit Send, wheel scrolling and the versioned JSON profile.

## Requirements

### Requirement: Stable first-free task slots
The bridge SHALL assign root Codex Desktop threads (keyed by thread ID) and root Claude Desktop sessions (keyed by `hostSessionId`) to the lowest free slot across the profile's task pages, keyed by the full provider, client, host, source and task identity. Simultaneous discoveries SHALL be placed in provider, client, host, source and task ID order. Slots SHALL come in pages of 15: page p holds slots 15(p-1)+1 to 15p, up to 8 pages (slots 1-120). Assigned slots MUST NOT move to another slot or page. When every slot on every page is full the bridge SHALL report overflow without moving or evicting a slot. Slots SHALL persist in a private bridge file written atomically (a private temporary file renamed over the target) by the one bridge process, separate from Hub retention, and an invalid file SHALL stop start-up rather than reassign slots. The file SHALL carry `schemaVersion: 2`; a version 1 file (slots 1-15) SHALL load unchanged onto page 1 and be written as version 2 at the next change, and a reader of version 1 refuses version 2, so rolling back needs the documented step of backing up the file and pruning slots above 15. When the profile has fewer pages than an assigned slot needs, the bridge MUST NOT drop or move that task: the slot keeps its task, in memory and in the file, without a visible key, takes no new task, can still be released on explicit evidence, and the bridge SHALL report how many such slots there are. Sessions with a known parent SHALL NOT receive slots.

#### Scenario: First free slot after a release
- **WHEN** slots 1 and 2 hold tasks A and C, slot 1 is released, and tasks B and D appear in one snapshot
- **THEN** B takes slot 1 and D takes slot 3, and C stays in slot 2

#### Scenario: Restart and reconnect
- **WHEN** the bridge restarts, the controller reconnects or the Hub restarts and omits the Desktop ID until the next event
- **THEN** every task keeps its slot and its key still shows that task's state

#### Scenario: Full capacity
- **WHEN** every slot on every page is full (60 with the default 4 pages) and another task appears
- **THEN** it is reported as overflow, no slot changes, and the next freed slot goes to the first overflow task in sort order; a sixteenth task with free pages takes slot 16, the first key of page 2

#### Scenario: Slot file from an earlier release
- **WHEN** the bridge starts with a version 1 slot file holding slots 1-15
- **THEN** those tasks keep their slots on page 1, nothing is written until a slot changes, and the next write is version 2

#### Scenario: Interrupted write
- **WHEN** the bridge stops after writing the temporary file but before the rename, or a write fails
- **THEN** the last good file stays intact and loads at the next start, the stray temporary file is ignored, and a failed write is reported while the in-memory slots stay authoritative

#### Scenario: Fewer pages
- **WHEN** the profile is edited from 3 pages to 2 while slots 31-35 hold tasks
- **THEN** those tasks keep slots 31-35 without visible keys, the bridge reports 5 slots beyond the pages, and they show again on page 3 when the profile returns to 3 or more pages

#### Scenario: Duplicates
- **WHEN** two tasks share a title, one thread ID appears from two sources, or one Claude Desktop ID has two Hub records after `/clear`
- **THEN** distinct identities get distinct slots and one Desktop ID is one slot shown from its newest record

### Requirement: Release only on explicit evidence
The bridge SHALL release a slot only when the adapter reports the Codex thread archived, the Claude Desktop record archived, or the owner's Claude release gesture (slot key held for the configured hold, then Loop) is used. Absence from the feed, Hub retirement or expiry, idle, a stale feed, a missing Desktop record and unknown observations MUST NOT release a slot. A released task SHALL stay out of the slots until it shows lifecycle evidence newer than its release. The gesture on a Codex slot SHALL only light the error state. Release SHALL work the same on every page: the gesture SHALL release the absolute slot the held key showed when it was pressed, even if the visible page changed during the hold, and archive evidence releases a slot on any page, hidden or beyond the profile's pages.

#### Scenario: Hub retires a session after idle
- **WHEN** the Hub drops a slotted session
- **THEN** the slot is kept, its key shows ended and pressing it opens the same task

#### Scenario: Claude release gesture
- **WHEN** the owner holds a Claude slot's key past the hold time and presses Loop
- **THEN** that slot is released and persisted, and the Claude session is not placed again until it shows new activity

#### Scenario: Release on another page
- **WHEN** page 2 is visible and the owner holds key 2 past the hold time and presses Loop, or a task on a hidden page is archived
- **THEN** slot 17, or the archived task's slot, is released and persisted, and no other slot changes

#### Scenario: Paging during the release hold
- **WHEN** the owner holds key 2 on page 1, turns knob 4 to page 2 and presses Loop after the hold time
- **THEN** slot 2 is released, not slot 17

### Requirement: Distinct state lights
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse. Slot keys SHALL show task state only: no key marks a selected or targeted task, so focusing a task never looks like acknowledging it. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused slot press SHALL light that key's error state briefly. The big-wheel LEDs SHALL stay off, because Send and card answers are decided at the press and nothing polls the window in front, except that a refused or uncertain Send or card press SHALL light both in the error color for the profile's error flash time; a Send refused as a `repeat` within the repeat window or abandoned because Record was pressed (`superseded`) SHALL NOT flash. Slot keys SHALL show the visible page's slots, and keys for its empty slots SHALL stay off. Small knob 4's LED SHALL show the visible page in that page's color (`colors.pages`), and while any task on another page, including slots beyond the profile's pages, has attention it SHALL alternate between the page color and the attention color on the attention pulse; it shows no other state. The Attention key SHALL show the attention color, steady, while any task on the profile's pages waits for the owner and the feed is current, and SHALL be off otherwise; a refused Attention key press SHALL light it in the error color for the error flash time. A black key mapped to `back` SHALL have no light. The volume knob's LED SHALL light only in the error color, for the error flash time, when a volume key is ignored during Record or fails. The renderer SHALL provide a state label for every slot.

#### Scenario: Unknown never looks completed
- **WHEN** a session's freshness is uncertain or the feed is stale while a completion notice is unacknowledged
- **THEN** its key shows unknown or stale, not the completion color

#### Scenario: Attention on a hidden page
- **WHEN** page 2 is visible and a task in slot 1 has attention
- **THEN** knob 4's LED alternates between page 2's color and the attention color, the keys keep showing page 2, and nothing is sent to the Hub

#### Scenario: Attention is not acknowledged by a key press
- **WHEN** the owner presses a pulsing key
- **THEN** the task is focused, its key keeps pulsing with the attention color and the bridge sends nothing to the Hub

#### Scenario: Attention key light
- **WHEN** a task on hidden page 2 raises attention, and later every waiting task is answered
- **THEN** the Attention key shows the attention color steadily while the task waits and goes off afterwards, and it is off while the feed is stale

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
Record SHALL hold the profile's dictation chord when it is pressed and release it on the Record release, including a synthetic one, with no foreground, card or composer check, so Wispr dictates into whatever is in front, a card's free-text field included. A Record press SHALL never be refused: it SHALL abandon a Send whose checks are still running, even when Record is released before those checks end, and a press during a Send's Enter keystroke SHALL press the chord right after that keystroke, so the chord's modifiers never join the Enter. If the chord cannot be pressed, the bridge SHALL release every key it holds. Releasing Record MUST NOT send.

#### Scenario: Record then release
- **WHEN** the owner holds Record with any app in front and releases it
- **THEN** the chord goes down and up once and no Enter is typed

#### Scenario: Record while a card is open
- **WHEN** the owner holds Record while a Claude card is open
- **THEN** the chord goes down, because Record makes no card check

#### Scenario: Record during a Send
- **WHEN** the owner presses Record while a Send is still checking the window in front, or while its Enter is being typed
- **THEN** the checking Send is abandoned and the chord goes down at once, or the chord goes down right after the Enter

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
- **THEN** Send is refused as `not-agent-client`, nothing is typed and the big-wheel LEDs flash the error color

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
A bridge `stale`, `session-restart` or `disconnected` event, an overflowed event subscription, Back, a profile swap and shutdown SHALL cancel any focus in progress, pending wheel steps and pending volume keys with the volume knob's partial rotation, end dictation and release every key the adapter holds. No earlier input SHALL be replayed: after recovery, each control acts only on a fresh press, evaluated at that press. SIGINT, SIGTERM, SIGHUP and SIGBREAK SHALL stop the bridge the same way. On any process exit the adapter's synchronous release SHALL run when the adapter offers one, and an uncaught exception or unhandled rejection SHALL release keys, report the error and exit non-zero.

#### Scenario: Disconnect during Record
- **WHEN** the controller disconnects while Record is held, and then reconnects
- **THEN** the chord is released, no draft is sent and nothing is typed by the reconnect, and a Send pressed after the reconnect is a new press evaluated against the window then in front

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings, optional card-navigation settings and qualified versions for both clients, and no URIs, paths, commands or package identities. Fields added after the first release SHALL be optional with documented defaults: `cards.stepCounts` (encoder counts per card step, 1-96, default 6, about a quarter turn at the about 25 counts per revolution measured on the trial device on 2026-10-05) and `cards.clickStillMs` (wheel stillness before a card press, 0-2000 ms, default 250), `pages.count` (task pages of 15 slots, 1-8, default 4), `pages.stepCounts` (knob 4 encoder counts per page, 1-96, defaulting to the card step default) `colors.pages` (knob 4's LED color per page, page 1 first, at least one per page, with eight distinct defaults), `keys` (black-key controls 16-25 mapped to `attention` or `back`; absent, `{"16": "attention"}`, and `{}` maps none), `volume.stepCounts` (volume knob encoder counts per volume key, 1-96, default 1), `volume.invert` (default `false`, clockwise raises the volume) and `timing.attentionRepeatMs` (the Attention key's repeat window, 500-30000 ms, default 4000). A `keys` entry for a control the `controls` section maps (a slot, Record, Send or Back) SHALL be rejected with the owning path, and when `keys` is absent the default SHALL leave out a control the profile already maps. With a `volume` section, `controls.scroll` MUST NOT be 46 and `controls.record` and `controls.back` MUST NOT be 34, the volume knob's turn and click; a profile without a `volume` section that maps either SHALL keep its mapping and the volume knob SHALL send no volume key. `controls.scroll` MUST NOT be 43, small knob 4's turn, which pages tasks. Colors that no longer have a meaning (`selected`, `sendReady` and `sendBlocked`) SHALL be accepted when present and ignored, so an existing profile keeps loading. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL cancel pending actions and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

#### Scenario: Invalid edit
- **WHEN** the profile is edited to map Send to a small-knob click, or to use a key name the adapter cannot type
- **THEN** the bridge reports the field and keeps the previous profile

#### Scenario: Profile from an earlier release
- **WHEN** the profile has the `selected`, `sendReady` and `sendBlocked` colors and no `cards` or `pages` section
- **THEN** it validates, the old colors are ignored, card navigation uses the default step and stillness, and there are 4 task pages with the default page colors

#### Scenario: Black-key map and volume settings
- **WHEN** the profile maps black key 17 to `back` and 25 to `attention`, sets `volume.stepCounts` to 3, or maps a black key that a slot already uses
- **THEN** the first two validate as written and the conflicting map is rejected with the slot's path

#### Scenario: Installed profile without the new sections
- **WHEN** the installed profile from an earlier release, with no `keys`, `volume` or `timing.attentionRepeatMs`, is loaded
- **THEN** it validates unchanged, black key 1 is the Attention key, the volume knob sends one volume key per count and the repeat window is 4 s

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

### Requirement: Big-wheel card answers
While the adapter reports a card in the foreground Codex or Claude window at a qualified version, big-wheel turns SHALL move keyboard focus between the card's stops, as the adapter reports them: for a Claude question card, the answer rows and the "Other" row; for other cards, every actionable button. One step SHALL take `cards.stepCounts` encoder counts, counted in a single accumulator that restarts at zero on a direction reversal, so a small reversal never steps back. Clockwise steps SHALL move to later stops and steps SHALL stop at the first and last stop. With no stop focused, the first clockwise step SHALL focus the first stop and the first counter-clockwise step the last. A big-wheel click SHALL press the focused stop only when the wheel's own step chose that stop on that same card, as the adapter identifies the card; a step SHALL choose a stop only when it moved focus onto it, as the adapter's read-back confirms the requested stop, and a step clamped at the first or last stop, which cannot move focus, SHALL choose nothing, call no adapter and leave any earlier choice from a real move, so a stop the client focused itself, such as a Codex card's approve button, is pressed only after the wheel moves away and back onto it, never by a turn or a click alone; and only when the wheel has not turned for `cards.clickStillMs` before the press, no step is in flight, the repeat window has passed and Record is not held. Otherwise the click SHALL press nothing. Rotation while the click is held SHALL be discarded, and the press SHALL clear partial rotation and steps not yet sent. The press SHALL go through the adapter, which presses the stop only if it still has keyboard focus, in the same card with the same number of stops. An uncertain press MUST NOT be retried. When the card state or the Codex card container is unknown, turns and clicks SHALL do nothing: they neither scroll nor send. Partial rotation SHALL be cleared whenever the wheel acts outside a card, so earlier scroll counts never shorten the first card step. Play MUST NOT press a card button. This deliberately relaxes the rule that a PROMPTI action never approves anything, for this one gesture only: a still big-wheel click on a stop the wheel's step chose may approve a permission request. It is a client UI action and never a Hub acknowledgement, and slot keys, Play and Record still approve nothing.

#### Scenario: Step through a question card's answers
- **WHEN** a Claude question card with three options is open and the owner turns the wheel clockwise step by step
- **THEN** focus moves through the three options and the "Other" row only, and a still click presses the one the wheel reached

#### Scenario: Step through a card
- **WHEN** a Claude permission card is open with the composer focused and the owner turns the wheel clockwise by one step's counts, then by fewer counts than a step
- **THEN** the first card button gets keyboard focus, and the smaller turn moves nothing

#### Scenario: Small reversal
- **WHEN** the owner steps forward and then turns back by fewer counts than a step
- **THEN** focus stays on the button it reached

#### Scenario: Still click presses the focused button
- **WHEN** the wheel has been still for the stillness time and the owner clicks it while the card button the wheel's step chose has focus
- **THEN** the adapter presses that button once and no Enter is typed

#### Scenario: Codex card without focus
- **WHEN** a Codex card opens and Codex gives none of its stops keyboard focus
- **THEN** one clockwise step focuses Deny, the first stop, and a still click presses Deny, while one counter-clockwise step focuses approve, the last stop

#### Scenario: A clamped step chooses nothing
- **WHEN** a Codex card opens with its approve button, the last stop, focused and the owner turns the wheel clockwise by one step's counts and then clicks it while still
- **THEN** the clamped step moves nothing and chooses nothing, and the click presses nothing (`card-nothing-chosen`); after one counter-clockwise step to Deny and one clockwise step back, a still click presses approve once

#### Scenario: Click without a step
- **WHEN** a Codex card opens with its approve button focused, or focus moved to another button or card since the wheel's last step, and the owner clicks the wheel without turning it
- **THEN** no button is pressed, nothing is typed and the big-wheel LEDs flash the error color

#### Scenario: Click while turning
- **WHEN** the wheel click arrives within the stillness time after a turn, or while a step is in flight
- **THEN** no button is pressed and nothing is typed

#### Scenario: Play on a card
- **WHEN** Play is pressed while a card is open
- **THEN** no button is pressed and Send is refused, as `approval-visible` for a Claude card and as `composer-unfocused` for a Codex card, whose focus is on a card button

#### Scenario: Card closes
- **WHEN** the card closes after a press or with the mouse
- **THEN** within the observation reuse time the wheel scrolls again and its click is Send

#### Scenario: Codex card container unknown
- **WHEN** Codex shows no composer and its card container cannot be established, as in a view without exactly one selected sidebar row
- **THEN** wheel turns and clicks do nothing: nothing scrolls, nothing is focused or pressed and no Enter is typed

#### Scenario: Scroll before a card
- **WHEN** the owner scrolls by fewer counts than a step and a card then opens
- **THEN** the first card step still needs a full step of turns made on the card

### Requirement: Task pages with small knob 4
A small knob 4 turn (control 43) SHALL change the visible task page by one page per `pages.stepCounts` encoder counts, counted in one accumulator that restarts at zero on a direction reversal, and SHALL stop at the first and last page. Slot keys 1-15 SHALL act on slot (visible page - 1) x 15 + key for focus, the release gesture and lights. The bridge SHALL start on page 1 and SHALL NOT persist the visible page; a profile reload SHALL clamp it to the new page count. Paging MUST NOT send input, call the OS adapter, type, focus a client, change the foreground or acknowledge anything; it only changes which slots the keys show. Knob 4's click (control 31) SHALL stay unassigned: profile validation SHALL reject mapping it to any control.

#### Scenario: Page with a deliberate turn
- **WHEN** the owner turns knob 4 by fewer counts than a page step, then completes the step, then wiggles back by fewer counts than a step
- **THEN** the light touch and the wiggle change nothing and the completed step shows page 2

#### Scenario: Open a task on page 2
- **WHEN** page 2 is visible and the owner presses key 2
- **THEN** the bridge opens and verifies the task in slot 17

#### Scenario: Paging is not input
- **WHEN** the owner turns knob 4 back and forth or clicks it while a Codex task with attention is in front
- **THEN** no keystroke, link, focus or adapter call happens and the attention stays

### Requirement: Attention key
A black key the profile maps to `attention` (black key 1, control 16, by default) SHALL open the assigned task that has waited longest for the owner, on any of the profile's pages. The bridge SHALL record, in memory only, the order in which it first saw each assigned task's slot state become `attention` on a current feed, numbering tasks first seen in one snapshot in slot order; a task whose attention clears SHALL leave the order and, if it waits again, join at its end; a task that loses its slot SHALL leave the order; a stale feed SHALL leave the order unchanged; and the order SHALL restart with the bridge. A press SHALL switch the visible page to the target's page and open the target through the same target check, link, verification and composer path as its slot key. A press within `timing.attentionRepeatMs` of the previous Attention key press SHALL open the first waiting task after the previous target in that order, or the earliest when none follows; a later press SHALL open the earliest waiting task. With no task waiting on the profile's pages, or a feed that is not current, the press SHALL be refused with its key's error flash and SHALL make no adapter call. The key MUST NOT acknowledge, approve or dismiss anything, MUST NOT send or type beyond the slot key's own composer shortcut, and MUST NOT change Hub state. A black key mapped to `back` SHALL act exactly as `controls.back`.

#### Scenario: Longest-waiting task on another page
- **WHEN** a task in slot 18 on page 2 raises attention, then a task in slot 3 on page 1, and the owner presses the Attention key with page 1 visible
- **THEN** page 2 becomes visible and the slot 18 task opens and verifies, and both tasks keep their attention

#### Scenario: Repeat press moves on
- **WHEN** the owner presses the Attention key again within the repeat window
- **THEN** the slot 3 task opens and page 1 becomes visible; after the last waiting task a repeat press opens the earliest again, and a press after the window opens the earliest

#### Scenario: Nothing waiting
- **WHEN** no task on the profile's pages has attention, or the feed is stale, and the owner presses the Attention key
- **THEN** its key flashes the error color, nothing opens and no adapter call is made

#### Scenario: Order in bridge memory
- **WHEN** a task's attention clears and returns while another task keeps waiting, or the bridge restarts with two tasks already waiting
- **THEN** the returning task comes after the other, and after the restart the two are ordered by slot

### Requirement: Volume knob
When the profile's volume knob is active, a volume knob turn (control 46) SHALL send one system volume-up key per `volume.stepCounts` encoder counts clockwise and one volume-down key per step counter-clockwise, reversed when `volume.invert` is true, counted in one accumulator that restarts at zero on a direction reversal, and a volume knob click (control 34) SHALL send one mute key. Volume keys SHALL go through the OS adapter's system volume operation without any foreground, composer or card check, MUST NOT be sent to a client window and MUST NOT type, send, focus or acknowledge anything. Turns that arrive while a volume key is being sent SHALL coalesce into calls of at most 10 presses. A failed volume key SHALL NOT be retried, SHALL drop pending volume work and SHALL flash the volume knob's LED. While Record is held or the dictation chord is down, the volume knob's turns and clicks SHALL be ignored with a reason code and a flash of its LED, so a volume key never combines with the chord; a Record press during a volume keystroke SHALL press the chord only after that keystroke ends.

#### Scenario: Detents and mute
- **WHEN** the owner turns the volume knob three counts clockwise and one counter-clockwise with Codex in front, then clicks it twice
- **THEN** the system receives three volume-up keys, one volume-down key and two mute keys, and Codex receives no keystroke

#### Scenario: Volume during Record
- **WHEN** the owner turns or clicks the volume knob while holding Record
- **THEN** no volume key is sent, the chord stays exactly the dictation chord, the volume knob's LED flashes, and after Record is released the knob works again

#### Scenario: Record during a volume keystroke
- **WHEN** Record is pressed while a volume key is still being sent
- **THEN** the dictation chord goes down only after that volume keystroke ends

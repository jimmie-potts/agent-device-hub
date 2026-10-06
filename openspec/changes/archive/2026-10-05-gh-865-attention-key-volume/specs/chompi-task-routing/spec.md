## MODIFIED Requirements

### Requirement: Distinct state lights
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse. Slot keys SHALL show task state only: no key marks a selected or targeted task, so focusing a task never looks like acknowledging it. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused slot press SHALL light that key's error state briefly. The big-wheel LEDs SHALL stay off, because Send and card answers are decided at the press and nothing polls the window in front, except that a refused or uncertain Send or card press SHALL light both in the error color for the profile's error flash time; a Send refused as a `repeat` within the repeat window or abandoned because Record was pressed (`superseded`) SHALL NOT flash. Slot keys SHALL show the visible page's slots, and keys for its empty slots SHALL stay off. Small knob 4's LED SHALL show the visible page in that page's color (`colors.pages`), and while any task on another page, including slots beyond the profile's pages, has attention it SHALL alternate between the page color and the attention color on the attention pulse; it shows no other state, except that a refused Attention click SHALL light it in the error color for the error flash time, after which it shows the page again. The Attention click on knob 4 SHALL have no light of its own. A black key mapped to `attention` SHALL show the attention color, steady, while any task on the profile's pages waits for the owner and the feed is current, and SHALL be off otherwise; a refused press of that key SHALL light it in the error color for the error flash time. Black keys without a mapping and a black key mapped to `back` SHALL have no light. The volume knob's LED SHALL light only in the error color, for the error flash time, when a volume key is ignored during Record or fails. The renderer SHALL provide a state label for every slot.

#### Scenario: Unknown never looks completed
- **WHEN** a session's freshness is uncertain or the feed is stale while a completion notice is unacknowledged
- **THEN** its key shows unknown or stale, not the completion color

#### Scenario: Attention on a hidden page
- **WHEN** page 2 is visible and a task in slot 1 has attention
- **THEN** knob 4's LED alternates between page 2's color and the attention color, the keys keep showing page 2, and nothing is sent to the Hub

#### Scenario: Attention is not acknowledged by a key press
- **WHEN** the owner presses a pulsing key
- **THEN** the task is focused, its key keeps pulsing with the attention color and the bridge sends nothing to the Hub

#### Scenario: Attention click light
- **WHEN** the owner clicks knob 4 with no task waiting, and later a task on hidden page 2 raises attention
- **THEN** knob 4's LED flashes the error color and then shows the page color again, then alternates with the attention color for the hidden page, and no black key lights

### Requirement: Release on loss
A bridge `stale`, `session-restart` or `disconnected` event, an overflowed event subscription, Back, a profile swap and shutdown SHALL cancel any focus in progress, pending wheel steps and pending volume keys with the volume knob's partial rotation, end dictation and release every key the adapter holds. No earlier input SHALL be replayed: after recovery, each control acts only on a fresh press, evaluated at that press. SIGINT, SIGTERM, SIGHUP and SIGBREAK SHALL stop the bridge the same way. On any process exit the adapter's synchronous release SHALL run when the adapter offers one, and an uncaught exception or unhandled rejection SHALL release keys, report the error and exit non-zero.

#### Scenario: Disconnect during Record
- **WHEN** the controller disconnects while Record is held, and then reconnects
- **THEN** the chord is released, no draft is sent and nothing is typed by the reconnect, and a Send pressed after the reconnect is a new press evaluated against the window then in front

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings, optional card-navigation settings and qualified versions for both clients, and no URIs, paths, commands or package identities. Fields added after the first release SHALL be optional with documented defaults: `cards.stepCounts` (encoder counts per card step, 1-96, default 6, about a quarter turn at the about 25 counts per revolution measured on the trial device on 2026-10-05) and `cards.clickStillMs` (wheel stillness before a card press, 0-2000 ms, default 250), `pages.count` (task pages of 15 slots, 1-8, default 4), `pages.stepCounts` (knob 4 encoder counts per page, 1-96, defaulting to the card step default), `pages.attentionClick` (whether knob 4's click is the Attention click, default `true`), `colors.pages` (knob 4's LED color per page, page 1 first, at least one per page, with eight distinct defaults), `keys` (black-key controls 16-25 mapped to `attention` or `back`; absent, none), `volume.stepCounts` (volume knob encoder counts per volume key, 1-96, default 1), `volume.invert` (default `false`, clockwise raises the volume) and `timing.attentionRepeatMs` (the Attention key's repeat window, 500-30000 ms, default 4000). A `keys` entry for a control the `controls` section maps (a slot, Record, Send or Back) SHALL be rejected with the owning path. With a `volume` section, `controls.scroll` MUST NOT be 46 and `controls.record` and `controls.back` MUST NOT be 34, the volume knob's turn and click; a profile without a `volume` section that maps either SHALL keep its mapping and the volume knob SHALL send no volume key. `controls.scroll` MUST NOT be 43, small knob 4's turn, which pages tasks. Colors that no longer have a meaning (`selected`, `sendReady` and `sendBlocked`) SHALL be accepted when present and ignored, so an existing profile keeps loading. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL cancel pending actions and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

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
- **WHEN** the installed profile from an earlier release, with no `keys`, `volume`, `pages.attentionClick` or `timing.attentionRepeatMs`, is loaded
- **THEN** it validates unchanged, knob 4's click is the Attention click, no black key has an action, the volume knob sends one volume key per count and the repeat window is 4 s

### Requirement: Task pages with small knob 4
A small knob 4 turn (control 43) SHALL change the visible task page by one page per `pages.stepCounts` encoder counts, counted in one accumulator that restarts at zero on a direction reversal, and SHALL stop at the first and last page. Slot keys 1-15 SHALL act on slot (visible page - 1) x 15 + key for focus, the release gesture and lights. The bridge SHALL start on page 1 and SHALL NOT persist the visible page; a profile reload SHALL clamp it to the new page count. Paging MUST NOT send input, call the OS adapter, type, focus a client, change the foreground or acknowledge anything; it only changes which slots the keys show. Knob 4's click (control 31) SHALL carry only the Attention click, on unless `pages.attentionClick` is `false`, which leaves it inert: profile validation SHALL reject mapping it to any control.

#### Scenario: Page with a deliberate turn
- **WHEN** the owner turns knob 4 by fewer counts than a page step, then completes the step, then wiggles back by fewer counts than a step
- **THEN** the light touch and the wiggle change nothing and the completed step shows page 2

#### Scenario: Open a task on page 2
- **WHEN** page 2 is visible and the owner presses key 2
- **THEN** the bridge opens and verifies the task in slot 17

#### Scenario: Paging is not input
- **WHEN** the owner turns knob 4 back and forth while a Codex task with attention is in front
- **THEN** no keystroke, link, focus or adapter call happens and the attention stays

#### Scenario: Knob 4's click turned off
- **WHEN** the profile sets `pages.attentionClick` to `false` and the owner clicks knob 4 while a task waits
- **THEN** nothing opens and no adapter call happens

## ADDED Requirements

### Requirement: Attention click on knob 4
Small knob 4's click (control 31), unless `pages.attentionClick` is `false`, and any black key the profile maps to `attention` SHALL open the assigned task that has waited longest for the owner, on any of the profile's pages (owner decision on #865, 2026-10-06). The bridge SHALL record, in memory only, the order in which it first saw each assigned task's slot state become `attention` on a current feed, numbering tasks first seen in one snapshot in slot order; a task whose attention clears SHALL leave the order and, if it waits again, join at its end; a task that loses its slot SHALL leave the order; a stale feed SHALL leave the order unchanged; and the order SHALL restart with the bridge. A press SHALL switch the visible page to the target's page and open the target through the same target check, link, verification and composer path as its slot key. A press within `timing.attentionRepeatMs` of the previous Attention press SHALL open the first waiting task after the previous target in that order, or the earliest when none follows; a later press SHALL open the earliest waiting task. With no task waiting on the profile's pages, or a feed that is not current, the press SHALL be refused with an error flash on knob 4's LED, or on the pressed black key, and SHALL make no adapter call. The Attention action MUST NOT acknowledge, approve or dismiss anything, MUST NOT send or type beyond the slot key's own composer shortcut, and MUST NOT change Hub state. A black key mapped to `back` SHALL act exactly as `controls.back`.

#### Scenario: Longest-waiting task on another page
- **WHEN** a task in slot 18 on page 2 raises attention, then a task in slot 3 on page 1, and the owner clicks knob 4 with page 1 visible
- **THEN** page 2 becomes visible and the slot 18 task opens and verifies, and both tasks keep their attention

#### Scenario: Repeat click moves on
- **WHEN** the owner clicks knob 4 again within the repeat window
- **THEN** the slot 3 task opens and page 1 becomes visible; after the last waiting task a repeat click opens the earliest again, and a click after the window opens the earliest

#### Scenario: Nothing waiting
- **WHEN** no task on the profile's pages has attention, or the feed is stale, and the owner clicks knob 4
- **THEN** knob 4's LED flashes the error color and then shows the page again, nothing opens and no adapter call is made

#### Scenario: Order in bridge memory
- **WHEN** a task's attention clears and returns while another task keeps waiting, or the bridge restarts with two tasks already waiting
- **THEN** the returning task comes after the other, and after the restart the two are ordered by slot

### Requirement: Volume knob
When the profile's volume knob is active, a volume knob turn (control 46) SHALL send one system volume-up key per `volume.stepCounts` encoder counts clockwise and one volume-down key per step counter-clockwise, reversed when `volume.invert` is true, counted in one accumulator that restarts at zero on a direction reversal, and a volume knob click (control 34) SHALL send one mute key. Volume keys SHALL go through the OS adapter's system volume operation, which targets no window and checks no foreground, composer or card; they MUST NOT type text into, send to, focus or acknowledge anything in a client. Windows delivers a volume virtual key through the foreground thread's input stream and handles it as a system app command, so the installed check confirms that Codex and Claude do not react to it. Turns that arrive while a volume key is being sent SHALL coalesce into calls of at most 10 presses, and clicks that arrive then SHALL collapse to their parity, so the mute state after the calls matches the number of clicks. A failed volume key SHALL NOT be retried, SHALL drop pending volume work and SHALL flash the volume knob's LED. While Record is held or the dictation chord is down, the volume knob's turns and clicks SHALL be ignored with a reason code and a flash of its LED, so a volume key never combines with the chord; a Record press during a volume keystroke SHALL press the chord only after that keystroke ends.

#### Scenario: Detents and mute
- **WHEN** the owner turns the volume knob three counts clockwise and one counter-clockwise with Codex in front, then clicks it twice
- **THEN** the system receives three volume-up keys, one volume-down key and two mute keys through the system volume operation, and no shortcut, text or Enter is typed into Codex

#### Scenario: Volume during Record
- **WHEN** the owner turns or clicks the volume knob while holding Record
- **THEN** no volume key is sent, the chord stays exactly the dictation chord, the volume knob's LED flashes, and after Record is released the knob works again

#### Scenario: Many clicks during a slow volume key
- **WHEN** the owner clicks the volume knob once and then five more times while that mute key is still being sent, or once and then six more times
- **THEN** one more mute key follows the five clicks and none follows the six, so the mute state matches the number of clicks

#### Scenario: Record during a volume keystroke
- **WHEN** Record is pressed while a volume key is still being sent
- **THEN** the dictation chord goes down only after that volume keystroke ends

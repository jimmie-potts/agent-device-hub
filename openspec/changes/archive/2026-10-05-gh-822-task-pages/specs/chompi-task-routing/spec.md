## MODIFIED Requirements

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
The bridge SHALL release a slot only when the adapter reports the Codex thread archived, the Claude Desktop record archived, or the owner's Claude release gesture (slot key held for the configured hold, then Loop) is used. Absence from the feed, Hub retirement or expiry, idle, a stale feed, a missing Desktop record and unknown observations MUST NOT release a slot. A released task SHALL stay out of the slots until it shows lifecycle evidence newer than its release. The gesture on a Codex slot SHALL only light the error state. Release SHALL work the same on every page: the gesture acts on the slot the held key shows on the visible page, and archive evidence releases a slot on any page, hidden or beyond the profile's pages.

#### Scenario: Hub retires a session after idle
- **WHEN** the Hub drops a slotted session
- **THEN** the slot is kept, its key shows ended and pressing it opens the same task

#### Scenario: Claude release gesture
- **WHEN** the owner holds a Claude slot's key past the hold time and presses Loop
- **THEN** that slot is released and persisted, and the Claude session is not placed again until it shows new activity

#### Scenario: Release on another page
- **WHEN** page 2 is visible and the owner holds key 2 past the hold time and presses Loop, or a task on a hidden page is archived
- **THEN** slot 17, or the archived task's slot, is released and persisted, and no other slot changes

### Requirement: Distinct state lights
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse. Slot keys SHALL show task state only: no key marks a selected or targeted task, so focusing a task never looks like acknowledging it. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused slot press SHALL light that key's error state briefly. The big-wheel LEDs SHALL stay off, because Send and card answers are decided at the press and nothing polls the window in front, except that a refused or uncertain Send or card press SHALL light both in the error color for the profile's error flash time; a Send refused as a `repeat` within the repeat window or abandoned because Record was pressed (`superseded`) SHALL NOT flash. Slot keys SHALL show the visible page's slots, and keys for its empty slots SHALL stay off. Small knob 4's LED SHALL show the visible page in that page's color (`colors.pages`), and while any task on another page, including slots beyond the profile's pages, has attention it SHALL alternate between the page color and the attention color on the attention pulse; it shows no other state. The renderer SHALL provide a state label for every slot.

#### Scenario: Unknown never looks completed
- **WHEN** a session's freshness is uncertain or the feed is stale while a completion notice is unacknowledged
- **THEN** its key shows unknown or stale, not the completion color

#### Scenario: Attention on a hidden page
- **WHEN** page 2 is visible and a task in slot 1 has attention
- **THEN** knob 4's LED alternates between page 2's color and the attention color, the keys keep showing page 2, and nothing is sent to the Hub

#### Scenario: Attention is not acknowledged by a key press
- **WHEN** the owner presses a pulsing key
- **THEN** the task is focused, its key keeps pulsing with the attention color and the bridge sends nothing to the Hub

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings, optional card-navigation settings and qualified versions for both clients, and no URIs, paths, commands or package identities. Fields added after the first release SHALL be optional with documented defaults: `cards.stepCounts` (encoder counts per card step, 1-96, default 6, about a quarter turn at the about 25 counts per revolution measured on the trial device on 2026-10-05) and `cards.clickStillMs` (wheel stillness before a card press, 0-2000 ms, default 250), `pages.count` (task pages of 15 slots, 1-8, default 4), `pages.stepCounts` (knob 4 encoder counts per page, 1-96, defaulting to the card step default) and `colors.pages` (knob 4's LED color per page, page 1 first, at least one per page, with eight distinct defaults). `controls.scroll` MUST NOT be 43, small knob 4's turn, which pages tasks. Colors that no longer have a meaning (`selected`, `sendReady` and `sendBlocked`) SHALL be accepted when present and ignored, so an existing profile keeps loading. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL cancel pending actions and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

#### Scenario: Invalid edit
- **WHEN** the profile is edited to map Send to a small-knob click, or to use a key name the adapter cannot type
- **THEN** the bridge reports the field and keeps the previous profile

#### Scenario: Profile from an earlier release
- **WHEN** the profile has the `selected`, `sendReady` and `sendBlocked` colors and no `cards` or `pages` section
- **THEN** it validates, the old colors are ignored, card navigation uses the default step and stillness, and there are 4 task pages with the default page colors

## ADDED Requirements

### Requirement: Task pages with small knob 4
A small knob 4 turn (control 43) SHALL change the visible task page by one page per `pages.stepCounts` encoder counts, counted in one accumulator that restarts at zero on a direction reversal, and SHALL stop at the first and last page. Slot keys 1-15 SHALL act on slot (visible page - 1) x 15 + key for focus, the release gesture and lights. The bridge SHALL start on page 1 and SHALL NOT persist the visible page; a profile reload SHALL clamp it to the new page count. Paging MUST NOT send input, call the OS adapter, type, focus a client, change the foreground or acknowledge anything; it only changes which slots the keys show. Knob 4's click (control 31) SHALL stay unassigned.

#### Scenario: Page with a deliberate turn
- **WHEN** the owner turns knob 4 by fewer counts than a page step, then completes the step, then wiggles back by fewer counts than a step
- **THEN** the light touch and the wiggle change nothing and the completed step shows page 2

#### Scenario: Open a task on page 2
- **WHEN** page 2 is visible and the owner presses key 2
- **THEN** the bridge opens and verifies the task in slot 17

#### Scenario: Paging is not input
- **WHEN** the owner turns knob 4 back and forth or clicks it while a Codex task with attention is in front
- **THEN** no keystroke, link, focus or adapter call happens and the attention stays

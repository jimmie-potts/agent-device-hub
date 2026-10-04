## ADDED Requirements

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
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse, including on the selected key, where it SHALL alternate between the attention and selected colors so that focus never looks like acknowledgment. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused action SHALL light that key's error state briefly. The renderer SHALL provide a state label for every slot.

#### Scenario: Unknown never looks completed
- **WHEN** a session's freshness is uncertain or the feed is stale while a completion notice is unacknowledged
- **THEN** its key shows unknown or stale, not the completion color

#### Scenario: Attention is not acknowledged by a key press
- **WHEN** the owner presses a pulsing key
- **THEN** the task is focused, its selected key keeps pulsing with the attention color and the bridge sends nothing to the Hub

### Requirement: Fail-closed exact-task focus
A slot key press SHALL invalidate any earlier target and run, in order: the target check (slot assigned, client version qualified, Codex thread not archived, Claude Desktop record present and not archived), the fixed deep link for that task, verification of the foreground package family and the selected task, and composer focus. Codex selection SHALL require the selected row to match the slot's last-known title with exactly one row of that title. Claude selection SHALL require only the target's `lastFocusedAt` to advance past the press, checked against every known Claude Desktop ID read in bounded calls, never a truncated subset. Verification SHALL poll observations within a bounded time and SHALL NOT repeat the link or any keystroke. An unqualified or unknown client version SHALL disable that client's routing and leave the other client unaffected, because UI selectors (and Claude's undocumented link) depend on the version, and the log SHALL name the observed version. At start-up the bridge SHALL warm the adapter, when it offers a warm-up, before the controller connects. Any failure or unknown SHALL light the error state, log the step and reason without titles, and leave no target. A task key press MUST NOT acknowledge, approve or dismiss anything.

#### Scenario: Foreground alone is insufficient
- **WHEN** Codex comes to the front but keeps another task selected
- **THEN** verification fails, nothing is typed and no target remains

#### Scenario: Duplicate Codex titles
- **WHEN** two open Codex tasks share the slot's title
- **THEN** Codex verification fails closed, while Claude tasks still verify by Desktop ID

#### Scenario: Many Claude sessions
- **WHEN** more than 63 Claude Desktop sessions are known and one of them besides the target also became visible
- **THEN** verification reads all of them and fails as ambiguous

#### Scenario: Unqualified client
- **WHEN** the installed Claude Desktop or Codex version is not listed
- **THEN** that client's slots open nothing and the other client's routing is unaffected

### Requirement: Dictation after a verified target
Record SHALL hold the profile's dictation chord only after a verified target passes a re-check of foreground, selection and composer focus, and SHALL release it on the Record release, including a synthetic one. Record released before the checks finish SHALL press nothing. Releasing Record MUST NOT send.

#### Scenario: Record then release
- **WHEN** the owner holds Record on a verified Codex target and releases it
- **THEN** the chord goes down and up once, no Enter is typed and the target remains for Send

### Requirement: Explicit single Send
Send SHALL type exactly one Enter to a verified target after re-checking foreground, selection and composer focus, and only while the feed is current, the Hub shows no `approval` attention for the task and the adapter reports approval visibility as known `false`. Hub `approval` attention, a stale or unavailable feed, and approval visibility that is `true` or unknown SHALL each refuse Send; `question` and `input` attention SHALL NOT block it. Send SHALL be refused while Record is held, while another Send runs and within the repeat window after a Send. An uncertain keystroke MUST NOT be retried and SHALL clear the target. Small-knob clicks, the volume click, encoder turns, slot keys, Record and Back MUST NOT send, and the profile MUST NOT be able to map them to Send.

#### Scenario: Repeated wheel click
- **WHEN** the big-wheel click arrives twice within the repeat window
- **THEN** one Enter is typed

#### Scenario: Pending approval
- **WHEN** the Hub shows an approval for the target or the adapter reports an approval card
- **THEN** Send is refused

#### Scenario: Approval visibility not qualified
- **WHEN** the adapter answers approval visibility as unknown, as the Windows adapter does until an approval selector is qualified
- **THEN** Send is refused and no Enter is typed

#### Scenario: Task switch before Send
- **WHEN** another slot key is pressed after Record and before Send
- **THEN** the earlier target is cleared and Send is refused until the new task verifies

### Requirement: Big-wheel scrolling
A big-wheel turn SHALL scroll the client conversation through the adapter's mouse-wheel primitive by the profile's notches per detent, in the profile's direction. It SHALL target the verified target's client, or without a target the foreground app when its package family is Codex or Claude, and SHALL do nothing for any other app. Scrolling MUST NOT type, send, select a task or change the target, MUST NOT run while Record is held, and a `false` or unknown result MUST NOT be retried. The big-wheel click remains the explicit Send.

#### Scenario: The wheel scrolls and its click sends
- **WHEN** the owner turns the big wheel on a verified Codex target and then clicks it
- **THEN** the conversation scrolls without any keystroke or target change, and the click types one Enter

#### Scenario: Scroll without a selected task
- **WHEN** no target exists and Claude is the foreground app
- **THEN** the turn scrolls Claude, and with any other app in front it does nothing

#### Scenario: Scroll during dictation or with an unknown result
- **WHEN** Record is held, or the adapter answers unknown
- **THEN** nothing scrolls or is retried and the target and lights are unchanged

### Requirement: Release on loss
A bridge `stale`, `session-restart` or `disconnected` event, an overflowed event subscription, Back, a profile swap and shutdown SHALL clear the target, end dictation and release every key the adapter holds. After recovery a fresh slot press SHALL be required. No earlier input SHALL be replayed. SIGINT, SIGTERM, SIGHUP and SIGBREAK SHALL stop the bridge the same way. On any process exit the adapter's synchronous release SHALL run when the adapter offers one, and an uncaught exception or unhandled rejection SHALL release keys, report the error and exit non-zero.

#### Scenario: Disconnect during Record
- **WHEN** the controller disconnects while Record is held
- **THEN** the chord is released, no draft is sent and Send stays refused after reconnect until a slot is pressed again

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings and qualified versions for both clients, and no URIs, paths, commands or package identities. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL clear the target and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

#### Scenario: Invalid edit
- **WHEN** the profile is edited to map Send to a small-knob click, or to use a key name the adapter cannot type
- **THEN** the bridge reports the field and keeps the previous profile

### Requirement: Read-only Hub feed
The bridge SHALL read `GET /api/monitor/v1/sessions?snapshotVersion=1.3` and follow `GET /api/monitor/v1/changes` on a numeric loopback origin with a bearer token from a private file, refetching a snapshot for every change or resync notification. It SHALL send no other request. Requests SHALL be bounded in time and size, a silent stream SHALL be dropped and reconnected, and failures SHALL mark the feed stale while keeping the last snapshot for display. A Hub without snapshot 1.3 SHALL be read at 1.2, where Claude routing stays disabled, and the bridge SHALL ask for 1.3 again periodically and on every reconnect. The token MUST NOT appear in output.

#### Scenario: Hub unreachable
- **WHEN** snapshot requests fail or the stream goes silent
- **THEN** the feed is stale, every assigned key shows stale, Send is refused and the bridge retries

#### Scenario: Hub upgraded in place
- **WHEN** the Hub starts serving snapshot 1.3 while the bridge reads 1.2
- **THEN** within the retry period, or at the next reconnect, the bridge reads 1.3 and Claude Desktop IDs reach the slots without a restart

#### Scenario: Notification burst
- **WHEN** several change notifications arrive together
- **THEN** at most one snapshot is in flight and one more pending, and no notification is replayed as input

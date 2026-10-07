## MODIFIED Requirements

### Requirement: Distinct state lights
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse. Slot keys SHALL show task state only: no key marks a selected or targeted task, so focusing a task never looks like acknowledging it. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused slot press SHALL light that key's error state briefly. The big-wheel LEDs SHALL stay off, because Send and card answers are decided at the press and nothing polls the window in front, except that a refused or uncertain Send or card press SHALL light both in the error color for the profile's error flash time; a Send refused as a `repeat` within the repeat window or abandoned because Record was pressed (`superseded`) SHALL NOT flash. Slot keys SHALL show the visible page's slots, and keys for its empty slots SHALL stay off. Small knob 4's LED SHALL show the visible page in that page's color (`colors.pages`), and while any task on another page, including slots beyond the profile's pages, has attention it SHALL alternate between the page color and the attention color on the attention pulse; it shows no other state, except that a refused Attention click SHALL light it in the error color for the error flash time, after which it shows the page again. The Attention click on knob 4 SHALL have no light of its own. A black key mapped to `attention` SHALL show the attention color, steady, while any task on the profile's pages waits for the owner and the feed is current, and SHALL be off otherwise; a refused press of that key SHALL light it in the error color for the error flash time. Black keys without a mapping and a black key mapped to `back` SHALL have no light. The volume knob's LED SHALL light only in the error color, for the error flash time, when a volume key is ignored during Record or fails. Knob 1's LED (26) and knob 2's LED (27) SHALL show the `active` color while that knob's model menu, effort slider or picker is open, and for the error flash time after a change SHALL show the `applied` color (`colors.applied`) for a change the client confirmed, the `unknown` color for one it could not confirm, and the error color for a refusal, a mismatch, an unsupported setting or the end of the range; otherwise they SHALL be off. Knob 3 SHALL have no light. The renderer SHALL provide a state label for every slot.

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

#### Scenario: Knob lights
- **WHEN** knob 2 opens Claude's Effort slider and a step is confirmed, and later knob 1 is turned with a card open
- **THEN** knob 2's LED shows the active color, then the applied color for the error flash time, and knob 1's LED flashes the error color

### Requirement: Release on loss
A bridge `stale`, `session-restart` or `disconnected` event, an overflowed event subscription, Back, a profile swap and shutdown SHALL cancel any focus in progress, pending wheel steps, pending volume keys with the volume knob's partial rotation and pending model and effort knob steps with their partial rotation, end dictation and release every key the adapter holds. A bridge `stale`, `session-restart` or `disconnected` event SHALL also drop input waiting for a knob flow to close, and an open model menu, effort slider or picker SHALL then be closed the way its knob closes it. No earlier input SHALL be replayed: after recovery, each control acts only on a fresh press, evaluated at that press. SIGINT, SIGTERM, SIGHUP and SIGBREAK SHALL stop the bridge the same way. On any process exit the adapter's synchronous release SHALL run when the adapter offers one, and an uncaught exception or unhandled rejection SHALL release keys, report the error and exit non-zero.

#### Scenario: Disconnect during Record
- **WHEN** the controller disconnects while Record is held, and then reconnects
- **THEN** the chord is released, no draft is sent and nothing is typed by the reconnect, and a Send pressed after the reconnect is a new press evaluated against the window then in front

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings, optional card-navigation settings and qualified versions for both clients, and no URIs, paths, commands or package identities. Fields added after the first release SHALL be optional with documented defaults: `cards.stepCounts` (encoder counts per card step, 1-96, default 6, about a quarter turn at the about 25 counts per revolution measured on the trial device on 2026-10-05) and `cards.clickStillMs` (wheel stillness before a card press, 0-2000 ms, default 250), `pages.count` (task pages of 15 slots, 1-8, default 4), `pages.stepCounts` (knob 4 encoder counts per page, 1-96, defaulting to the card step default), `pages.attentionClick` (whether knob 4's click is the Attention click, default `true`), `colors.pages` (knob 4's LED color per page, page 1 first, at least one per page, with eight distinct defaults), `keys` (black-key controls 16-25 mapped to `attention` or `back`; absent, none), `volume.stepCounts` (volume knob encoder counts per volume key, 1-96, default 1), `volume.invert` (default `false`, clockwise raises the volume), `timing.attentionRepeatMs` (the Attention key's repeat window, 500-30000 ms, default 4000), `model.stepCounts` (knob 1 encoder counts per menu step, 1-96, default 6, the card step default, because knobs 1-3 are unmeasured), `model.invert` (default `false`, clockwise moves down the menu), `model.clickStillMs` (knob 1 stillness before its click picks a model, 0-2000 ms, default 250), `effort.stepCounts` (knob 2 encoder counts per effort level, 1-96, default 6), `effort.invert` (default `false`, clockwise raises the effort), `shortcuts.codexEffortIncrease` and `shortcuts.codexEffortDecrease` (the owner's Codex effort chords, both or neither; absent, Codex effort uses its picker's Power entry), `timing.menuTimeoutMs` (how long a knob's open menu, slider or picker stays open after its last turn, 1000-30000 ms, default 5000) and `colors.applied` (the knobs' confirmed-change flash, default `[0, 255, 120]`). A Codex effort chord MUST hold `LeftControl`, `LeftAlt` or `LeftWindows` with exactly one other key and MUST NOT include `Enter`, and the two chords MUST differ. Key names SHALL include `Equal` and `Minus`, the `=` and `-` keys; the keys only the adapter's `tapInClient` types (`Left`, `Right` and `Escape`) SHALL NOT be profile key names. A `keys` entry for a control the `controls` section maps (a slot, Record, Send or Back) SHALL be rejected with the owning path. With a `volume` section, `controls.scroll` MUST NOT be 46 and `controls.record` and `controls.back` MUST NOT be 34, the volume knob's turn and click; a profile without a `volume` section that maps either SHALL keep its mapping and the volume knob SHALL send no volume key. With a `model` section, `controls.scroll` MUST NOT be 44 and `controls.record` and `controls.back` MUST NOT be 32, knob 1's turn and click; with an `effort` section the same holds for 41 and 29, knob 2's turn and click; a profile without the section that maps either SHALL keep its mapping and that knob SHALL be off. `controls.scroll` MUST NOT be 43, small knob 4's turn, which pages tasks. Colors that no longer have a meaning (`selected`, `sendReady` and `sendBlocked`) SHALL be accepted when present and ignored, so an existing profile keeps loading. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL cancel pending actions and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

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

#### Scenario: Installed profile and the knobs
- **WHEN** the installed profile from an earlier release, with no `model`, `effort`, Codex effort chords, `timing.menuTimeoutMs` or `colors.applied`, is loaded
- **THEN** it validates unchanged with `schemaVersion` 1, knob 1 sets the model and knob 2 the effort with 6 counts per step, open controls close after 5 s and Codex effort uses its picker's Power entry

#### Scenario: Codex effort chords
- **WHEN** the profile names `codexEffortIncrease` as `LeftControl`, `LeftAlt`, `Equal` and `codexEffortDecrease` as `LeftControl`, `LeftAlt`, `Minus`, or names only one of them, or a chord without Control, Alt or Windows, or with `Enter` or `Down`
- **THEN** the first validates as written and each other is rejected with its path

## ADDED Requirements

### Requirement: Model and effort knobs
Small knob 1 (`ENC_4`: turn 44, click 32) SHALL set the model and small knob 2 (`ENC_1`: turn 41, click 29) the reasoning effort of the Codex or Claude task in front, through that client's own controls, one step per `model.stepCounts` or `effort.stepCounts` encoder counts with the reversal rule of the other knobs, and with the adapter's UI Automation actions wherever the client allows it. Before acting the router SHALL require a qualified Codex or Claude window in front, a known card state with no card, the client's controls readable with none of them open, no Record chord, and no Send or task focus in progress; otherwise the knob SHALL refuse with a reason code and an error flash and do nothing. A read that gates an action SHALL wait up to 400 ms for its condition, because UI Automation can lag a change, and no stale read SHALL make the bridge act twice. The knobs SHALL never press Enter, type into a composer, send a prompt or answer a card. Their only keys SHALL be Codex's one closing Escape, the owner's Codex effort chords and, without chords, Right and Left on a focused Power entry, all through `tapInClient` into Codex.

- **Claude model:** the first detent SHALL expand the `Model: <name>` button and move keyboard focus to the current model option; each further detent SHALL move focus one model option (`SetFocus`, read back), stopping at the first and last, never on "More models". A knob 1 click after `model.clickStillMs` without a turn SHALL call `Select` on the option the knob confirmed focused, which applies it and closes the menu. The outcome SHALL be `applied` when the `Model: <name>` button names the pick and, when the router can tell the session in front (strictly the newest `lastFocusedAt` among the sessions it knows), that session record's `model` changed when the pick changed the model, within `timing.verifyTimeoutMs`; `mismatch` when the button names another model or the record did not change; and `unverified` when the controls or the record cannot be read. The composer SHALL then get keyboard focus.
- **Claude effort:** a detent SHALL expand the `Effort: <level>` button when the slider is not open and set the slider one `SmallChange` from the value it reads, within its range; at an end it SHALL set nothing, log `at-limit` once and drop the detents still waiting. The outcome SHALL be `applied` when the `Effort:` button changed and, when the session in front is known, its record's `effort` changed; `mismatch` when nothing changed; `unverified` when unreadable. A model without an Effort button SHALL be `unsupported`.
- **Codex model:** the first detent SHALL expand the picker button, invoke its "Select model" entry and focus the current model in the list; further detents SHALL move focus one option. A still knob 1 click SHALL call `Select` on the confirmed focused option, or `Invoke` when that option is already the current model. Codex returns to its picker, which the router SHALL then close. The outcome SHALL be `applied` when the closed picker button's `<model> <effort>` name starts with the picked model, `mismatch` when it names another option and `unverified` when it names none or the picker did not close.
- **Codex effort:** with the owner's chords in the profile, each detent SHALL send one chord through `tapInClient` only with Codex qualified and in front, no card and the picker closed, and SHALL be `applied` when the picker button's name changed within the readback bound, else `mismatch` (`unchanged`) with the waiting detents dropped. Without chords, a detent SHALL expand the picker, focus its "Power" entry by UI Automation and send Right or Left only while a fresh read shows the picker holding focus on Power, with the level count read from the announcement each time; at an end it SHALL send nothing (`at-limit`). A picker without Power SHALL be `unsupported`.
- **Closing:** a Claude control SHALL close with `Collapse`, only when a read shows its button expanded, and the composer SHALL then get focus. Codex's picker does not close on `Collapse`: a model list left without a pick SHALL first get `Invoke` on its current model, which returns to the picker unchanged (observed 2026-10-07; `Select` on the current model does nothing there), and Escape SHALL never be sent from the list; then exactly one Escape SHALL be sent, only when a fresh read shows the `Select effort` picker holding focus, followed by a bounded wait for the picker button to read collapsed. A picker still open after that wait SHALL be logged as closed and unverified and SHALL never get a second Escape. A control the owner already closed SHALL get nothing.

`applied`, `mismatch`, `unverified`, `unsupported` and `at-limit` SHALL be logged apart, with indexes, positions and counts but no labels. An open control SHALL close after `timing.menuTimeoutMs` without a turn, on knob 2's click (for effort), and before any other control acts: input that arrives while a flow is open or closing SHALL wait and then act in order, so two flows never act at once, and a profile reload or controller loss SHALL close the flow the same way. Knob 1 and knob 2 SHALL work independently: each changes only its own setting, and turning one closes the other's open control first.

#### Scenario: Claude model step and pick
- **WHEN** Claude is in front and the owner turns knob 1 one detent clockwise and one counter-clockwise, then, after holding it still, clicks it
- **THEN** the first detent opens the model menu on the current model, the second focuses the model above it, the click selects that model, the bridge logs `model` `applied`, the composer has focus again, and no key reached Claude

#### Scenario: Effort step in either client
- **WHEN** the owner turns knob 2 one detent with Claude in front, or with Codex in front and the owner's chords in the profile
- **THEN** Claude's Effort slider is set one step up, or Codex receives one increase chord without its picker opening, and the change is confirmed as `applied` without any Enter

#### Scenario: End of the range
- **WHEN** Claude's effort is at the top of its slider and the owner turns knob 2 three detents up
- **THEN** nothing is set, one `at-limit` is logged with one error flash, and a detent back down acts at once

#### Scenario: Unsupported effort
- **WHEN** Claude uses a model with no Effort button, or Codex's picker has no Power entry and the profile names no Codex effort chords
- **THEN** knob 2 reports `unsupported` with an error flash, and anything it opened is closed

#### Scenario: Chords only in Codex
- **WHEN** the profile names the Codex effort chords and Claude is in front when knob 2 turns
- **THEN** Claude's own slider is used and no chord is sent, so no Claude pane splits

#### Scenario: One Escape with lagging reads
- **WHEN** every UI Automation read lags one change behind and the owner picks a Codex model with knob 1
- **THEN** Codex's picker receives exactly one Escape, though the first read after it still shows the picker open, and no key reaches anything else

#### Scenario: Refusal with a card or another app
- **WHEN** a card is open in the client in front, or another app is in front, and the owner turns knob 1 or knob 2
- **THEN** the knob refuses with an error flash and nothing happens in any window

#### Scenario: Another control closes the menu first
- **WHEN** knob 1's Claude model menu is open and the owner presses Play with a draft in the composer
- **THEN** the menu collapses and the composer gets focus, then Send types its one Enter into the composer, and the model is unchanged

#### Scenario: Menu closed by the owner
- **WHEN** the owner closes an open control with the mouse and the knob's timeout passes
- **THEN** the bridge sends no Escape and calls no Collapse

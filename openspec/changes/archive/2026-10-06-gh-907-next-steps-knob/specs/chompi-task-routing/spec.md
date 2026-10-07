## MODIFIED Requirements

### Requirement: Distinct state lights
The bridge SHALL light each slot from the newest Hub record for its task, keeping activity, attention, notice acknowledgment, read evidence and freshness distinct. Attention SHALL pulse. Slot keys SHALL show task state only: no key marks a selected or targeted task, so focusing a task never looks like acknowledging it. Only an idle task with an unacknowledged completion notice and no `read` evidence SHALL use the completion color. Unknown activity, uncertain freshness, restart uncertainty, ended and a stale or unavailable feed MUST NOT use the completion color. A refused slot press SHALL light that key's error state briefly. The big-wheel LEDs SHALL stay off, because Send and card answers are decided at the press and nothing polls the window in front, except that a refused or uncertain Send or card press SHALL light both in the error color for the profile's error flash time; a Send refused as a `repeat` within the repeat window or abandoned because Record was pressed (`superseded`) SHALL NOT flash. Slot keys SHALL show the visible page's slots, and keys for its empty slots SHALL stay off. Small knob 4's LED SHALL show the visible page in that page's color (`colors.pages`), and while any task on another page, including slots beyond the profile's pages, has attention it SHALL alternate between the page color and the attention color on the attention pulse; it shows no other state, except that a refused Attention click SHALL light it in the error color for the error flash time, after which it shows the page again. The Attention click on knob 4 SHALL have no light of its own. A black key mapped to `attention` SHALL show the attention color, steady, while any task on the profile's pages waits for the owner and the feed is current, and SHALL be off otherwise; a refused press of that key SHALL light it in the error color for the error flash time. Black keys without a mapping and a black key mapped to `back` SHALL have no light. The volume knob's LED SHALL light only in the error color, for the error flash time, when a volume key is ignored during Record or fails. Knob 1's LED (26) and knob 2's LED (27) SHALL show the `active` color while that knob's model menu, effort slider or picker is open, and for the error flash time after a change SHALL show the `applied` color (`colors.applied`) for a change the client confirmed, the `unknown` color for one it could not confirm, and the error color for a refusal, a mismatch, an unsupported setting or the end of the range; otherwise they SHALL be off. Knob 3's LED (28) SHALL show the `active` color while a next-step suggestion is highlighted, and for the error flash time after a click SHALL show the `applied` color for a draft the readback confirmed, the `unknown` color for an unconfirmed fill, and the error color for a refusal; otherwise it SHALL be off. The renderer SHALL provide a state label for every slot.

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

#### Scenario: Next-step knob light
- **WHEN** knob 3 highlights a Claude suggestion and a still click fills it into the composer, and later knob 3 is turned with Codex in front
- **THEN** knob 3's LED shows the active color, then the applied color for the error flash time, and then flashes the error color

### Requirement: Release on loss
A bridge `stale`, `session-restart` or `disconnected` event, an overflowed event subscription, Back, a profile swap and shutdown SHALL cancel any focus in progress, pending wheel steps, pending volume keys with the volume knob's partial rotation and pending model, effort and next-step knob steps with their partial rotation, end dictation and release every key the adapter holds. A bridge `stale`, `session-restart` or `disconnected` event SHALL also drop input waiting for a knob flow to close, and an open model menu, effort slider or picker SHALL then be closed the way its knob closes it, and a highlighted next step SHALL drop to Claude's composer. No earlier input SHALL be replayed: after recovery, each control acts only on a fresh press, evaluated at that press. SIGINT, SIGTERM, SIGHUP and SIGBREAK SHALL stop the bridge the same way. On any process exit the adapter's synchronous release SHALL run when the adapter offers one, and an uncaught exception or unhandled rejection SHALL release keys, report the error and exit non-zero.

#### Scenario: Disconnect during Record
- **WHEN** the controller disconnects while Record is held, and then reconnects
- **THEN** the chord is released, no draft is sent and nothing is typed by the reconnect, and a Send pressed after the reconnect is a new press evaluated against the window then in front

### Requirement: Versioned profile with atomic reload
The bridge SHALL read one JSON profile with `schemaVersion: 1` of at most 64 KiB containing control mappings, key names limited to those the OS adapter can type, colors, brightness, timings, optional card-navigation settings and qualified versions for both clients, and no URIs, paths, commands or package identities. Fields added after the first release SHALL be optional with documented defaults: `cards.stepCounts` (encoder counts per card step, 1-96, default 6, about a quarter turn at the about 25 counts per revolution measured on the trial device on 2026-10-05) and `cards.clickStillMs` (wheel stillness before a card press, 0-2000 ms, default 250), `pages.count` (task pages of 15 slots, 1-8, default 4), `pages.stepCounts` (knob 4 encoder counts per page, 1-96, defaulting to the card step default), `pages.attentionClick` (whether knob 4's click is the Attention click, default `true`), `colors.pages` (knob 4's LED color per page, page 1 first, at least one per page, with eight distinct defaults), `keys` (black-key controls 16-25 mapped to `attention` or `back`; absent, none), `volume.stepCounts` (volume knob encoder counts per volume key, 1-96, default 1), `volume.invert` (default `false`, clockwise raises the volume), `timing.attentionRepeatMs` (the Attention key's repeat window, 500-30000 ms, default 4000), `model.stepCounts` (knob 1 encoder counts per menu step, 1-96, default 6, the card step default, because knobs 1-3 are unmeasured), `model.invert` (default `false`, clockwise moves down the menu), `model.clickStillMs` (knob 1 stillness before its click picks a model, 0-2000 ms, default 250), `effort.stepCounts` (knob 2 encoder counts per effort level, 1-96, default 6), `effort.invert` (default `false`, clockwise raises the effort), `shortcuts.codexEffortIncrease` and `shortcuts.codexEffortDecrease` (the owner's Codex effort chords, both or neither; absent, Codex effort uses its picker's Power entry), `timing.menuTimeoutMs` (how long a knob's open menu, slider or picker stays open, or knob 3's highlight stays, after its last turn, 1000-30000 ms, default 5000), `colors.applied` (the knobs' confirmed-change flash, default `[0, 255, 120]`), `nextSteps.stepCounts` (knob 3 encoder counts per suggestion step, 1-96, default 6), `nextSteps.invert` (default `false`, clockwise moves to the next suggestion) and `nextSteps.clickStillMs` (knob 3 stillness before its click fills a draft, 0-2000 ms, default 250). A Codex effort chord MUST hold `LeftControl`, `LeftAlt` or `LeftWindows` with exactly one other key and MUST NOT include `Enter`, and the two chords MUST differ. Key names SHALL include `Equal` and `Minus`, the `=` and `-` keys; the keys only the adapter's `tapInClient` types (`Left`, `Right` and `Escape`) SHALL NOT be profile key names. A `keys` entry for a control the `controls` section maps (a slot, Record, Send or Back) SHALL be rejected with the owning path. With a `volume` section, `controls.scroll` MUST NOT be 46 and `controls.record` and `controls.back` MUST NOT be 34, the volume knob's turn and click; a profile without a `volume` section that maps either SHALL keep its mapping and the volume knob SHALL send no volume key. With a `model` section, `controls.scroll` MUST NOT be 44 and `controls.record` and `controls.back` MUST NOT be 32, knob 1's turn and click; with an `effort` section the same holds for 41 and 29, knob 2's turn and click, and with a `nextSteps` section for 42 and 30, knob 3's turn and click; a profile without the section that maps either SHALL keep its mapping and that knob SHALL be off. `controls.scroll` MUST NOT be 43, small knob 4's turn, which pages tasks. Colors that no longer have a meaning (`selected`, `sendReady` and `sendBlocked`) SHALL be accepted when present and ignored, so an existing profile keeps loading. Validation SHALL reject unknown fields and invalid values with path-qualified messages. A changed valid profile SHALL be swapped in whole; an invalid or unreadable one SHALL be reported once and the last good profile kept. A swap SHALL cancel pending actions and release keys without replaying input, and SHALL send the new profile version in the following host heartbeats. A missing or invalid profile at start SHALL exit before any device opens.

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

#### Scenario: Installed profile and knob 3
- **WHEN** the installed profile from an earlier release, with no `nextSteps` section, is loaded
- **THEN** it validates unchanged with `schemaVersion` 1 and knob 3 picks Claude's next steps with 6 counts per step and a 250 ms click stillness; a profile without the section that maps 42 as `controls.scroll` keeps that mapping and knob 3 is off

#### Scenario: Codex effort chords
- **WHEN** the profile names `codexEffortIncrease` as `LeftControl`, `LeftAlt`, `Equal` and `codexEffortDecrease` as `LeftControl`, `LeftAlt`, `Minus`, or names only one of them, or a chord without Control, Alt or Windows, or with `Enter` or `Down`
- **THEN** the first validates as written and each other is rejected with its path

## ADDED Requirements

### Requirement: Next-step knob
Small knob 3 (`ENC_2`: turn 42, click 30) SHALL pick Claude Desktop's suggested next step (#907): the suggestion buttons the `next-steps` mod shows in a band above Claude's composer, and Claude's own ghost text. It SHALL act only on a qualified Claude window in front, with a known card state and no card, the model and effort controls readable with none of them open, no Record chord, and no Send or task focus in progress; with Codex in front it SHALL refuse with `codex-no-next-steps`, because Codex next steps are a separate story. Every refusal SHALL carry a reason code and an error flash on knob 3's LED and do nothing. Knob 3 SHALL never press Enter, send a prompt or answer a card, and SHALL never read, log or return suggestion text: its reads are counts, indexes and booleans.

- **Turn:** one step per `nextSteps.stepCounts` encoder counts with the reversal rule of the other knobs. When no suggestion is highlighted, a detent SHALL require a band with at least one suggestion (`no-suggestions` otherwise) and an empty composer (`draft-present` otherwise) and SHALL move keyboard focus to the first suggestion (`focusSuggestion`, read back); each further detent SHALL move focus one suggestion, stopping at the first and last, and the "dismiss" button SHALL never be a stop. A step SHALL record a suggestion as highlighted only when the read-back confirms focus on it. A band whose suggestion count changed, or that is gone, SHALL end the highlight.
- **Click with a suggestion highlighted:** after `nextSteps.clickStillMs` without a turn, a fresh read SHALL confirm the same band, the highlighted suggestion holding focus and the composer empty; then `invokeSuggestion`, which invokes only the focused suggestion into an empty composer, so the mod writes it into the composer as a draft. The composer SHALL then get keyboard focus back, so Play sends it, and the bridge SHALL log `next-step` `filled` when the composer holds a draft within `timing.verifyTimeoutMs`, else `unverified`.
- **Click with nothing highlighted:** Claude's ghost text is not exposed to UI Automation, so the click SHALL send exactly one Right arrow through `tapInClient` into Claude, only when a fresh read shows Claude's composer focused and empty, which accepts the ghost text when one shows and does nothing otherwise; the bridge SHALL log `next-step` `filled` when the composer then holds a draft and `unverified` (`composer-empty`) when it stays empty. An unfocused composer SHALL refuse with `composer-unfocused` and a draft with `draft-present`.
- **Empty composer:** the composer's value is empty or only one trailing line break (`\n` or `\r\n`), as Claude's empty composer reads.
- **Closing:** a highlight SHALL drop after `timing.menuTimeoutMs` without a turn, and before any other control acts, as the other knob flows close; input waiting meanwhile acts in order afterwards, so two flows never act at once, and a profile reload or controller loss SHALL close it the same way. Dropping the highlight SHALL give Claude's composer keyboard focus.

#### Scenario: Pick a suggestion
- **WHEN** Claude shows three suggestions above its empty, focused composer and the owner turns knob 3 one detent, then one more, then holds it still and clicks
- **THEN** the first detent focuses the first suggestion, the second the next one, the click invokes it, the composer holds that suggestion as a draft with focus again, nothing is sent, no key reached Claude, and Play then sends the draft

#### Scenario: Ends of the band
- **WHEN** the third of three suggestions is highlighted and the owner turns knob 3 two more detents clockwise
- **THEN** focus stays on the third suggestion and never reaches "dismiss"

#### Scenario: Accept the ghost text
- **WHEN** nothing is highlighted, Claude's composer is focused and empty with ghost text showing, and the owner clicks knob 3
- **THEN** one Right arrow goes into Claude's composer, the ghost text becomes the draft, and nothing is sent

#### Scenario: Refusals
- **WHEN** knob 3 is turned or clicked with Codex in front, with a draft in Claude's composer, or with a card open, or turned with no band showing
- **THEN** it refuses with `codex-no-next-steps`, `draft-present`, `card-open` or `no-suggestions`, flashes the error color, and no input reaches any window

#### Scenario: Lagging reads
- **WHEN** every read of the band lags one change behind and the owner highlights a suggestion and clicks, or clicks for the ghost text
- **THEN** exactly one suggestion is invoked, or exactly one Right arrow is sent

#### Scenario: Another control drops the highlight
- **WHEN** a suggestion is highlighted and the owner presses Play, Record, a slot key or another knob
- **THEN** the composer gets focus first, and only then does that control act

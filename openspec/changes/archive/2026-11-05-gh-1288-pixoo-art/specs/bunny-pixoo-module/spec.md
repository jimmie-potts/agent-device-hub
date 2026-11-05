## ADDED Requirements

### Requirement: Private art staging

Pixoo SHALL accept `art-stage/2.0` only from the core and SHALL preserve the validated original and immutable 64×64 rendition in private transient storage. A stage SHALL have no display effect and SHALL NOT enter the permanent library. PNG stills and GIFs of at most 20 frames SHALL match their declared format, dimensions, frame count, duration and hash. Animated timing SHALL be uniform, 100–800 ms per frame, and within the configured device profile. Decoding, bytes, queued work and live retained copies SHALL be bounded. A successful outcome SHALL mean the private copy committed, with observed evidence, and SHALL NOT claim physical output.

#### Scenario: A still and short animation are staged
- **WHEN** the core stages a valid PNG and a valid GIF
- **THEN** their originals are preserved, their immutable previews match the decoded 64×64 frames and effective timing, and no display command occurs
- **AND** the permanent catalog is unchanged

#### Scenario: Invalid or unauthorized staging
- **WHEN** a stage has a forged sender, bad signature or hash, false decoded metadata, excessive resources or unsupported timing
- **THEN** it is refused or completes failed without offering the copy and without a display command

#### Scenario: Duplicate and conflicting composition identities
- **WHEN** an unexpired composition is staged again with identical bytes
- **THEN** its immutable rendition is reused and its lifetime is renewed
- **WHEN** the same unexpired composition is staged with different bytes
- **THEN** it is refused with duplicate-conflict and the original copy is unchanged

#### Scenario: Retention and restart preserve ownership
- **WHEN** a staged copy expires or staging fails and cleanup runs
- **THEN** unused transient copies are removed without removing any permanent library original or referenced rendition
- **AND** a copy held by an active moment or preview remains until that use ends
- **WHEN** the module restarts
- **THEN** committed unexpired copies remain usable, unfinished commands report uncertainty and no presentation replays

### Requirement: Exact-art moments

Pixoo SHALL declare `moments.art` when its configured profile admits the implemented art path. A core-forwarded `moment-play/2.1` with art SHALL resolve and retain that exact composition before admission, and SHALL refuse unknown or expired references before any effect. It SHALL never substitute mood art for an unusable exact reference. The existing one writer, moment time box, attention, manual-control and current-base restoration rules SHALL apply. A moment without art SHALL keep its current behavior.

#### Scenario: Staged animation plays and returns
- **WHEN** a core art moment names a staged animation and the current base admits the moment
- **THEN** its exact frames and admitted timing reach the existing writer, then the current base returns
- **AND** expiry during that moment does not remove its copy

#### Scenario: Unavailable or forbidden exact art
- **WHEN** a caller other than the core requests an art moment, its reference is unknown or expired, or its profile cannot play it
- **THEN** no device write occurs and no mood fallback plays

#### Scenario: Existing admission wins
- **WHEN** attention, manual takeover, paused Media or another existing moment gate refuses exact art
- **THEN** the current display intent is preserved with no queued replay

## MODIFIED Requirements

### Requirement: Moment interludes

The module SHALL declare `capabilities.moments` with the moods `celebrate`, `setback` and `reminder`, a 10 s maximum duration, and `coversStatus` following the owner's setting. It SHALL answer `moment-play` and `pixoo-moments-set` on `bunny.cmd.<family>.<device id>`, the second completing `succeeded` with `observed`. The setting SHALL default to on and SHALL be saved with the module's other settings. A moment SHALL NOT change the device mode.

Before accepting, the module SHALL refuse with `unsupported-capability` a mood or duration the capability does not offer; with `invalid-state` a moment ID it accepted in the last 24 hours, across restarts, or a moment the current presentation does not admit; with `expired` a moment past its start window; and with `capacity` a moment while another waits or plays. The presentation SHALL check admission again at the start, and a moment no longer admitted SHALL complete `failed` with no device write.

Over Monitor a moment SHALL be admitted only while Monitor participates, the request's `coversStatus` is true, the setting is on, the session source is current and no session needs attention. Over Media a moment SHALL be admitted only while a playlist is in play or the player is idle, no Now Playing takeover holds the display and no session needs attention. A player is idle when it is stopped or finished, or paused with nothing loaded, and it is not in error, and no uncertain write or external control has left the display unknown. A paused item SHALL refuse it. A moment over an idle player SHALL NOT change the player, SHALL end when the player changes or the screen turns off, and SHALL be followed by one blank frame unless something else takes the display.

Exact art over resting Media additionally SHALL require a stopped player, with or without a retained item. An explicit no-selection pause SHALL survive restart until a deliberate Stop or Clear releases it; failed or rejected commands SHALL NOT imply release. Shutdown alone SHALL NOT pause fresh stopped Media. Core arbitration SHALL retain ownership of scheduled-art pins.

Over playing Media the moment SHALL pause the player through the Now Playing takeover and SHALL resume it only while the generation its own pause produced, the paused intent and the screen request are unchanged. Art over stopped Media SHALL leave player intent and selection unchanged and use the existing blank path when it ends. No additional restore path SHALL exist. Over Monitor the moment SHALL write under Monitor's generation and the next picture SHALL be the current dashboard.

A moment SHALL end when its duration has passed since its first acknowledged write. Attention SHALL end it at once on either base, and a session source that stops being current SHALL end it over Monitor; either ending is `preempted`. An explicit command that changes what plays, turning the setting off over Monitor, or a Monitor view change SHALL end it as `interrupted`. A pause, stop or new start, including a start still capturing its selection, SHALL never be resumed over; a next or previous SHALL keep the playlist playing; a view change in Media SHALL resume the playlist. A moment SHALL NOT pause over a start still capturing. When a moment's picture was confirmed on the device and no dashboard, card or playlist follows, one blank frame SHALL replace it, never retried, and it SHALL be dropped after an uncertain write, or once the device was offline or under external control. A song that wants a whole takeover when the moment ends SHALL take the display with the player still paused.

A moment without art SHALL choose its mood picture from the request and draw it in a render worker before the player or the device is touched. A moment naming art SHALL use its retained validated rendition instead, preserving the staged frame timing. A failed render or content read SHALL complete `failed` and change nothing.

A moment that reached the device SHALL complete `succeeded` with `transmitted` and SHALL publish `moment-ended` in the same transaction as its outcome. One that never reached it SHALL have no ending: a failed or uncertain write SHALL complete as that write, the base SHALL come back over Media unless the player paused itself on the uncertainty, and Monitor SHALL stop as it does for a failed dashboard. A moment SHALL NOT be replayed after a restart: its command SHALL be reported `uncertain` at the next start.

#### Scenario: A moment over Monitor returns to the current dashboard
- **WHEN** Monitor shows a session and a moment with `coversStatus` arrives, and the session changes while it plays
- **THEN** the moment shows for its duration with Monitor still selected and participating, it completes `succeeded` with `transmitted` and a `completed` ending, and the Pixoo shows the changed session's dashboard

#### Scenario: Attention ends a moment over Monitor
- **WHEN** a moment plays over Monitor and a session starts waiting for approval, and the approval later resolves
- **THEN** the moment ends with `preempted`, the dashboard returns, and the moment does not play again

#### Scenario: A moment Monitor does not admit
- **WHEN** Monitor is on the display and a moment arrives with `coversStatus` false, with the setting off, with a session needing attention, or with the session source stale
- **THEN** it is refused with `invalid-state` and nothing is written

#### Scenario: A moment over Media resumes in place
- **WHEN** a playlist plays and a flourish arrives
- **THEN** the player pauses, the moment shows with the mode unchanged, and the playlist resumes at the same item when it ends

#### Scenario: A moment over an idle player
- **WHEN** Media has nothing loaded, and a moment arrives
- **THEN** the moment shows for its duration, the player and the mode do not change, it completes with a `completed` ending, and one blank frame replaces its picture

#### Scenario: A moment over a stopped or finished item
- **WHEN** a playlist item is stopped or its playlist has finished in Media, and a moment arrives
- **THEN** the moment shows for its duration, the player keeps its stopped item and generation, one blank frame replaces the moment's picture, and the item can still resume

#### Scenario: A moment over a held item
- **WHEN** a playlist item is paused in Media and a moment arrives
- **THEN** it is refused with `invalid-state` and nothing is written

#### Scenario: A manual command during a moment over Media
- **WHEN** a pause, stop or start arrives while a moment plays over Media
- **THEN** the moment ends with `interrupted`, the moment does not resume the player over that command, and after a pause or stop one blank frame replaces its picture

#### Scenario: A song during a moment over Media
- **WHEN** Now Playing wants the whole display and a song starts during a moment over Media
- **THEN** the card follows the moment with no upload of the playlist in between, and the playlist resumes when the song stops

#### Scenario: A failed write over Media
- **WHEN** the moment's write fails without reaching the device
- **THEN** the moment has no ending, its command completes as that write, and the playlist resumes

#### Scenario: A restart during a moment
- **WHEN** the module restarts with a moment accepted and unfinished
- **THEN** its command is reported `uncertain`, it does not play, and its moment ID stays refused

#### Scenario: Exact art over empty Media
- **WHEN** the core sends exact art while Media is idle and stopped without a selected session or item
- **THEN** the bounded art plays through the existing writer without pausing or starting playback and clears to blank when complete
- **AND** a manual change cancels it without replay, while explicit pauses, selected content, attention and Now Playing remain protected
- **AND** ordinary mood moments retain their accepted idle-player behavior

#### Scenario: Empty pause survives restart
- **WHEN** the owner pauses without a selected playback checkpoint and the module restarts
- **THEN** exact art remains refused without a display write until the owner deliberately releases the pause
- **AND** a failed save reports uncertainty, not a durable successful pause

#### Scenario: A view change while empty-Media art waits or plays
- **WHEN** the owner changes the Monitor view while exact art waits or plays over empty Media
- **THEN** waiting art is cancelled without a write, or playing art ends as interrupted and clears through the existing blank path
- **AND** neither moment replays

#### Scenario: Exact art over a stopped or finished item
- **WHEN** the core sends exact art while Media holds a stopped or finished item and the display is known
- **THEN** the moment preserves the saved item, intent and generation, and one blank follows its completion
- **AND** a manual resume interrupts the moment without a blank over resumed playback; a paused item or unknown display still refuses

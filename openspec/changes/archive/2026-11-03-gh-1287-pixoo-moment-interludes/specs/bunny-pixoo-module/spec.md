## ADDED Requirements

### Requirement: Moment interludes

The module SHALL declare `capabilities.moments` with the moods `celebrate`, `setback` and `reminder`, a 10 s maximum duration, and `coversStatus` following the owner's setting. It SHALL answer `moment-play` and `pixoo-moments-set` on `bunny.cmd.<family>.<device id>`, the second completing `succeeded` with `observed`. The setting SHALL default to on and SHALL be saved with the module's other settings. A moment SHALL NOT change the device mode.

Before accepting, the module SHALL refuse with `unsupported-capability` a mood or duration the capability does not offer; with `invalid-state` a moment ID it accepted in the last 24 hours, across restarts, or a moment the current presentation does not admit; with `expired` a moment past its start window; and with `capacity` a moment while another waits or plays. The presentation SHALL check admission again at the start, and a moment no longer admitted SHALL complete `failed` with no device write.

Over Monitor a moment SHALL be admitted only while Monitor participates, the request's `coversStatus` is true, the setting is on, the session source is current and no session needs attention. Over Media a moment SHALL be admitted only while a playlist is in play, no Now Playing takeover holds the display and no session needs attention. A paused or stopped player SHALL refuse it.

Over Media the moment SHALL pause the player through the Now Playing takeover and SHALL resume it only while the generation its own pause produced, the paused intent and the screen request are unchanged. No other restore path SHALL exist. Over Monitor the moment SHALL write under Monitor's generation and the next picture SHALL be the current dashboard.

A moment SHALL end when its duration has passed since its first acknowledged write. Attention SHALL end it at once on either base, and a session source that stops being current SHALL end it over Monitor; either ending is `preempted`. An explicit command that changes what plays, turning the setting off over Monitor, or a Monitor view change SHALL end it as `interrupted`. A pause, stop or new start, including a start still capturing its selection, SHALL never be resumed over; a next or previous SHALL keep the playlist playing; a view change in Media SHALL resume the playlist. A moment SHALL NOT pause over a start still capturing. When a moment's picture was confirmed on the device and no dashboard, card or playlist follows, one blank frame SHALL replace it, never retried, and it SHALL be dropped after an uncertain write, or once the device was offline or under external control. A song that wants a whole takeover when the moment ends SHALL take the display with the player still paused.

What a moment shows SHALL be chosen in one function from its request and drawn in a render worker before the player or the device is touched. A failed render SHALL complete `failed` and change nothing.

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

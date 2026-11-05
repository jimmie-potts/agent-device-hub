## MODIFIED Requirements

### Requirement: Nanoleaf commands and outcomes

The module SHALL answer, on each device's own keys, `device-mode-set` (Work, Quiet and Free), `power-set`, `brightness-set` and `scene-activate`, answer bounded `moment-play` on Lines, refuse `zone-power-set`, `media-start` and `media-control` with `unsupported-capability`, and answer its own families: wall edits, machine edits, animation play, favorite edits and notice acknowledgment. It SHALL refuse a stale `expectedConfigurationRevision` or `expectedGeneration` with `revision-conflict` and a command `commandSupported` rejects with `unsupported-capability`, before anything changes. Admission SHALL keep the port's domain checks: requested scenes and animations play in Free only, bounded moments also play in Work, animations on the Lines and NL22 Panels, one waiting animation per device, 32 waiting native commands, `validFavoriteEdit` and the effect rules. Each admission SHALL run inside the module's outbox transaction, so an accepted command's journal row commits before its `accepted` reply, and a refusal or a store failure rolls back and is the reply: a store that is full, told by the `SQLITE_FULL` or `ENOSPC` code on the error or a cause that wraps it and never by its text, SHALL be refused with `capacity`, and any other store failure with `internal`, which the module logs once with the error's type; no record SHALL carry the error's text. Each accepted command SHALL end with exactly one outcome through the outbox, in the command's trace, with the registry's error detail: `succeeded` with transmitted or observed evidence, `failed`, or `uncertain`. A mode is the module's own state: a `device-mode-set` SHALL commit its mode, ending the device's queued work, its hold and its overrides, and complete `succeeded` with evidence `observed` in its admission's transaction, whether or not the device answers; nothing is sent to the device as part of it, so it has no expiry, and the worker paints the mode as the module's state once the device answers, as the device's availability shows. Power, brightness, scenes and animations are device writes. A write whose answer did not come SHALL end `uncertain` and SHALL NOT be retried. A native control SHALL hold the device until an explicit mode command or a fresh control; a requested animation SHALL preserve its existing no-hold behavior. A device that answers a write with an HTTP error status heard it: the command SHALL fail with evidence `transmitted` and the status's code (401 `unauthenticated`, 403 `forbidden`, 404 `not-found`, 409 `invalid-state`, 429 `capacity`, 5xx `unavailable`, any other `invalid-request`), and nothing SHALL hold the device. A device write still queued at its expiry SHALL fail `expired`, whether or not a worker runs, and SHALL hold nothing, since it proves no effect. A power or brightness command that fails SHALL take its desired value with it unless another of its kind still waits. At a restart, each command accepted before it with no outcome SHALL end and never run: an attempt without a result is uncertain, as is an acknowledgment whose request may have reached the core, and a queued command or a waiting machine edit fails `cancelled`. A missing saved layout SHALL refuse an animation or a wall edit that needs it with `invalid-state`, and a refused favorite edit SHALL say what was wrong with the favorite.

The Lines moment capability SHALL advertise the required `celebrate`, `setback` and `reminder` vocabulary and a 10,000 ms maximum duration. Work SHALL admit an interlude only when `coversStatus` carries the owner-approved interrupt permission, and alerts SHALL always preempt. Free SHALL require a currently observed named scene and brightness, and a newer scene, brightness, configuration or mode choice SHALL supersede restoration. Start windows, persistent moment identity and the existing uncertain-write hold SHALL prevent stale effects, replay and automatic retry.

#### Scenario: Work, Quiet and Free
- **WHEN** an operator sets a wall showing a task to Quiet, then Free, then Work
- **THEN** each is accepted and succeeds with evidence `observed` as its mode commits, the Lines dim to the Quiet level, play their saved scene with no indicator write in Free, and show the task again in Work; a mode the device does not advertise is refused with `unsupported-capability`

#### Scenario: Play outside Free
- **WHEN** an animation is asked for in Work, in Quiet and in Free
- **THEN** the first two are refused with `unsupported-capability` and have no outcome, and the third is accepted and succeeds with transmitted evidence

#### Scenario: Requested animations on NL22
- **WHEN** the owner requests a preset, explicit recipe or saved favorite for configured NL22 Panels in Free
- **THEN** only the selected Panels device receives the bounded display 2.0 animation, using each triangle's single zone and saved position without the Lines logical-zone flag
- **AND** an unsupported recipe, unavailable required geometry, wrong mode or full per-device animation slot refuses before a write

#### Scenario: Independent animation ownership
- **WHEN** Lines and Panels each receive an animation and the Panels mode changes, its command expires or its write response is lost
- **THEN** the Panels command follows the existing cancellation and expiry rules, or ends uncertain without retry or a hold after a lost response, while the Lines command and mode keep their own outcomes

#### Scenario: A moment
- **WHEN** a supported bounded moment is asked of Lines in Work or over a currently observed named Free scene
- **THEN** the single device writer plays it once and restores current Work rendering or the named Free base before completing; the start window, current revision and alert policy are checked before effects

#### Scenario: Unknown Free content
- **WHEN** a moment is asked in Quiet, on panels, or over unknown or unnamed Free content
- **THEN** it is refused with unsupported-capability before effect writes

#### Scenario: A moment is overtaken
- **WHEN** a mode, configuration, alert or explicit content choice overtakes a moment
- **THEN** the current choice takes precedence, stale restoration is not written and the tracked outcome states whether effects were transmitted or uncertain

#### Scenario: Restart during a moment
- **WHEN** the module restarts with a queued or attempted moment
- **THEN** it ends without playing the moment again and preserves the existing uncertain-write hold

#### Scenario: An uncertain write
- **WHEN** a brightness write reaches the device and its answer is lost
- **THEN** the command ends `uncertain` with `uncertain-result`, the device takes no further write, the lost write included, until an explicit mode command, which releases the hold; meanwhile the device record is `degraded`, not `unavailable`, the wall view shows `held`, and the hold is logged once as it begins and once as it ends

#### Scenario: Commands while the wall does not answer
- **WHEN** Quiet and then a brightness write are accepted while the wall does not answer, the write's deadline passes, and the wall answers again
- **THEN** Quiet succeeds with evidence `observed` at once, the brightness write fails `expired` with evidence `none` and takes its desired brightness with it, nothing holds the wall, and once it answers the device is `available`, the wall shows Quiet at Quiet's level, and a new session takes a Line with no other command

#### Scenario: A device that answers with an error
- **WHEN** the wall answers a brightness write with 400, a scene it no longer has with 404, and a power write with 401
- **THEN** each command fails with evidence `transmitted` and `invalid-request`, `not-found` and `unauthenticated`, nothing holds the wall, the next write goes out, and a wall that refuses every request with 401 is `degraded`, not `unavailable`, logged once each way

#### Scenario: A command no worker checks
- **WHEN** another instance holds the device's worker lock and a power command's deadline passes
- **THEN** the command fails `expired` and never reaches the device

#### Scenario: A restart replays nothing
- **WHEN** the module restarts with a comet waiting and a power command queued, while the core does not serve its sessions
- **THEN** the power command fails `cancelled` and is never sent, and no comet or wave is written after the restart

#### Scenario: What a restart ends
- **WHEN** the module restarts while an acknowledgment's request waits at the core, a machine edit waits for a comet, and, in another run, a write's answer has not come
- **THEN** the acknowledgment ends `uncertain`, the machine edit fails `cancelled` and never applies, and the write ends `uncertain` and holds the device, shown as `degraded` and `held` with no failed pass

#### Scenario: A full store at admission
- **WHEN** a wall edit and a machine edit meet a full store, and later a read-only one
- **THEN** each edit on the full store is refused with `capacity`, which the bus records at WARN, with no transaction left open and nothing changed, and both are accepted once there is room; the edit on the read-only store is refused with `internal`, which the module logs once at ERROR with the error's type, and no record holds SQLite's text

### Requirement: Nanoleaf device state

The module SHALL serve, through sync as one of the owners of the shared family `device`, which a consumer names as `bunny/modules/nanoleaf` (Hub #967), and publish each device's `device/2.1` record (Hub #975), its wall view (`nanoleaf-wall`) and its animation options (`nanoleaf-animations`), each only when it changed, so a poll that reads the same power and brightness publishes nothing. The device record SHALL carry the power and brightness the device reported to `GET /state`, as an observation whose time is that of the reading that first showed them, never a desired value or a transport acknowledgment; desired power, brightness and mode; the configuration revision and generation commands guard on; the device's scenes; pending commands with their families; the last outcome; and the last write that reached the device, the module's own paints and writes it answered with an HTTP error included, with the request ID of the command it served if it served one, kept apart from the last outcome and saved, so that an outcome that sent nothing, a poll and a restart SHALL never change it; a change that includes a command's write SHALL be published at once, and a change from paints alone at most once every 5 s, with the first device request that settles after the interval: within one 5 s poll while the device answers, and up to that poll's 1.2 s deadline later once it stops answering. The module SHALL answer a sync with the states of the families it asks for and no other, so a reader may sync any one of them. Its availability SHALL be `unavailable` while the device does not answer; `degraded` while it answers and the module does not present it, because it refuses the module's token, its last pass failed, a hold stops its writes or no worker runs; and `available` otherwise. While a hold after a write that may have reached the device stops its writes, the device record SHALL carry `held` with that write's request ID and the time the hold began, the same after a restart, and the next record after an explicit mode command or a fresh control releases the hold SHALL omit it. The wall view SHALL show whether the last pass failed or no worker runs (`failing`) and whether a hold stops the device's writes (`held`). Neither the device record nor the wall view SHALL hold a favorite or preset name, an address or a credential. The animation options are the one view that lists favorites, by design, since a play request is chosen from them: they SHALL list the module's presets and the saved favorites with their recipes, the patterns, speeds, directions, defaults and bounds, the queued animation, whether saved positions place spatial patterns, and the remembered scene's ID, null when unavailable, and nothing else; favorites stay out of browser projections. Serving a sync SHALL change no row.

#### Scenario: Observed power
- **WHEN** the wall reports power on, then is switched off in its app
- **THEN** the device record shows observed power on, then off, while desired power stays unknown

#### Scenario: Favorites stay out of the read state
- **WHEN** a favorite is saved and a reader syncs the module's families from `bunny/modules/nanoleaf`
- **THEN** the animation options list it with its recipe and the module's presets, and nothing else; the device record and the wall view hold neither its name nor a preset name, and no row changed

#### Scenario: An idle wall
- **WHEN** the wall answers a minute of polls with the same power and brightness
- **THEN** no new device record is published, and the record keeps the observation it published

#### Scenario: Paints and a command write
- **WHEN** a new session's wave paints the wall several times, then a power command is written
- **THEN** each paint shows in the record's last transmission, with no request ID, within 5 s and one poll, the last transmission changes at most once per 5 s while the wall paints, and the power write shows at once with its request ID

#### Scenario: Back after an outage
- **WHEN** the wall answers again after an outage long enough for its status reads to back off to 30 s, and takes Quiet
- **THEN** the next status read comes within 5 s, and the record shows the Quiet level the wall reports

#### Scenario: Outcomes that sent nothing, and a restart
- **WHEN** the record shows a power write, then an acknowledgment, a saved favorite, a mode command while the wall does not answer and an expiry complete, or the module restarts and cancels a waiting command
- **THEN** the last transmission still shows the power write with its request ID, and the polls after the interval republish nothing

#### Scenario: One family alone
- **WHEN** a reader syncs `device`, `nanoleaf-wall` or `nanoleaf-animations` alone from `bunny/modules/nanoleaf`
- **THEN** each sync holds that family's states only, and the module runs on

#### Scenario: A held wall in its device record
- **WHEN** a brightness write's answer is lost, an explicit mode command releases the hold, a later write's answer is lost and a fresh brightness command releases that hold, and, in another run, the module restarts before a write's answer comes
- **THEN** while each hold lasts the device record is `degraded` and its `held` names the held write's request and the time the hold began, the wall view shows `held`, and each record after a release has no `held`; after the restart, `held` still names the write whose answer never came, from when it ended uncertain

#### Scenario: Animation state follows the selected device
- **WHEN** a reader syncs animation options for configured Lines and NL22 Panels
- **THEN** each record reports its own device ID, mode, queued animation, saved positions and remembered scene, with the shared frozen favorites catalog
- **AND** a favorite edit through the Lines owner updates both records without a device write

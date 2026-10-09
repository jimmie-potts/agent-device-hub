# nanoleaf-module Specification

## Purpose
The Nanoleaf runtime module ([Hub #844](https://github.com/jimmie-potts/agent-device-hub/issues/844)): the TypeScript port of codex-nanoleaf run as one of the B.U.N.N.Y. runtime's shipped modules under ADR 0012, following the core's synced sessions, answering the wall's commands with replies and outcomes, keeping the wall map the editor, and publishing each controller's state.

## Requirements

### Requirement: Nanoleaf module and its configuration

The runtime SHALL ship the Nanoleaf module, `nanoleaf`, the TypeScript port of codex-nanoleaf (Hub #26) wrapped as a module of API `1.1`, created by `createNanoleafModule({transport})` with the Nanoleaf HTTP client as its real transport and a simulated controller under `--simulate`. Its `configure` SHALL take 1 to 8 devices, each with a routing ID, a kind (`lines` or `panels`), a private IPv4 address and the name of its token's secret file, with exactly one Lines device, `wall`; 1 to 128 distinct qualified agent sources; and, optionally, Codex Desktop's metadata files. It SHALL refuse anything else with `invalid-request` and fixed text that repeats no value from the section, and return the device IDs. Its start SHALL open only local resources: its own SQLite file, its private folder, where it writes the port's registry file without any token, and its secret files, whose tokens it keeps in memory only.

#### Scenario: A section the module accepts or refuses
- **WHEN** the module's section names the Lines as `wall` with a private address and a named secret, or names a public address, a second Lines device, a device without its secret or a setting the module does not take
- **THEN** the first is accepted with its device IDs, and each other is refused with `invalid-request` and a fixed detail

#### Scenario: Tokens stay in memory
- **WHEN** the module starts with its token file and reaches its controllers
- **THEN** each request carries the token, and no file the module writes, message, log record, reply or synced state holds it

### Requirement: The core's sessions through sync

The module SHALL follow the core's `session/2.0` records through the SDK's sync, never a 1.x feed, and SHALL keep its copy of them in memory only, rebuilt by sync after a restart; no row SHALL hold the core's sessions. A sync that completes, the first or one after an overflow, SHALL be projected as a fresh start, so no comet or wave replays across a gap; each live change after it SHALL be projected as one change. The section's shared-input configuration SHALL be applied at start: a new one pauses shared input, and the module SHALL select shared input again with the synced sessions right after, as a fresh start that keeps epochs and replays nothing. A projection or failure report carrying the shared-input generation from before a new configuration SHALL change nothing; inside one runtime this guard is defensive, since the feed's generation moves with each projection, and the workers' lock files keep a second runtime off the same state. A shared-input configuration SHALL need no 1.x feed endpoint or token file, and one with `bindings` SHALL stay refused. A copy that stops following the core SHALL freeze the tasks steadily until a later sync, which the module SHALL try again with capped backoff, logging the failure and the recovery once each.

#### Scenario: A working session on a Line
- **WHEN** the core publishes a working session from a qualified source
- **THEN** the wall view shows it on an element and the Lines show its indicator; a session from another source is skipped

#### Scenario: A new task's wave and a finished turn's comet
- **WHEN** a session starts working after the first sync, then finishes its turn in Work
- **THEN** the Lines show one outward wave that does not loop, then the task's own loop, then one comet for the finished turn, and the task stays unread

#### Scenario: A resync after an overflow
- **WHEN** a burst of session changes overflows the module's sync subscription, so the SDK syncs again without a failure, and a turn ends in the gap
- **THEN** the completed sync is projected as a fresh start: no comet plays for that turn and no wave for the sessions that started in the gap

#### Scenario: A new configuration at a restart
- **WHEN** the module restarts with another qualified source
- **THEN** shared input is paused and selected again, both sources' sessions show, and no wave or comet replays

#### Scenario: A stale generation
- **WHEN** a feed that selected shared input projects, or reports a failure, after another configuration selected it again
- **THEN** the projection is refused and no row changes

### Requirement: Nanoleaf commands and outcomes

The module SHALL answer, on each device's own keys, `device-mode-set` (Work, Quiet and Free), `power-set`, `brightness-set` and `scene-activate`, answer bounded `moment-play` on Lines, refuse `zone-power-set`, `media-start` and `media-control` with `unsupported-capability`, and answer its own families: wall edits, machine edits, animation play, favorite edits and notice acknowledgment. It SHALL refuse a stale `expectedConfigurationRevision` or `expectedGeneration` with `revision-conflict` and a command `commandSupported` rejects with `unsupported-capability`, before anything changes. Admission SHALL keep the port's domain checks: requested scenes and animations play in Free only, bounded moments also play in Work, animations on the Lines only, one waiting animation, 32 waiting native commands, `validFavoriteEdit` and the effect rules. Each admission SHALL run inside the module's outbox transaction, so an accepted command's journal row commits before its `accepted` reply, and a refusal or a store failure rolls back and is the reply: a store that is full, told by the `SQLITE_FULL` or `ENOSPC` code on the error or a cause that wraps it and never by its text, SHALL be refused with `capacity`, and any other store failure with `internal`, which the module logs once with the error's type; no record SHALL carry the error's text. Each accepted command SHALL end with exactly one outcome through the outbox, in the command's trace, with the registry's error detail: `succeeded` with transmitted or observed evidence, `failed`, or `uncertain`. A mode is the module's own state: a `device-mode-set` SHALL commit its mode, ending the device's queued work, its hold and its overrides, and complete `succeeded` with evidence `observed` in its admission's transaction, whether or not the device answers; nothing is sent to the device as part of it, so it has no expiry, and the worker paints the mode as the module's state once the device answers, as the device's availability shows. Power, brightness, scenes and animations are device writes. A write whose answer did not come SHALL end `uncertain`, hold the device until an explicit mode command or a fresh control, and SHALL NOT be retried. A device that answers a write with an HTTP error status heard it: the command SHALL fail with evidence `transmitted` and the status's code (401 `unauthenticated`, 403 `forbidden`, 404 `not-found`, 409 `invalid-state`, 429 `capacity`, 5xx `unavailable`, any other `invalid-request`), and nothing SHALL hold the device. A device write still queued at its expiry SHALL fail `expired`, whether or not a worker runs, and SHALL hold nothing, since it proves no effect. A power or brightness command that fails SHALL take its desired value with it unless another of its kind still waits. At a restart, each command accepted before it with no outcome SHALL end and never run: an attempt without a result is uncertain, as is an acknowledgment whose request may have reached the core, and a queued command or a waiting machine edit fails `cancelled`. A missing saved layout SHALL refuse an animation or a wall edit that needs it with `invalid-state`, and a refused favorite edit SHALL say what was wrong with the favorite.

The Lines moment capability SHALL advertise the required `celebrate`, `setback` and `reminder` vocabulary and a 10,000 ms maximum duration. Work SHALL admit an interlude only when `coversStatus` carries the owner-approved interrupt permission, and alerts SHALL always preempt. Free SHALL require a currently observed named scene and brightness, and a newer scene, brightness, configuration or mode choice SHALL supersede restoration. Start windows, persistent moment identity and the existing uncertain-write hold SHALL prevent stale effects, replay and automatic retry.

#### Scenario: Work, Quiet and Free
- **WHEN** an operator sets a wall showing a task to Quiet, then Free, then Work
- **THEN** each is accepted and succeeds with evidence `observed` as its mode commits, the Lines dim to the Quiet level, play their saved scene with no indicator write in Free, and show the task again in Work; a mode the device does not advertise is refused with `unsupported-capability`

#### Scenario: Play outside Free
- **WHEN** an animation is asked for in Work, in Quiet and in Free
- **THEN** the first two are refused with `unsupported-capability` and have no outcome, and the third is accepted and succeeds with transmitted evidence

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

### Requirement: Wall-editor ownership

The wall map SHALL stay the editor (ADR 0007). A wall edit SHALL apply at once, or wait as the device's pending wall edit while a running comet would move. Each device SHALL carry a configuration revision in its state, which a wall edit of the map or a task's or project's association, a mode command, an applied machine edit, a favorite edit and a selection of shared input move. A machine edit SHALL name the revision it read and SHALL apply to the Lines only, one waiting at a time: it is refused with an actionable `revision-conflict` while a wall edit is pending on the device; a queued one fails with `revision-conflict`, without overwriting the newer choice, when a later wall, mode or association edit lands first; and it waits while the device's comet runs, then applies, or fails `expired`.

#### Scenario: A pending wall edit refuses a machine edit
- **WHEN** a style edit waits for a running comet, and a machine edit arrives
- **THEN** the machine edit is refused with `revision-conflict`, saying a wall edit is pending, and the wall edit applies once the comet ends

#### Scenario: A later edit wins
- **WHEN** a machine edit waits for a comet and a wall edit, a mode command or an association edit lands before the comet ends
- **THEN** the machine edit fails with `revision-conflict` and its setting never applies

#### Scenario: A machine edit waits for the comet
- **WHEN** a machine edit arrives while a comet runs
- **THEN** it has no outcome while the comet runs, then succeeds and moves the revision once it ends; one whose deadline passes first fails `expired` and never applies

#### Scenario: A selection moves the revision
- **WHEN** the module restarts with a new shared-input configuration, which selects shared input again
- **THEN** the configuration revision moves, and a machine edit naming the revision read before it is refused with `revision-conflict`

#### Scenario: Each rule fails without its check
- **WHEN** the pending wall edit refusal, the revision check or the comet wait is removed
- **THEN** the matching test fails

### Requirement: Nanoleaf device state

The module SHALL serve, through sync as one of the owners of the shared family `device`, which a consumer names as `bunny/modules/nanoleaf` (Hub #967), and publish each device's `device/2.1` record (Hub #975), its wall view (`nanoleaf-wall`) and, for the Lines, the animation options (`nanoleaf-animations`), each only when it changed, so a poll that reads the same power and brightness publishes nothing. The device record SHALL carry the power and brightness the device reported to `GET /state`, as an observation whose time is that of the reading that first showed them, never a desired value or a transport acknowledgment; desired power, brightness and mode; the configuration revision and generation commands guard on; the device's scenes; pending commands with their families; the last outcome; and the last write that reached the device, the module's own paints and writes it answered with an HTTP error included, with the request ID of the command it served if it served one, kept apart from the last outcome and saved, so that an outcome that sent nothing, a poll and a restart SHALL never change it; a change that includes a command's write SHALL be published at once, and a change from paints alone at most once every 5 s, with the first device request that settles after the interval: within one 5 s poll while the device answers, and up to that poll's 1.2 s deadline later once it stops answering. The module SHALL answer a sync with the states of the families it asks for and no other, so a reader may sync any one of them. Its availability SHALL be `unavailable` while the device does not answer; `degraded` while it answers and the module does not present it, because it refuses the module's token, its last pass failed, a hold stops its writes or no worker runs; and `available` otherwise. While a hold after a write that may have reached the device stops its writes, the device record SHALL carry `held` with that write's request ID and the time the hold began, the same after a restart, and the next record after an explicit mode command or a fresh control releases the hold SHALL omit it. The wall view SHALL show whether the last pass failed or no worker runs (`failing`) and whether a hold stops the device's writes (`held`). Neither the device record nor the wall view SHALL hold a favorite or preset name, an address or a credential. The animation options are the one view that lists favorites, by design, since a play request is chosen from them: they SHALL list the module's presets and the saved favorites with their recipes, the patterns, speeds, directions, defaults and bounds, the queued animation, whether saved positions place spatial patterns, and the remembered scene's ID, null when unavailable, and nothing else; favorites stay out of browser projections. Serving a sync SHALL change no row.

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

### Requirement: Nanoleaf workers and failure isolation

The module SHALL run one supervised worker per configured device on the runtime's clock, scheduler and stop signal, with its lock file in the private folder, start one after an accepted command when none runs, and start them again when shared input is selected again. A worker that ends because the store failed or another instance holds its lock SHALL start again after a wait that doubles from 1 s to 30 s, one start at a time: at most one pending start per device, which a start for a command or a selection replaces. The run SHALL be logged once as it ends, each later end at DEBUG, and once as it recovers, and a failed pass's run SHALL count as recovered only once a worker presents the device again. Every device request SHALL go through the device's link, which uses the configured address and in-memory token, settles within the light client's 1.2 s timeout on the module's scheduler, and turns timeouts into the device's availability: one `device.unavailable` warning when an outage begins, summaries at DEBUG, and one `device.available` when it ends; a device that answers with an HTTP error is reached, and one that refuses the module's token SHALL be logged once as the refusals begin and once as they end, with no failed-pass record besides. A failed pass for any other reason SHALL be logged once per run of failures. No transaction SHALL span an await or a device request, so a command or an edit is answered while the worker waits on the device. Each worker wait SHALL be rounded up to the runtime scheduler's whole milliseconds. Each device write made for a command SHALL record a `bunny.device.call` span in the command's trace. The lock files SHALL be created with mode 600. Device and store errors SHALL never fail the module (policy A): no scheduler callback throws, and a publication the store refuses is logged once and tried again. The module SHALL pass the module test kit with its offline check.

#### Scenario: An offline wall at start
- **WHEN** the module starts while its wall never answers
- **THEN** the start returns at once, the device is `unavailable`, commands are still answered, two minutes of failed polls log one warning, and the device is `available` with one recovery record once the wall answers

#### Scenario: A command and an edit while the worker waits on the wall
- **WHEN** the wall holds a worker request and a mode command and a wall edit arrive, under the runtime with its lag check
- **THEN** both are answered at once, the event loop never stalls for 250 ms while the request is held, the edit succeeds while the request is still held, and the lag check stays active

#### Scenario: A store failure
- **WHEN** the module's store refuses its writes so the worker's pass and its failure record both fail, and then takes them again
- **THEN** the device is `degraded` and its wall view `failing` while no worker runs, the worker starts again on its own, a new session takes a Line, and the failed pass and the stopped worker are each logged once, then each recovery once; a store that refuses the module's reads while it publishes is logged once, never fails the module, and the record is published within a second of the store reading again, before the next poll

#### Scenario: Commands while no worker can run
- **WHEN** another instance holds the device's lock and ten commands arrive
- **THEN** each command starts the worker, which ends at once, and one restart waits at a time, so once its wait is the longest the worker starts again once per 30 s, not once per command

#### Scenario: A second take of a lock in the same process
- **WHEN** the device's worker lock, or any other lock file the module opens, is held and a second take of it in the same process is refused
- **THEN** another process is still refused that lock until the first holder lets it go

#### Scenario: The module test kit
- **WHEN** the kit runs the module with a simulated Lines controller, and with one that never answers
- **THEN** every check passes, the offline one included

### Requirement: Notice acknowledgment from the wall

The module SHALL acknowledge a finished turn the wall shows by sending the core `notice-acknowledge` with the consumer ID `nanoleaf`, and report the core's answer as the command's outcome. It SHALL refuse a task it does not show, such as a skipped session from a source not qualified, with `not-found`, without sending a request.

#### Scenario: A shown finished turn
- **WHEN** the wall acknowledges a finished turn it shows
- **THEN** the core gets one `notice-acknowledge` for that session and notice with consumer `nanoleaf`, and the command succeeds with transmitted evidence

#### Scenario: A skipped session
- **WHEN** the wall is asked to acknowledge a finished turn of a session from a source not qualified
- **THEN** it is refused with `not-found`, and the core gets no request

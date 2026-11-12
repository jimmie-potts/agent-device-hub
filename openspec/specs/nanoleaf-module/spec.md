# nanoleaf-module Specification

## Purpose
The Nanoleaf runtime module ([Hub #844](https://github.com/jimmie-potts/agent-device-hub/issues/844)): the TypeScript port of codex-nanoleaf run as one of the B.U.N.N.Y. runtime's shipped modules under ADR 0012, following the core's synced sessions, answering the wall's commands with replies and outcomes, keeping the wall map the editor, and publishing each controller's state.

## Requirements

### Requirement: Nanoleaf module and its configuration

The runtime SHALL ship the Nanoleaf module, `nanoleaf`, the TypeScript port of codex-nanoleaf (Hub #26) wrapped as a module of API `1.3`, created by `createNanoleafModule({transport})` with the Nanoleaf HTTP client as its real transport and a simulated controller under `--simulate`. Its `configure` SHALL take 1 to 8 devices, each with a routing ID, a kind (`lines` or `panels`), a private IPv4 address and the name of its token's secret file, with exactly one Lines device, `wall`; 1 to 128 distinct qualified agent sources; and, optionally, Codex Desktop's metadata files. It SHALL refuse anything else with `invalid-request` and fixed text that repeats no value from the section, and return the device IDs. Its start SHALL open only local resources: its own SQLite file, its private folder, where it writes the port's registry file without any token, and its secret files, whose tokens it keeps in memory only.

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

### Requirement: Integrated Nanoleaf wall editor

The Nanoleaf module SHALL declare a Wall page in the runtime dashboard. It SHALL preserve the existing editor's saved Lines and Panels views, device selection, task and project inspection, keyboard selection, Classic and Project layout, coverage, element assignments and signature swaps, project colors, palette, orientation, Locate, device-only eviction, and Work, Quiet and Free controls. Local assembly, number visibility, filters and selection SHALL remain browser presentation choices. The page SHALL consume the shell's authenticated connection and shared tracked-command behavior without contacting the old wall service, a private store or a physical controller. Opening, selecting, local presentation changes and unsubmitted drafts SHALL send no command and change no saved scene or device. User-controlled text SHALL remain text, never executable markup.

#### Scenario: Opening and selecting the wall
- **WHEN** an authenticated reader opens the declared Wall page and selects an element or changes a local display preference
- **THEN** the saved wall and task details are visible inside the shell, keyboard selection works, and command count, saved scenes and device effects remain unchanged by those interactions

#### Scenario: Existing editor controls
- **WHEN** a controlling user changes a supported map setting, assignment, project color or palette, requests Locate or eviction, or chooses a mode
- **THEN** the action targets the selected device through its existing command family and retains the module's ownership and domain refusals; no other device is targeted

#### Scenario: Device switch and page exit
- **WHEN** a user switches from Lines to a configured Panels device and then leaves the editor
- **THEN** the view and controls use the selected device's saved geometry and supported operations, and the departed editor stops its subscriptions, listeners and animation work without sending a command

### Requirement: Cached editor geometry and qualified navigation

The module SHALL serve a bounded editor-layout content reference for one explicitly selected configured device, using only the saved layout. The response SHALL identify its schema and device and include only the validated connector graph needed to render the Lines; Panels use their saved element outlines. Unknown devices, malformed parameters, missing geometry and unavailable modules SHALL return shared registry errors with fixed text and no filesystem path. The read SHALL NOT discover geometry, write a file or contact a controller. The page SHALL retain a stale or unavailable indication rather than infer an empty current wall, and an explicit read retry SHALL never repeat an edit.

A wall task SHALL optionally carry a Codex Desktop navigation URL only when its qualified source identity is Codex Desktop and its session ID is a plain UUID. That URL SHALL have exactly the form `codex://threads/<UUID>`. Other clients, malformed identities, titles and user text SHALL never become a navigation target. Geometry, page source and wall state SHALL expose no device address, secret, token or animation favorite.

#### Scenario: A cached layout read has no effects
- **WHEN** the page reads a configured Lines device's saved connector geometry
- **THEN** it receives a bounded validated graph for that device without a controller read, store write or scene change

#### Scenario: Missing or invalid layout
- **WHEN** the page selects an unknown device, uses a malformed device query or reads a device with missing saved geometry
- **THEN** the request returns its registry refusal without falling back to another device, exposing a path or discovering geometry; the page provides an honest unavailable state and a read-only retry

#### Scenario: Qualified Desktop navigation
- **WHEN** the wall shows a qualified Codex Desktop task with a UUID session ID, another provider's task, and a task whose title or identity contains a URL-shaped string
- **THEN** only the qualified Desktop UUID produces a local Codex navigation link; the other values remain inert text and no navigation changes unread state by itself

### Requirement: Authorized wall actions and tracked results

A wall mutation SHALL require the runtime's control authority and existing browser request and Origin checks. The editor SHALL show no enabled mutation control to a read-only or disconnected caller, and the runtime SHALL independently refuse an unauthorized command before effects. Explicit actions SHALL use the existing core dispatcher, shared request identity and operation tracker. An accepted reply SHALL remain distinct from completion. Failed, expired and uncertain outcomes SHALL preserve their registry code and evidence, and neither reconnect, refresh, page reload nor an uncertain result SHALL resend an action. Existing machine-edit ownership, device holds and one writer per device SHALL remain authoritative.

#### Scenario: One saved editor change
- **WHEN** a controlling user selects an existing element and explicitly swaps its signature or changes its project
- **THEN** one authenticated wall-edit command is tracked through acceptance and completion and the owner's updated view confirms the edit; refreshing the page sends no second command

#### Scenario: Read-only and Origin refusal
- **WHEN** a read-only caller attempts the same edit, or a browser mutation fails the runtime's existing Origin/request check
- **THEN** the runtime refuses it before the owner changes anything, and the read-only page presents no enabled edit controls

#### Scenario: An uncertain action
- **WHEN** an edit's result is uncertain or the connection ends while its result is pending
- **THEN** the page reports uncertainty or pending evidence and uses the shared command lock and recovery behavior without automatically resending the action

### Requirement: Observed Nanoleaf power in the dashboard

The dashboard's existing Nanoleaf device card SHALL display the device record's observed power, keeping it separate from desired power and preserving unknown or stale evidence. An accepted power command or a transmitted write SHALL NOT by itself establish observed power.

#### Scenario: Simulated on and off observations
- **WHEN** the simulated Nanoleaf reports on and then off through the module's device record
- **THEN** the dashboard card shows the matching observed power after each observation and does not substitute a pending desired value

### Requirement: Frozen music recipes produce bounded deterministic frames

The Nanoleaf module SHALL provide internal version-1 recipes for level glow, bass pulse, three-band spectrum, traveling waves and ambient colors from bounded capture features. Recipes SHALL resolve all defaults and palette values and reject unknown versions, fields and values before rendering. Rendering SHALL use saved geometry and the existing display representation without performing device requests, changing mode or persisting features. This source capability contributes deterministic evidence to #1272; it SHALL NOT expose live music admission without the separate participation policy and worker integration.

#### Scenario: Five effects on both layout kinds
- **WHEN** each effect receives the same valid synthetic measurements, explicit source times and saved Lines or NL22 layout
- **THEN** repeated runs produce identical bounded RGB bytes, paired Lines zones share colors, and only Lines carries the logical-panels flag

#### Scenario: Measurements and silence
- **WHEN** legal capture measurements exceed normalized intensity or contain valid silence with low onset confidence
- **THEN** output remains bounded, silence follows the effect's declared decay, and no beat or BPM is inferred

#### Scenario: Missing geometry and incompatible recipes
- **WHEN** spatial positions are incomplete, a recipe version or field is unsupported, or output exceeds the existing frame or byte bounds
- **THEN** rendering is refused before producing a payload

#### Scenario: Frozen replay
- **WHEN** a fully resolved recipe is serialized and loaded again, or the caller mutates its original recipe and layout after preparation
- **THEN** the supported recipe's interpretation and prepared output remain unchanged

### Requirement: Music input is fresh latest-value data within one binding

Music feature intake SHALL validate the existing profile-2 capture family, producer source, endpoint and generation, retain at most one immutable feature, and accept only increasing sequence and source time. It SHALL judge freshness from the payload's original validity and a receiver-local monotonic deadline, without comparing absolute remote and local monotonic clocks. Duplicate or invalid input SHALL NOT extend freshness. A producer discontinuity marker on a window that follows the previous accepted window in source time, such as after a missed window, SHALL NOT retire the input: the window becomes the latest feature and effect timing continues across the gap from source-time differences. Expiry, source time that runs backwards, clock invalidity or explicit retirement SHALL require a new input instance; no late frame SHALL reactivate the retired instance.

#### Scenario: Fresh envelope cannot refresh old observations
- **WHEN** a duplicate, reverse-sequence or already expired feature arrives in a new envelope
- **THEN** it cannot replace or refresh the latest feature, and the slot is unavailable at its original expiry boundary

#### Scenario: Independent clocks
- **WHEN** source monotonic timestamps have a different origin from receiver monotonic time
- **THEN** freshness still follows payload wall validity and the local receipt deadline, while effect timing follows source-time differences only

#### Scenario: Retirement and discontinuity
- **WHEN** source time reverses (a discontinuity that runs backwards), the receiver monotonic clock moves backward or drifts beyond the shared tolerance, freshness expires, or the caller retires the input
- **THEN** no subsequent frame from that instance is available, even if later messages appear fresh

#### Scenario: Missed window
- **WHEN** a valid bound feature after initialization reports the producer's discontinuity marker and starts at or after the end of the previous accepted window
- **THEN** it becomes the latest fresh feature, the input stays available, and rendering continues with the elapsed source time across the gap, as for an ordinary sequence gap

#### Scenario: Input bursts
- **WHEN** multiple increasing valid features arrive before consumption, including sequence gaps
- **THEN** only the newest feature is available and missing windows produce no replay queue or synthesized beat

#### Scenario: Initial native window
- **WHEN** the first accepted window of a new binding has the native producer's initial discontinuity marker
- **THEN** it initializes fresh effect state without carrying earlier capture history

### Requirement: Explicit reactive recipe drafts
The shared Nanoleaf Wall interface SHALL offer five immutable version-one built-in Music recipes, one per existing reactive effect, with an unsaved palette/intensity draft, editable existing V1 effect-specific motion values and a choice of example Lines or NL22 geometry. Draft edits SHALL remain local. Audio SHALL expose a contextual link to this existing interface. This increment SHALL preserve the separate requirement for custom reactive-preset persistence.

#### Scenario: Five effects are available without light admission
- **WHEN** an operator opens the preview within the Wall page
- **THEN** all five built-ins and their palette/intensity controls are available without starting capture, selecting devices or sending a command

#### Scenario: Draft edits remain unsaved
- **WHEN** the operator edits a draft and reloads the page
- **THEN** the page returns to its built-in default without writing a preset, configuration or operation

#### Scenario: Effect-specific motion edits
- **WHEN** the operator edits bass-pulse half-life from 100 to 2000 ms, chooses one of the eight supported spectrum/traveling-wave directions, or edits a traveling-wave cycle from 400 to 10000 ms
- **THEN** only the local complete V1 recipe changes, within the existing canonical bounds
- **AND** sensitivity and renderer smoothing remain read-only, effect changes use that effect's existing defaults without leaking variant fields, and invalid edits preserve the previous draft

#### Scenario: Explicit preview after a motion edit
- **WHEN** a motion value changes during an earlier preview request
- **THEN** that response cannot replace the newer draft and the operator must explicitly request a new preview
- **AND** the complete edited V1 recipe is used on fixed generated input and example geometry without a capture or device command

### Requirement: Bounded synthetic Music preparation
An explicit authenticated content read SHALL prepare twenty finite RGB samples for fixed example geometry with at most twelve zones, using the existing canonical Music renderer. It SHALL accept either the closed version-one built-in/palette/intensity/example-model request or the separate closed version-one recipe/example-model request. Recipe preparation SHALL resolve supported V1 defaults and retain supplied effect-local values in its complete frozen recipe. The request branches SHALL remain mutually exclusive and reject undeclared fields. Decoded request bytes SHALL be bounded to 2 KiB and encoded response bytes to 16 KiB. The result SHALL identify the frozen recipe, synthetic stimulus, model, offsets and RGB values. Preparation SHALL read no configured layout, device, database, file, capture stream or clock and SHALL create no device work, state update, outbox message or ticket. Errors SHALL use registered meanings and fixed safe text.

#### Scenario: Canonical RGB for every effect and model
- **WHEN** each built-in is explicitly previewed on both supported example models
- **THEN** each sample agrees with the canonical renderer's static RGB output and the response remains within its declared limits

#### Scenario: Unsupported or oversized request
- **WHEN** a request contains an unsupported version, effect, model, field or parameter, or exceeds the request bound
- **THEN** preparation refuses it as invalid-request without external reads or changes

#### Scenario: Cancelled read
- **WHEN** the content request is cancelled before preparation completes
- **THEN** no preview is returned as success and no device or stored state is changed

#### Scenario: Full frozen recipe values
- **WHEN** a saved recipe with supported nondefault effect-local values is explicitly prepared
- **THEN** its complete frozen values and canonical RGB output are preserved without admitting device work or selecting an input

### Requirement: Truthful explicit synthetic preview
The preview SHALL visibly identify generated input, example geometry and an unsaved draft, and SHALL make no live, calibrated, configured-layout or physical-timing claim. Only an explicit Preview action SHALL request preparation. Scrubbing SHALL remain browser-local. Edits, disconnect and unmount SHALL invalidate prior results, and delayed or malformed content SHALL not replace a newer draft. Reconnect or failure SHALL require explicit retry. Keyboard and phone behavior SHALL remain supported, including read-only users.

#### Scenario: Passive page lifecycle
- **WHEN** the page opens, reloads, reconnects or changes its local sample slider
- **THEN** it sends no preview request or command automatically

#### Scenario: Edit during a delayed request
- **WHEN** a requested preview is delayed and the operator edits its draft
- **THEN** the late response is discarded, the prior result stays cleared and another explicit Preview is needed after settlement

#### Scenario: Connection loss or unmount
- **WHEN** a preview read is pending as the page disconnects or unmounts
- **THEN** its later success or failure cannot restore a preview in the retired page lifetime

#### Scenario: Read-only keyboard and phone use
- **WHEN** a read-only operator uses the preview by keyboard at a phone viewport
- **THEN** controls remain reachable, generated-input labels remain clear and the result changes only through explicit preview or local scrubbing

### Requirement: Private reactive preset library

For [#722 AC4](https://github.com/jimmie-potts/agent-device-hub/issues/722), Nanoleaf SHALL own up to 32 immutable named reactive presets in its existing private store. Each preset SHALL carry the versioned document `nanoleaf-reactive-preset/2.0`, a stable neutral identity, a name of 1–80 Unicode characters without controls, and one fully explicit frozen `MusicRecipeV1`. Saving SHALL accept only the supported closed V1 effect fields and bounds. Each stored document SHALL be at most 2 KiB, and the complete serialized catalog SHALL be at most 128 KiB. Catalog reads SHALL retain corrupt bytes and refuse invalid data rather than repair or hide them. Neither raw audio nor core capture/calibration settings SHALL enter the recipe.

#### Scenario: Explicit save and restart
- **WHEN** the operator explicitly saves a valid named recipe with the current catalog revision
- **THEN** Nanoleaf commits that immutable recipe, the new catalog and its observed metadata outcome atomically
- **AND** reload and restart preserve every earlier recipe without changing a device, journal, configuration revision, last device outcome or worker schedule

#### Scenario: Unsupported or stale save
- **WHEN** a request contains an unsupported version, effect, parameter or bound, a duplicate identity, an expired request or a stale catalog revision
- **THEN** the owner refuses before effects with the applicable registry code and preserves the library

#### Scenario: Capacity and store failure
- **WHEN** a save reaches the count, document, catalog or physical storage limit, or catalog/outcome insertion fails
- **THEN** it refuses without a partial save or loss of earlier presets
- **AND** publication failure after commit retains the original state and outcome for outbox publication without command replay

#### Scenario: Existing private database
- **WHEN** the new source opens a previous-schema database containing static favorites and decorative shows
- **THEN** initialization adds an empty reactive library without changing those existing rows and repeated initialization is harmless

### Requirement: Reactive preset drafts in the existing preview

The existing Wall Music effect preview SHALL show the owner-synced library through `nanoleaf-reactive-presets/2.0` at target `reactive-presets`. Read-only users SHALL be able to inspect and load a saved recipe into a local draft. Only an explicit control-authorized Save new preset SHALL send `nanoleaf-reactive-preset-save/2.0`, using a current catalog revision and the existing tracked command behavior. Failed or uncertain saves SHALL retain the draft; uncertain work SHALL keep the shared attempt locked. Reload, reconnection and catalog refresh SHALL never automatically save, resend or replace a local draft. The view SHALL retain its draft and any stale catalog while disconnected, then acquire a fresh owner snapshot after reconnect. Save SHALL remain disabled until that snapshot and the operation copy are current. Local load SHALL preserve all effect-local V1 parameters and allow the effect-specific motion edits above and show sensitivity and renderer smoothing as noneditable values truthfully.

#### Scenario: Save, load and preview
- **WHEN** an operator edits palette/intensity, saves a named preset, reloads and explicitly loads it
- **THEN** the exact frozen recipe becomes the local draft and an explicit Preview uses that complete recipe on fixed generated input and example geometry
- **AND** opening, loading and saving never starts capture, targets lights or applies a device effect

#### Scenario: Read-only or stale library
- **WHEN** the user has read-only access or the catalog, connection or operation copy is stale
- **THEN** save is disabled while saved data and the local draft remain distinguishable
- **AND** neither a delayed initial sync result nor a stale preview response makes the view current

#### Scenario: Disconnect during catalog refresh
- **WHEN** a library refresh completes during disconnection and the connection returns
- **THEN** the view retains its draft and acquires a fresh owner snapshot without resending a save
- **AND** Save remains disabled until the replacement snapshot completes

#### Scenario: Full recipe request compatibility
- **WHEN** a caller supplies either the existing closed built-in preview request or the closed full-recipe request
- **THEN** the canonical renderer prepares only the bounded synthetic result, preserving existing built-in behavior
- **AND** every supported maximal full-recipe request fits the gateway's unchanged 512-character query value limit

#### Scenario: Save a motion-tuned preset
- **WHEN** the operator loads a saved V1 recipe, edits its supported motion values and explicitly saves a new named preset
- **THEN** the new preset and its generated preview retain the complete edited recipe, including unchanged sensitivity and smoothing
- **AND** earlier saved presets remain byte-for-byte unchanged across reload while no source input, calibration, admission or lighting operation starts

### Requirement: Shared versioned response interpretation

A single browser-safe response implementation SHALL apply gate, sensitivity and band emphasis before clamping and one source-time exponential smoother. Numerical preview and explicit renderer V2 SHALL share it. Renderer V1 SHALL retain its existing interpretation and defaults exactly. V2 SHALL reject duplicate legacy tuning fields. No response computation SHALL admit device work or claim physical timing.

#### Scenario: Preview and renderer agree
- **WHEN** preview and V2 receive identical valid samples and response settings on synthetic Lines or NL22 layouts
- **THEN** the normalized levels agree, only one smoothing step applies and rendered output obeys existing bounds

#### Scenario: Gate closure and expiry
- **WHEN** valid quiet samples close an enabled gate
- **THEN** targets become zero with the documented smoothing decay; stale input clears preview immediately instead of continuing a live-looking decay

#### Scenario: Preserved V1 and explicit V2
- **WHEN** existing V1 recipes replay or a V2 recipe supplies legacy sensitivity/smoothing fields
- **THEN** V1 output remains identical and the conflicting V2 recipe is refused

#### Scenario: Rejected output preserves V1 state
- **WHEN** an output exceeds the existing payload capacity
- **THEN** the rejected window cannot change the response used by the next accepted V1 output

### Requirement: Live Music sessions on the Lines and the NL22 through the existing writer

The Nanoleaf module SHALL accept Music lighting work only from the core. It SHALL admit a Start on the Lines or on the NL22 Light Panels, each as its own light, only in Free with no pending mode, no hold, power not switched off by the hub or at the light, no other live session or waiting content on that light, an existing frozen preset that the renderer accepts with that light's saved layout, a saved layout whose every zone that light's stream can address, and a readable current selection and brightness as the base. The base SHALL be a scene saved on the light, a plain colour read from the light's state, or any other selection, which nothing can select again; no scene SHALL be guessed. A refused Start SHALL make no device write, SHALL NOT change mode, and SHALL name the selection it read without a scene name. An admitted session SHALL check, just before streaming, that the light still reports the base's selection and, for a colour base, its colour, and SHALL otherwise end as manual with no write. It SHALL enter the light's external-control streaming mode with the Start's journaled write: version 2 with logical panels on the Lines, and version 1 on the NL22. It SHALL then send each frame as one UDP datagram to the device's configured address, never to an address a reply names. Lines frames go to the fixed version 2 port with two-byte zone IDs. NL22 frames go to the port the entry's answer names, only from 1024 to 65535, with one-byte panel IDs, a frame count of 1 per panel and a one-byte count. An NL22 entry answer that names no UDP port SHALL fail the Start as transmitted with `unsupported-capability`, with no frame, no hold and no further write. It SHALL render only the newest fresh Music feature for its capture binding inside the device's locked worker, with at most one device request or datagram in flight, at most one frame per 100 ms and no catch-up. While playing, its device HTTP requests SHALL be limited to the external-change check. Each light's session, worker, journal, writes and record SHALL be its own.

#### Scenario: Admission outside the first trial
- **WHEN** work asks to start in Work or Quiet, while held, on a light that is off or reports no readable selection or brightness, with an unknown preset or from a source other than the core
- **THEN** the module refuses before any device write or mode change, and a refusal after the base read names the selection the light reported

#### Scenario: NL22 layout its stream cannot address
- **WHEN** a Start on the NL22 finds a saved layout with a panel ID above 255 or more than 255 panels
- **THEN** the module refuses it `unsupported-capability` before any device request, and nothing is truncated or sent

#### Scenario: Start over any selection
- **WHEN** a Start finds the light on in Free showing a saved scene, a plain colour, an unsaved scene, an effect or the streaming frames an earlier session left
- **THEN** the module admits it over that base, keeping the scene's name, the colour's hue and saturation or colour temperature, or the selection that cannot be selected again, with the brightness

#### Scenario: Paced latest-value rendering
- **WHEN** features arrive faster than ten per second, repeat a sequence, are stale or belong to another generation
- **THEN** only the newest fresh feature is rendered, duplicates and stale or foreign features produce no datagram, and valid silence keeps the session playing

#### Scenario: Streaming entry and frames
- **WHEN** an admitted Start's first fresh feature renders while the light still reports the base's selection
- **THEN** the Start's journaled write puts the light in external-control mode, each later frame is one datagram of the zones' colors, and no HTTP display write or per-frame read follows

#### Scenario: NL22 version 1 stream
- **WHEN** an admitted NL22 Start's first fresh feature renders and the light answers the version 1 entry with a streaming port
- **THEN** each frame goes to that port at the configured address, carrying every triangle by its one-byte panel ID in the saved layout's order with one frame, white 0 and a 100 ms transition, at most one per 100 ms

#### Scenario: NL22 entry answer without a port
- **WHEN** the NL22 answers the version 1 entry with no body, no port, a port outside 1024 to 65535 or a protocol other than UDP
- **THEN** the Start fails as transmitted with `unsupported-capability`, the session ends as a device failure with restoration `none`, no frame, hold or further write follows, nothing is sent to a privileged or well-known port, and the light may stay in external control on its last presentation until it times out or a scene is chosen

#### Scenario: All five effect families on both lights
- **WHEN** a saved level glow, bass pulse, spectrum, traveling wave or ambient preset starts on the Lines or on the NL22
- **THEN** the session is admitted and streams frames over every zone of that light's saved layout, each element's zones sharing a colour, uniform effects lighting every element alike and spatial effects varying across the layout

#### Scenario: Independent lights
- **WHEN** the Lines and the NL22 each play a session, and one of them ends by Stop, an alert, a manual change or a device failure
- **THEN** only that light's session ends and only that light is written or held; the other light's session, writes, hold and record are unchanged unless its own ending applies

#### Scenario: Colour changed before the streaming entry
- **WHEN** a session admitted over a plain colour is about to enter streaming and the light reports another colour or colour mode while still on `*Solid*`
- **THEN** the session ends as manual with restoration `none`, with no streaming entry and no colour write; only a colour base reads the light's state before the entry, and a colour picked between that read and the entry write is replaced by the entry

#### Scenario: Bounded request rate
- **WHEN** a session plays for several seconds with fresh features every 100 ms
- **THEN** its device HTTP reads stay at the once-per-second external check, and its datagrams at no more than one per 100 ms

### Requirement: Interruption, Stop and current-base return

While a session plays, the module SHALL read the light's selection at least once per second and SHALL require the selection that light reports while it streams, the base brightness and power on. That selection SHALL be the light's own: `*ExtControl*` on the Lines and `*Dynamic*` on the NL22 Light Panels, as each installed light reported (#1598, #1777). Any other selection SHALL be a manual change. A live session SHALL end on an explicit Stop, an alert, a newer manual or external change, loss of fresh input or a failed device write or datagram send, and its record SHALL name that reason. Stop, alert and source-loss endings SHALL put a saved-scene base back by name and a colour base back by its hue and saturation or colour temperature, after the base brightness. They SHALL do so only while the device still shows its streaming selection, a scene base is still listed, brightness is unchanged, no newer change exists before and after each write, and the light is on. Otherwise restoration is skipped, or uncertain when a write's answer was lost. Over a base that cannot be selected again, those endings SHALL make no restoration read or write, SHALL leave the last frame and SHALL report restoration `none`. Manual, external and device endings SHALL make no restoration write. A module restart SHALL end a live session as `restart` without a device write or replay. The module SHALL add no device request, write or connection to tell streaming from an unsaved dynamic effect on the NL22. An unsaved dynamic effect picked in the app during an NL22 session is therefore not a recognised manual change, and the module SHALL document that limit (#1777).

#### Scenario: Newer manual change wins
- **WHEN** a scene, brightness, power, mode or moment request arrives during a session, or during its restoration
- **THEN** the session ends as manual and no music or restoration write follows the newer change

#### Scenario: App scene during streaming
- **WHEN** a scene is chosen in the Nanoleaf app at any point after streaming began, including while one of the session's own requests is in flight
- **THEN** later datagrams cannot replace it, the next external check ends the session as manual with no restoration, and the chosen scene stays

#### Scenario: NL22 session plays on its own streaming selection
- **WHEN** an NL22 session streams and the Panels report `*Dynamic*` with the base brightness and power on at each once-per-second check
- **THEN** the session keeps playing past those checks, its record keeps `*Dynamic*` as the light's selection, and a later Stop, alert or source loss puts a scene or colour base back by the guarded restoration

#### Scenario: App colour or static selection on the NL22
- **WHEN** a plain colour or an unsaved static selection is picked in the Nanoleaf app during an NL22 session, so the Panels report `*Solid*` or `*Static*`
- **THEN** the next external check ends the session as manual with restoration `none`, no datagram follows the ending, nothing is written, and the app's choice stays

#### Scenario: Unsaved dynamic effect on the NL22 is not seen
- **WHEN** an unsaved dynamic effect is picked in the Nanoleaf app during an NL22 session, so the Panels report `*Dynamic*` as they do while streaming
- **THEN** the session is not ended as manual, its datagrams continue and are expected to be ignored by a light that left streaming, and a later Stop, alert or source loss puts a scene or colour base back over the effect when brightness is unchanged and the light is on; the README, this specification and the Audio card state this limit

#### Scenario: Lines streaming selection unchanged
- **WHEN** a Lines session streams and the Lines report `*ExtControl*`, or report `*Dynamic*` after an effect picked in the app
- **THEN** `*ExtControl*` keeps the session playing and `*Dynamic*` ends it as manual with no write, as before

#### Scenario: Alert and source loss
- **WHEN** an alert indication appears, or the input expires, is retired or overflows
- **THEN** the session ends with that reason, the guarded base restoration runs for a scene or colour base, and the microphone is never selected

#### Scenario: Colour base returns
- **WHEN** a session started over a plain colour ends by Stop, an alert or source loss while nothing newer took over
- **THEN** the module writes the base brightness, then the colour in one write, and reports `restored`; a Stop completes as transmitted

#### Scenario: Unnamed base keeps the last frame
- **WHEN** a session started over a selection that cannot be selected again ends by Stop, an alert or source loss
- **THEN** no restoration read or write follows, the light keeps the last frame, the ending reports restoration `none`, and a Stop completes as observed

#### Scenario: Leftover NL22 stream at the next Start
- **WHEN** a Start on the NL22 reads `*Dynamic*` because an earlier session's last frame is still streaming
- **THEN** the base is an unnamed selection with nothing to restore, the record's placeholder is `*Dynamic*`, the session plays past its checks, and its Stop, alert or source-loss ending writes nothing and reports restoration `none`

#### Scenario: A missed window is not source loss
- **WHEN** one capture window is missing and the next carries the producer's discontinuity marker while features stay fresh
- **THEN** the session keeps playing, and it ends as source loss only once no fresh feature remains

#### Scenario: Restart
- **WHEN** the module starts with a session still starting or playing
- **THEN** that session ends as restart with no device write

### Requirement: The light's last read selection in its record

The Nanoleaf module's `nanoleaf-wall` record SHALL show each light's last read selection: whether it is a scene saved on the light, a saved scene's opaque scene ID, the light's own placeholder name when it is one, what a live Music ending over it would put back, and when it was read. It SHALL also show what the latest Music session's ending puts back, with that session's generation. The selection SHALL come only from reads a Start and a playing session already make, with no added device request. No record SHALL hold a scene name. An unchanged selection SHALL keep its read time for at most a minute.

#### Scenario: Selection from existing reads
- **WHEN** a Start reads the light, or a playing session runs its once-per-second check
- **THEN** the light's record shows that selection and its read time, and the session's device requests are unchanged

#### Scenario: No scene names
- **WHEN** the light shows a saved scene, a placeholder or an unsaved scene
- **THEN** the record shows the scene's opaque ID, the placeholder's own name or only that it is unsaved, and never a scene's name

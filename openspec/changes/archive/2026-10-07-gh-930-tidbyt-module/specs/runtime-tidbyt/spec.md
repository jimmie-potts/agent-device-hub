## ADDED Requirements

### Requirement: One Tidbyt module with private cloud configuration

The runtime SHALL host one module, `tidbyt` (module API 1.1), that writes the Tidbyt's status and now-playing tiles through Tidbyt's cloud. Its `configure` SHALL accept a section with an `id`, a routing ID; a `cloudDeviceId` of 1 to 128 letters, digits, underscores or hyphens; an optional `statusInstallation` of letters and digits, `agentdevicehub` by default; an optional `nowPlaying` of `{playback, installation?}`, the routing ID of the `playback` record to show and the card's own installation, `nowplaying` by default and different from the status tile's; and a `secrets` member that names the API key's file as `token`. Any other section SHALL be refused with `invalid-request` and a fixed detail that repeats no value. The module SHALL name `id` as its one device and read the key once, at start. The cloud's device ID and the key SHALL NOT appear in any message, log record, span, error body or health entry.

#### Scenario: A valid section
- **WHEN** the section names `tidbyt`, a cloud device, both installations, the `living-room` playback record and the key's file
- **THEN** the runtime accepts it and the module's device is `tidbyt`; without `statusInstallation` or `nowPlaying.installation` the runner's defaults apply

#### Scenario: Sections the module refuses
- **WHEN** the section adds a member, gives an ID with capitals, a cloud device with a slash, an installation with a hyphen, a now-playing installation equal to the status one or a playback ID that is not a routing ID, or names no `secrets.token`
- **THEN** the module is refused with `invalid-request`, and the detail repeats no value

#### Scenario: No secret anywhere
- **WHEN** the module shows both tiles on the simulated cloud
- **THEN** no published message, log record or span holds the API key or the cloud's device ID, and the simulated cloud received the key from the secret file

### Requirement: Conversion of the runner's configuration

The module SHALL provide `convertTidbytRunner(runner, credentials)`, which the cutover's installer runs on the old runner's parsed `tidbyt-status.json` and the text of the credentials file it names. It SHALL check both as the runner did and return the module's section, with device ID `tidbyt`, the cloud's device ID and both installation IDs kept, so no tile is left behind, and the API key separately for the installer to write into a private secret file. The runner's now-playing `sourceId` SHALL become the playback record's routing ID by the playback module's rule, and the result SHALL name a renamed one. The runner's Hub URL, owner and Hub token files SHALL NOT be carried. A configuration or credentials file the runner would refuse SHALL be refused with fixed text that repeats no credential.

#### Scenario: Installation IDs kept
- **WHEN** the runner's credentials name installation `agentstatus` and its now-playing block names `nowplaying2` for source `living-room`
- **THEN** the section keeps `agentstatus` and `nowplaying2` and the cloud's device ID, the key comes back apart from the section, and the runtime admits the section once the installer adds the key's file

#### Scenario: Defaults and a renamed source
- **WHEN** the credentials name no installation and the now-playing source is `HT-A9`
- **THEN** the section uses `agentdevicehub` and `nowplaying`, the playback ID is `ht-a9`, the result names `HT-A9`, and no Hub token file or URL is carried

#### Scenario: A runner configuration the runner refused
- **WHEN** the configuration lacks a member, adds one, or its credentials file lacks the key, repeats a key, has an unknown key or a bad installation ID
- **THEN** the conversion refuses it with `invalid-request`, quoting no credential

### Requirement: Status tile from the synced sessions

The module SHALL keep a synced copy of the core's `session` records and draw the status tile from it with the runner's layout: up to four rows of root sessions, `ASK`, `RUN` and `DONE` in that order and newest evidence first, `+N MORE` past four, labels by the owner-resolved label, title, project display name, legacy project ID, then the 1.x neutral hashed ID. Any consumer's acknowledgment SHALL retire `DONE`, and read evidence SHALL NOT. A session whose freshness is uncertain SHALL be dimmed with a `?` marker. While the copy has not synced, or after a later sync failed, every row SHALL be dimmed, or the tile SHALL read `FEED ?`, and the tile SHALL NOT be removed. When the copy shows nothing to display, the tile SHALL leave the rotation.

#### Scenario: Sessions shown
- **WHEN** the copy holds a session asking, one working, one with an unacknowledged finished turn, an idle one and a child
- **THEN** the tile shows ASK, RUN and DONE rows in that order, without the idle session or the child, and its frame equals the frame the copy calls for

#### Scenario: A lost copy
- **WHEN** the copy stops following the core after a sync it refuses
- **THEN** the next push dims every row, the module logs one feed failure, and the tile is never removed while the copy is lost

#### Scenario: No sync at all
- **WHEN** the core refuses every sync of the sessions for 30 s after the start, and comes up later
- **THEN** the tile writes nothing for those 30 s, then reads `FEED ?`, the module syncs again after its backoff and logs one recovery, and the next push, after the 15-second gate, shows the sessions

### Requirement: Now-playing tile from the playback record

With `nowPlaying` configured, the module SHALL keep a synced copy of the playback module's `playback` records and draw the configured record as the runner's card: a green play triangle or amber pause bars, the title and the artist, for a `playing` or `paused` record that is `available` or `stale`. A `stale` record SHALL dim the card with a `?` marker. An `unavailable` record, unknown playback, a stopped track or another input SHALL remove the card. Freshness SHALL come from the record's `availability`, never from the age of `observedAtMs`. While the copy does not follow the playback module, the last card SHALL be dimmed, and it SHALL be removed once the copy has not followed for 30 s. Within 30 s of the module's start, the tile SHALL write nothing while its copy has not synced, or while the configured record is missing or `unavailable`, which the playback module publishes at each start before its first read; a record still `unavailable` after that window SHALL remove the card.

#### Scenario: Play, pause, stale and the end of playback
- **WHEN** the record plays, pauses, turns stale, then turns unavailable
- **THEN** the tile shows the playing card, the paused card and the dimmed card, each after its gate, then leaves the rotation once, and missing playback never shows as paused

#### Scenario: A playback module that starts late
- **WHEN** a leftover card is in the rotation and the playback module starts serving 5 s after the Tidbyt module
- **THEN** the tile removes nothing and shows the card once its copy syncs; with no playback module at all, the leftover card is removed after 30 s

#### Scenario: The playback module's start-time record
- **WHEN** the runtime restarts while a song plays, the playback module first serves its record `unavailable` with unknown playback, then the same song playing
- **THEN** the card is neither removed nor pushed again; from a fresh start with a leftover card and a record that stays `unavailable`, nothing is written for 30 s, then the card is removed

#### Scenario: A lost playback copy
- **WHEN** the playback copy stops following its owner while a song plays
- **THEN** the card is dimmed, and removed 30 s after the loss

### Requirement: One writer, the 15-second gate and no replay

Every cloud call SHALL go through one queue, one call at a time, in order, behind a lease on the cloud device in the module's private folder. Each tile SHALL push only when its frame changes, at most once every 15 s measured from the moment each request goes out, coalescing changes into one push of the latest state, and SHALL push an unchanged frame again after 10 minutes. A tile with nothing to show SHALL be removed; when its presence is unknown, the tile SHALL read the installation list first and delete only an installation that is there. A write that failed or may have taken effect SHALL NOT be sent again: a later write SHALL be a fresh one for the current state, after a wait that starts at 15 s and doubles up to 10 minutes, and an uncertain push SHALL make the installation's presence unknown. A 401, a 403 or the cloud's "no UID" 500 SHALL hold every later call without a request until the runtime restarts, and a 429 SHALL hold later calls for its `Retry-After`. A module that cannot take the lease SHALL write nothing and report the Tidbyt `unavailable`.

#### Scenario: A burst inside the gate
- **WHEN** three session changes arrive within 15 s of a push
- **THEN** nothing more is pushed inside the gate, and one push 15 s after the first shows the latest state; nothing follows without a change

#### Scenario: The refresh
- **WHEN** a frame stays unchanged
- **THEN** it is pushed again only after 10 minutes

#### Scenario: Idle removal
- **WHEN** an idle start finds leftover tiles in the listing, or the last session's finished turn is acknowledged
- **THEN** each tile is deleted once, after a listing when its presence was unknown and without one when it was present, and an absent tile is never deleted

#### Scenario: Failed and uncertain writes
- **WHEN** the cloud refuses a push, keeps refusing removals, or answers a push with a server error
- **THEN** the refused push is followed by a fresh one 15 s later; the removals come at 15, 45, 105, 225 and 465 s and then every 10 minutes, with one record for the run; and after the uncertain push an idle tile reads the list before deleting

#### Scenario: Holds
- **WHEN** the cloud refuses the key, or answers 429 with `Retry-After: 30`
- **THEN** no further request goes out under the authentication hold and one record names it; under the rate limit the next push waits 30 s

#### Scenario: A second writer
- **WHEN** a second instance of the module starts on the same state directory while the first holds the lease
- **THEN** the second logs the refused lease, reaches no cloud and reports the Tidbyt `unavailable`

### Requirement: Start, restart, stop and rendering

Start SHALL open only the database, the private folder with the lease, the key's file and the bus, sync both copies and return; it SHALL NOT wait on the cloud (policy A). Within 30 s of the module's start, a tile SHALL write nothing until its copy has first synced, so a start or a restart writes nothing before the shown state is known; the status tile SHALL read `FEED ?` only when its copy has not synced by then. What each tile last sent, when, and whether its installation is present SHALL survive a restart in the module's database, so a restart pushes nothing while the tile stands, and the gate SHALL hold across it. Before a push or a removal goes out, the tile SHALL store it as uncertain, with the installation's presence unknown, so a stop or a crash before its answer makes the next start read the list before it trusts the presence. The gate and the refresh SHALL run on the runtime's wall clock, and a stored time in the future SHALL count as now, so a clock set back delays a tile's next write by at most its own wait. Frames SHALL render in a worker thread through the runtime's worker call; a stop SHALL end a render in progress, and nothing SHALL be pushed after the stop. A failed render SHALL send nothing, SHALL be no evidence about the device and SHALL be tried again after the wait above.

#### Scenario: A slow core at start
- **WHEN** the core's first sync is held
- **THEN** the module writes and removes nothing until it is answered, then pushes the sessions

#### Scenario: A core that serves a moment after a restart
- **WHEN** the runtime restarts while the status tile shows a session, and the core refuses the module's syncs for 3 s
- **THEN** the tile reads neither `FEED ?` nor anything else: the rows it shows are unchanged, so nothing is pushed

#### Scenario: A stop while a push is in flight
- **WHEN** a push reaches the cloud and its answer is lost, the module stops, the session turns idle, and the module starts again
- **THEN** the start reads the installation list and removes the tile

#### Scenario: A wall clock set back
- **WHEN** the wall clock is set back ten minutes just after a push, and a session changes
- **THEN** the change is pushed 15 s later, and the next refresh 10 minutes after that

#### Scenario: A restart
- **WHEN** the runtime restarts 5 s after a push, and a session changes after the restart
- **THEN** the restart pushes nothing, the change is pushed 15 s after the push before the restart, and the device record's revision keeps rising

#### Scenario: A render cancelled by the stop
- **WHEN** the module stops while its render worker never answers
- **THEN** the stop ends the worker, nothing is pushed, and no failure is logged; a worker that fails is logged once and sends nothing

### Requirement: Device record, commands and diagnostics

The module SHALL serve `device` through sync and publish the Tidbyt's `device/2.0` record of kind `tidbyt` with every capability unsupported, desired, observed, last outcome and external control `unknown`, and `pending` 0. Its `availability` SHALL be `unknown` until the cloud first answers, `available` once it accepted a write or listed the installations, `degraded` while it rate limits, refuses a request or answers with a server error, and `unavailable` while it does not answer or refuses the key or the device. `lastTransmission` SHALL record each push or removal the cloud accepted. A new revision SHALL be published only when availability or the last transmission changes, and its revision SHALL rise across restarts. Every general command to the Tidbyt SHALL be refused with `unsupported-capability`, and one whose subject is another device with `invalid-request`. Sync SHALL serve the record as last committed, never a revision the database refused. A cloud that does not answer SHALL log one `device.unavailable` warning per outage, later failures as DEBUG summaries, and one `device.available` on recovery; a tile's refused calls and failed renders SHALL log one `operation.failed` per run of failures, and another when the cloud refuses the key or the device inside that run; a database that refuses commits SHALL log one `operation.failed` and one `operation.completed` per run, and the record SHALL be published again once a commit works; a fault of the module's own in a tile's evaluation SHALL log one `operation.failed` at ERROR per run of faults and one `operation.completed` when an evaluation completes again. Each cloud call that goes out SHALL have a `bunny.device.call` span, a call a hold keeps back SHALL have none, and no trace context SHALL reach the cloud.

#### Scenario: A cloud that does not answer at start
- **WHEN** the module starts while the simulated cloud never answers, and the cloud answers again ten minutes later
- **THEN** start finishes at once, the Tidbyt turns `unavailable` once the call's deadline passes, the module keeps trying with backoff and logs one warning and DEBUG summaries, and once the cloud answers it pushes, turns `available` and logs one recovery

#### Scenario: Nothing changes
- **WHEN** five minutes pass after a push with nothing new
- **THEN** no new device revision is published, every capability is unsupported, a power command is refused `unsupported-capability`, and a reader that names `bunny/modules/tidbyt` syncs the one record

#### Scenario: A database that refuses commits
- **WHEN** another connection holds the module's database while a push changes the record
- **THEN** one `operation.failed` names `storage`, no record is published that did not commit, a reader's sync gets the record last committed, and once the database works the record is published and one `operation.completed` follows

#### Scenario: A fault of the module's own
- **WHEN** the core sends a session record the status view cannot read, for five minutes, and then a valid one
- **THEN** one `operation.failed` at ERROR names `internal`, and one `operation.completed` follows the first evaluation that completes

#### Scenario: A refused key inside a run of failures
- **WHEN** the cloud refuses a push as a bad request, then the next one for its key, and the module stays held for ten minutes
- **THEN** both refusals are logged, no further request goes out, and only the two requests that went out have device call spans

### Requirement: Golden frames decoded independently

The module's golden frames SHALL be byte-for-byte copies of the controller's, and each SHALL render from the module's views to its committed bytes. An independent libwebp decoder in Node (`sharp`) SHALL decode each golden to its recorded frame, pixel by pixel, with every pixel opaque. A corrupted golden SHALL fail the check.

#### Scenario: The goldens decode
- **WHEN** the golden test runs
- **THEN** each of the seven goldens decodes to its recorded 64x32 frame, and the status and now-playing goldens drawn from 2.0 records equal the runner's bytes

#### Scenario: A corrupted golden
- **WHEN** one bit of a golden's pixel data is flipped, a golden is truncated, or an expected frame is changed
- **THEN** the check reports the differing pixel or the failed decode

### Requirement: Simulated cloud

The module SHALL provide `SimulatedCloud`, the transport tests and disposable runs give it, which answers the background push, the removal and the installation list with the cloud's status codes, takes only its key and device, keeps its installations across runtime restarts and shows each installation's last frame as text rows. A test or run SHALL be able to take it offline, refuse connections, or answer the next calls with a status of its choice. The runtime's `--simulate` SHALL build the module with it, and the shipped factory SHALL give a simulated section that names the key's secret.

#### Scenario: Calls answered as the cloud does
- **WHEN** a connection pushes, lists and removes on the simulated cloud, with the right key, another key and another device
- **THEN** it shows what each installation was sent, lists and removes it, answers 401 for the other key and 404 for the other device, and records each call

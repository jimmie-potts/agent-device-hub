## ADDED Requirements

### Requirement: Private bounded art staging

The Tronbyt-backed module SHALL accept core-issued `art-stage/2.0` for exact 64×32 PNG stills and GIF animations up to 160 KiB. It SHALL accept at most 20 frames, animated delays of 100–800 ms and at most 16 s per loop, validating actual frames and timing against declared metadata. It SHALL encode every composited frame without dropping duplicate frames, as lossless WebP up to 160 KiB, with transparency flattened onto black. Unsupported profiles, malformed data, wrong hashes, metadata mismatches and oversized input or output SHALL be refused before any server write. Staging SHALL have no display effect and SHALL complete only after its private copy and outcome are committed. Playback thumbnail limits SHALL remain unchanged.

The module SHALL keep up to 64 valid copies without evicting a valid one to make space. A composition ID with the same bytes SHALL reuse the copy and renew its lifetime; different bytes under a held ID SHALL be refused. Expired copies SHALL not be admitted for new use. A stage or selection duplicate SHALL return its existing result without a second mutation, including after restart. A stop or failed commit SHALL not produce a successful preparation receipt.

#### Scenario: Still and animation qualification
- **WHEN** accepted fixtures include a still, distinct animation frames, duplicate frames, transparency and disposal changes
- **THEN** independent decoding of the stored WebP confirms every composited pixel, frame count and delay, and staging causes no server push

#### Scenario: Refused media and full storage
- **WHEN** a stage exceeds its bounds, disagrees with its bytes, is malformed, conflicts with an immutable copy or has no free slot
- **THEN** it is refused truthfully without a server effect or deletion of another valid copy

#### Scenario: Private reopen and preview
- **WHEN** the module restarts after staging and an authenticated reader opens the copy's content reference
- **THEN** the exact prepared WebP and declared profile remain inspectable, while private server addresses, native installation IDs and credentials are absent from shared metadata

### Requirement: Ambient art in the background rotation

The Tronbyt-backed module SHALL accept core-issued `art-ambient-set/2.0` to select a valid staged composition or none. Selection SHALL be durable and report observed local state separately from server transmission. The ambient tile SHALL use the existing device queue and cadence and SHALL always push in the background, even in interrupt mode. Attention and stale session evidence SHALL suppress the tile; module pins or an unknown or active server pin SHALL prevent ambient mutations that could replace pinned content. Selection SHALL remain saved while suppressed. Once eligible, only the latest selection SHALL be presented; stale queued work SHALL not resurrect previous art. Expired selection SHALL cease presentation through the same queue. Failed or uncertain writes/removals SHALL preserve their actual presence and effect evidence and existing holds; no receipt SHALL claim optical display observation.

#### Scenario: Background art under interrupt mode
- **WHEN** ambient art is selected while the display's mode is interrupt
- **THEN** its push remains background, neither creates a pin nor interrupts another tile, and selection success is distinct from transmission

#### Scenario: Attention, pins and superseded work
- **WHEN** attention or a manual pin arrives while ambient work waits, and selection changes or clears
- **THEN** the old push does not run later, current pin ownership is preserved, and the latest eligible state is applied through the queue

#### Scenario: Uncertain removal and restart
- **WHEN** attention suppresses ambient art but removal is held or loses its answer, then the runtime restarts
- **THEN** the saved selection remains separate from uncertain installation presence, the current suppression remains effective and only the latest eligible state can be written

## MODIFIED Requirements

### Requirement: Device record, commands and diagnostics

The module SHALL serve `device` through sync and publish the Tidbyt's record of kind `tidbyt`, using `device/2.2` when exact art is supported and `device/2.0` otherwise. On the cloud backend every capability SHALL be unsupported, desired, observed, last outcome and external control `unknown`, and `pending` 0, and "Tronbyt display controls" states what a server's record declares. Availability follows the selected backend's answers as this requirement states them for the cloud. Its `availability` SHALL be `unknown` until the cloud first answers, `available` once it accepted a write or listed the installations, `degraded` while it rate limits, refuses a request or answers with a server error, and `unavailable` while it does not answer or refuses the key or the device. `lastTransmission` SHALL record each push or removal the cloud accepted. A new revision SHALL be published only when availability or the last transmission changes, and its revision SHALL rise across restarts. On the cloud backend every general command to the Tidbyt SHALL be refused with `unsupported-capability`; one whose subject is another device never reaches the module, since the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). Sync SHALL serve the record as last committed, never a revision the database refused. A cloud that does not answer SHALL log one `device.unavailable` warning per outage, later failures as DEBUG summaries, and one `device.available` on recovery; a tile's refused calls and failed renders SHALL log one `operation.failed` per run of failures, and another when the cloud refuses the key or the device inside that run; a database that refuses commits SHALL log one `operation.failed` and one `operation.completed` per run, and the record SHALL be published again once a commit works; a fault of the module's own in a tile's evaluation SHALL log one `operation.failed` at ERROR per run of faults and one `operation.completed` when an evaluation completes again. Each cloud call that goes out SHALL have a `bunny.device.call` span, a call a hold keeps back SHALL have none, and no trace context SHALL reach the cloud.

#### Scenario: A cloud that does not answer at start
- **WHEN** the module starts while the simulated cloud never answers, and the cloud answers again ten minutes later
- **THEN** start finishes at once, the Tidbyt turns `unavailable` once the call's deadline passes, the module keeps trying with backoff and logs one warning and DEBUG summaries, and once the cloud answers it pushes, turns `available` and logs one recovery

#### Scenario: Nothing changes
- **WHEN** five minutes pass after a push with nothing new
- **THEN** no new device revision is published, every capability is unsupported, a power command is refused `unsupported-capability`, and a reader that names `bunny/modules/tidbyt` syncs the one record

#### Scenario: A database that refuses commits
- **WHEN** the module's database refuses its writes while a push changes the record
- **THEN** one `operation.failed` names `storage`, no record is published that did not commit, a reader's sync gets the record last committed, and once the database works the record is published and one `operation.completed` follows

#### Scenario: A fault of the module's own
- **WHEN** the core sends a session record the status view cannot read, for five minutes, and then a valid one
- **THEN** one `operation.failed` at ERROR names `internal`, and one `operation.completed` follows the first evaluation that completes

#### Scenario: A refused key inside a run of failures
- **WHEN** the cloud refuses a push as a bad request, then the next one for its key, and the module stays held for ten minutes
- **THEN** both refusals are logged, no further request goes out, and only the two requests that went out have device call spans

### Requirement: Simulated Tronbyt server

The module SHALL provide `SimulatedTronbyt` beside `SimulatedCloud`, answering as a disposable real server did: server-generated IDs in the list, by-name lookup and removal, plain-text 404s, `background` defaulting to false, an anonymous-push count, brightness stored unchecked, a device read that names its pin, a pin that outlives its installation and an unpin that clears only that installation's own pin. It SHALL offer the same faults as the simulated cloud. An optional test SHALL run the same calls against a real server named by environment variables, and skip otherwise.

#### Scenario: The list a connected device is served from
- **WHEN** a background push creates an installation while the simulated server's `served` list is empty
- **THEN** that list omits it until a delete, a `PATCH` or an interrupting push reloads it

#### Scenario: The optional check without a server
- **WHEN** the module's tests run with no server named
- **THEN** the real-server test is skipped and nothing leaves the host

#### Scenario: Registered disposable Tronbyt route
- **WHEN** a disposable runtime selects the synthetic Tronbyt section
- **THEN** its registered transport reaches only the simulated server, exposes animated frame and timing evidence, and exercises the real module commands, while the existing cloud section retains its behavior and unknown URLs cannot reach a real transport

### Requirement: Tronbyt moments

The Tronbyt backend's record SHALL declare `moments` with the moods `celebrate`, `setback` and `reminder`, a maximum duration of 60 s and `coversStatus` true, and SHALL answer `moment-play/2.0` and `moment-play/2.1` as tracked commands. Its `moments.art` SHALL declare PNG and GIF staging up to 160 KiB for the bounded art profile below. On the cloud backend `moment-play` SHALL stay refused with `unsupported-capability`, and the capability unsupported.

A moment SHALL be refused before anything is stored or sent when its mood or duration is not declared (`unsupported-capability`), its start window has passed (`expired`), a command or another moment is in hand (`capacity`), an earlier takeover may still stand (`unavailable`), its moment ID was accepted before, or it is blocked (`invalid-state`). A moment SHALL be blocked while any session has attention, while the sessions' copy does not follow its owner, while the display's mode pins a tile, and, when it may not cover status, while a status tile stands in the rotation. It SHALL be checked again when its start comes and whenever the sessions change.

An accepted moment SHALL obtain its frame once, through a replaceable picture function that is a mood card by default; a failure, or 30 s without a frame, SHALL end it `failed` with nothing sent, and the module's stop SHALL NOT wait for it. At its start it SHALL take one turn of the queue: read the server's pin, and if one stands write nothing and end `failed` with `invalid-state`; otherwise push the frame in the foreground to an installation only moments use, then pin that installation. It SHALL hold for its duration, and for 30 s when that is shorter. It SHALL then release in a later turn: an unpin the server applies only if that installation holds the pin, then a deletion. The moment SHALL change no mode, no configuration revision and no stored display state, and no tile's push SHALL interrupt the display once its takeover's turn is queued, until it ends early or its outcome is stored.

Attention, a lost sessions copy or, for a moment that may not cover status, a status tile SHALL end a moment at once, and an accepted brightness or mode command SHALL end it. The outcome SHALL follow the release: `succeeded` with `transmitted` when it held for its time; `failed` with `cancelled` and `transmitted` when it ended early after its frame went out; `failed` with `none` when it ended before anything went out, with `cancelled` for a later command and `invalid-state` for what it yielded to. Evidence SHALL NOT exceed `transmitted`, and `observed` SHALL stay unknown. No write SHALL be sent again. A push or pin without a definite answer, or a release that did not succeed, SHALL be `uncertain`.

The module SHALL store no mood frame or replayable moment; separately staged art remains private media. It SHALL NOT resume or replay a moment after a stop or a crash; its ID SHALL stay spent, and the next start SHALL report it as unfinished commands are reported. A durable mark SHALL be set before the takeover's first request and cleared when a release is answered. While it stands and no moment is in hand, whatever other commands are pending, the module SHALL send a fresh release at a tile's next evaluation, at most once per the pin's 60 s retry wait and behind the queue's holds, log one `operation.failed` per run of failed releases and one `operation.completed` when one works, and refuse new moments.

#### Scenario: A moment on an idle display
- **WHEN** an idle Tronbyt display takes a 45 s `celebrate` moment
- **THEN** a foreground push and a pin go out once, the pin stands for 45 s, then the pin and the installation go, the tiles remain, and the outcome is `succeeded` with `transmitted`

#### Scenario: Attention arrives
- **WHEN** a session raises attention during a hold
- **THEN** the release goes out without waiting for the hold's end, and the outcome is `failed` with `cancelled` and `transmitted`

#### Scenario: A pin the owner set
- **WHEN** the mode pins a tile, or a pin stands on the server, or one is set there during the hold
- **THEN** the mode refuses the moment, the server's pin makes it end with nothing written, and a pin set during the hold survives the release

#### Scenario: A short and a long request
- **WHEN** a moment asks for 3 s, or for 61 s
- **THEN** the first holds for 30 s, and the second is refused with `unsupported-capability`

#### Scenario: A restart during a hold
- **WHEN** the module stops while a takeover stands, and starts again
- **THEN** the first evaluation releases it, the moment is reported `uncertain`, its frame is not pushed again, and its ID is refused if asked for again

#### Scenario: A release that fails
- **WHEN** the release gets a server error
- **THEN** the outcome is `uncertain`, new moments are refused with `unavailable`, and a fresh release goes out after the retry wait, with no second outcome

#### Scenario: A supplied picture
- **WHEN** the module is given a picture function, and it answers a frame or rejects
- **THEN** that exact frame goes out, or the moment ends `failed` with nothing sent

#### Scenario: Exact art survives expiry during an admitted moment
- **WHEN** a core-issued moment names a valid staged composition and that copy expires or is staged again during its hold
- **THEN** the moment uses its originally admitted bytes throughout, follows the existing takeover and release rules, and is never replaced by its mood

#### Scenario: Refused exact art
- **WHEN** a moment names missing or lapsed art, comes from a source other than the core, or targets the cloud backend
- **THEN** it is refused before display effects with the applicable not-found, forbidden or unsupported-capability error and no mood fallback

## MODIFIED Requirements

### Requirement: Tronbyt display controls

The Tronbyt backend's record SHALL declare brightness from 0 to 100, the native modes `rotation`, `interrupt`, `pin-status`, `hide-status` and, with a now-playing tile, `pin-now-playing` and `hide-now-playing`, and moments as "Tronbyt moments" states, and every other capability unsupported. It SHALL answer `brightness-set` and `device-mode-set` as tracked commands: stored before accepted, one write in the queue's turn behind its holds, never sent again, with an outcome stored with the record it changes and at most `transmitted` evidence; `observed` SHALL stay unknown. A repeat of an accepted command SHALL change nothing. Brightness SHALL scale its percent to the server's Gen 1 ceiling. `interrupt` SHALL make a tile's pushes interrupt the display. `hide-<tile>` SHALL remove that tile and write it no frame until another mode. `pin-<tile>` SHALL pin that tile while it stands and leave the rotation when it does not, following the tile across a removal and a new server ID. Mode and brightness SHALL survive a restart. A command a stop or a crash left without a stored outcome SHALL be reported at the next start, `uncertain` when its write may have begun and `failed` with `cancelled` otherwise, and never run again; a mode command whose write may have begun SHALL leave the pin unknown, so it is written again for the current mode. A command whose begun write cannot be stored SHALL end `failed` with no effect and say nothing about the server.

#### Scenario: An unanswered command
- **WHEN** a brightness write goes out and its answer is lost
- **THEN** its outcome is `uncertain` with evidence `none`, and it is not sent again

#### Scenario: A pinned tile that leaves and returns
- **WHEN** a pinned status tile is removed, then pushed again under a new server ID
- **THEN** the pin is cleared with the removal and set on the new ID

#### Scenario: The cloud backend
- **WHEN** a command reaches the module on the cloud backend
- **THEN** it is refused with `unsupported-capability`, and the record declares nothing

### Requirement: Simulated Tronbyt server

The module SHALL provide `SimulatedTronbyt` beside `SimulatedCloud`, answering as a disposable real server did: server-generated IDs in the list, by-name lookup and removal, plain-text 404s, `background` defaulting to false, an anonymous-push count, brightness stored unchecked, a device read that names its pin, a pin that outlives its installation and an unpin that clears only that installation's own pin. It SHALL offer the same faults as the simulated cloud. An optional test SHALL run the same calls against a real server named by environment variables, and skip otherwise.

#### Scenario: The optional check without a server
- **WHEN** the module's tests run with no server named
- **THEN** the real-server test is skipped and nothing leaves the host

## ADDED Requirements

### Requirement: Tronbyt moments

The Tronbyt backend's record SHALL declare `moments` with the moods `celebrate`, `setback` and `reminder`, a maximum duration of 60 s and `coversStatus` true, and SHALL answer `moment-play` as a tracked command. On the cloud backend `moment-play` SHALL stay refused with `unsupported-capability`, and the capability unsupported.

A moment SHALL be refused before anything is stored or sent when its mood or duration is not declared (`unsupported-capability`), its start window has passed (`expired`), a command or another moment is in hand (`capacity`), an earlier takeover may still stand (`unavailable`), its moment ID was accepted before, or it is blocked (`invalid-state`). A moment SHALL be blocked while any session has attention, while the sessions' copy does not follow its owner, while the display's mode pins a tile, and, when it may not cover status, while a status tile stands in the rotation. It SHALL be checked again when its start comes and whenever the sessions change.

An accepted moment SHALL obtain its frame once, through a replaceable picture function that is a mood card by default; a failure, or 30 s without a frame, SHALL end it `failed` with nothing sent, and the module's stop SHALL NOT wait for it. At its start it SHALL take one turn of the queue: read the server's pin, and if one stands write nothing and end `failed` with `invalid-state`; otherwise push the frame in the foreground to an installation only moments use, then pin that installation. It SHALL hold for its duration, and for 30 s when that is shorter. It SHALL then release in a later turn: an unpin the server applies only if that installation holds the pin, then a deletion. The moment SHALL change no mode, no configuration revision and no stored display state, and no tile's push SHALL interrupt the display once its takeover's turn is queued, until it ends early or its outcome is stored.

Attention, a lost sessions copy or, for a moment that may not cover status, a status tile SHALL end a moment at once, and any other accepted command SHALL end it. The outcome SHALL follow the release: `succeeded` with `transmitted` when it held for its time; `failed` with `cancelled` and `transmitted` when it ended early after its frame went out; `failed` with `none` when it ended before anything went out, with `cancelled` for a later command and `invalid-state` for what it yielded to. Evidence SHALL NOT exceed `transmitted`, and `observed` SHALL stay unknown. No write SHALL be sent again. A push or pin without a definite answer, or a release that did not succeed, SHALL be `uncertain`.

The module SHALL store no frame, and SHALL NOT resume or replay a moment after a stop or a crash; its ID SHALL stay spent, and the next start SHALL report it as unfinished commands are reported. A durable mark SHALL be set before the takeover's first request and cleared when a release is answered. While it stands and no moment is in hand, whatever other commands are pending, the module SHALL send a fresh release at a tile's next evaluation, at most once per the pin's 60 s retry wait and behind the queue's holds, log one `operation.failed` per run of failed releases and one `operation.completed` when one works, and refuse new moments.

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

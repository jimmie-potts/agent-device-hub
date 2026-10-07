## ADDED Requirements

### Requirement: Pixoo module and its configuration

The Pixoo SHALL run in the runtime as the module `pixoo`, created by `createPixooModule({transport})` with module API 1.1, from the package `@jimmie-potts/pixoo` under `modules/pixoo`, which imports only the SDK, the contracts package, its own files, Node built-ins and third-party packages. Its manifest's `configure` SHALL accept a section with `device` (a routing ID, a private IPv4 address, a profile the transport accepts, and an optional label, model and firmware), `hostedGif` (bind, port and origin), the starting `presentation` and `nowPlaying` settings, and `playback` (the playback record to follow), and SHALL name the device as the module's device. It SHALL refuse any other section with `invalid-request` and fixed text that repeats no value. A real transport SHALL accept only the observed device profiles and SHALL need `hostedGif` for the hosted profile; a simulated one SHALL also accept the simulator's profile. The module SHALL read no secret. `convertPixooSettings` SHALL turn the Pixoo service's `device.json`, `hosted-gif.json`, `presentation.json` and `now-playing.json` into a section the module accepts, with the Hub's device ID `pixoo-local` unless told another, or a refusal.

#### Scenario: A valid section
- **WHEN** the runtime admits a section naming device `pixoo-1` at a private address with an observed profile
- **THEN** the module is accepted with `pixoo-1` as its device, and without a section it is refused with `not-found`

#### Scenario: Sections the module refuses
- **WHEN** a section has a device ID with a space, a public or malformed address, an unknown profile, an unknown member, a hosted origin that is not http, a presentation or Now Playing setting of another version, or a malformed playback ID, or names the hosted profile without `hostedGif` for a real device
- **THEN** each is refused with `invalid-request`, and no refusal repeats a value from the section

#### Scenario: The service's settings converted
- **WHEN** the conversion reads a version 1 device file with the hosted profile, the hosted listener's file and the presentation and Now Playing files
- **THEN** it returns a section with device `pixoo-local` that the module accepts and that names no secret, and a device file of another version, a hosted profile without the listener or a device ID that is not a routing ID gives a refusal

### Requirement: Pixoo state and copies

The module SHALL keep only state it owns, in its own SQLite file and private folder: the library's catalog and the player's checkpoint (through `Library.attach`), its revision counter, presentation and Now Playing settings, configuration revision and last outcome, the commands it accepted and has not completed, and the commands it completed in the last 24 hours. It SHALL rebuild its copies of the core's `session/2.0` records and of the `playback/2.0` record by sync and SHALL NOT store them. A copy that has not synced, or whose owner stopped serving, SHALL be tried again after a doubling wait. A copy that followed its owner and lost it SHALL log one warning. An owner that has not answered since the start SHALL log at DEBUG until the wait reaches its longest, then one warning, and its later arrival SHALL log one recovery.

#### Scenario: The library in the module's database
- **WHEN** the module starts on an empty state directory and imports media
- **THEN** the catalog's tables are in the module's SQLite file beside the outbox, the media files are in its private folder, and a restart finds them

#### Scenario: A playback owner that starts later
- **WHEN** no playback owner serves the record at the module's start, and one starts after the wait has grown to its longest
- **THEN** the early attempts log at DEBUG, one warning follows, one recovery is logged when the owner arrives, and the card follows its record

### Requirement: Monitor and Now Playing from synced records

Monitor SHALL draw the module's copy of the core's sessions, as divoom-app-upgrade's presentation drew its 1.x snapshot. It SHALL show one top-level session per page, attention first, its label or title or session ID, and its finished turns that the Pixoo has not acknowledged. It SHALL show the source as current, stale or unavailable from the copy's state. Now Playing SHALL draw the chosen playback record's track, from the configured record or else the first by ID. The card SHALL follow the record's `availability` and the copy's state, never the age of `observedAtMs`, since the owner publishes only changes: it SHALL be stale while the owner marks the record `stale` or the copy stops following its owner, and gone for an `unavailable` record or a player that is neither playing nor paused. A song that plays on unchanged SHALL keep a current card, and a whole takeover SHALL hold it for as long as the song plays. Dashboards and cards SHALL render in worker calls; a failed render SHALL keep the last picture, SHALL be tried again, SHALL be logged once per run of failures, and SHALL be no evidence about the device.

#### Scenario: Monitor follows the core's sessions
- **WHEN** Monitor is selected, and the core publishes a session that waits for approval, then one whose approval resolved
- **THEN** the Pixoo shows that session's dashboard, two frames pulsing, as rendered from the synced record, then one calm frame; the display record shows Monitor participating with one matching session needing attention; and the paints are the device's last transmission with no request ID

#### Scenario: Now Playing pops up over Monitor
- **WHEN** Monitor shows a session and the playback record starts a track
- **THEN** the Pixoo shows the track's card for ten seconds, the display record shows the card with no takeover, and Monitor's dashboard returns

#### Scenario: A song that plays on unchanged
- **WHEN** the playback module's record keeps playing one song for more than 30 s without a change, first over Monitor and then while a whole takeover holds Media
- **THEN** the card stays bright through the ten-second pop-up, the display record shows it current, the whole takeover keeps it on the Pixoo for more than 30 s, and the playlist comes back once the song stops; the card turns stale only when the record does

#### Scenario: A failed render
- **WHEN** every render fails
- **THEN** nothing reaches the device, the device stays available, one warning reports the run of failures, and the module keeps running

### Requirement: Pixoo commands and outcomes

The module SHALL answer, on `bunny.cmd.<family>.<device id>` only, `device-mode-set`, `media-start`, `media-control`, `brightness-set` and `power-set` (#918), and `pixoo-media-show`, `pixoo-monitor-set`, `pixoo-now-playing-set`, `pixoo-playlist-change`, `pixoo-asset-change` and `pixoo-notice-dismiss`. Before acting, it SHALL refuse with the shared error body:
- a command that breaks its schema;
- a stale `expectedConfigurationRevision` or `expectedGeneration`, with `revision-conflict`;
- what the device's capabilities do not offer, with `unsupported-capability`;
- a resume with nothing selected, with `invalid-state`;
- an unknown rendition or notice, with `not-found`.

Otherwise it SHALL store its record of the work, reply `accepted`, run the work outside the responder, and report the outcome through its outbox, committed with the device's new pending count and last outcome:
- A device write SHALL complete `succeeded` with `transmitted` once the Pixoo answers.
- A start, show, resume, next, previous or restart SHALL complete with its own first upload, found by the async context of the command's action.
- A failure the Pixoo answered SHALL have `transmitted` evidence, never `none`: an error status or code SHALL be `failed`, and an unreadable answer `uncertain` with `uncertain-result`.
- Of the failures it did not answer, a write or upload that may have reached the device SHALL be `uncertain` with `uncertain-result` and no evidence.
- One that did not reach it SHALL be `failed`: `unavailable` for a device that did not answer, `cancelled` for one a newer command superseded.
- A change to state the module owns (pause, stop, clear, the presentation and Now Playing settings, playlists, media and a dismissal) SHALL complete `succeeded` with `observed`, its committed state being the evidence.
- A domain refusal after acceptance SHALL be `failed` with its registry code; any other failure after the work began SHALL be `uncertain`.

A repeated `(source, requestId)` SHALL be accepted again and change nothing. A command accepted before a restart and never completed SHALL be reported `uncertain` with `uncertain-result` at the next start and SHALL NOT run again. As ControlService did, a playback command that starts SHALL take the display from Monitor, and any other SHALL interrupt Monitor, so a stop, pause or clear SHALL cancel a pending Media selection at once.

#### Scenario: A media start accepted, then completed
- **WHEN** media is imported, put in a playlist and the playlist started
- **THEN** the start is accepted at once, completes `succeeded` with `transmitted` once the media reached the Pixoo, the Pixoo shows it, and the device record names the start as its last transmission with nothing pending

#### Scenario: Pause changes only the module's playback
- **WHEN** a playing playlist is paused
- **THEN** the pause completes `succeeded` with `observed` and nothing more is sent to the device

#### Scenario: A pending Media selection cancelled
- **WHEN** a start waits on its capture with Monitor present, and a stop, pause or clear arrives
- **THEN** the start completes `failed` with `cancelled` and no evidence, the stop, pause or clear completes `observed`, nothing is selected and nothing was uploaded

#### Scenario: A write the Pixoo refused
- **WHEN** the Pixoo answers a brightness write with an error code
- **THEN** the command completes `failed` with `invalid-state` and `transmitted` evidence, because the write reached the device

#### Scenario: A write that may have reached the device
- **WHEN** a brightness write is sent and the device never answers
- **THEN** the command completes `uncertain` with `uncertain-result`, never as a refusal

#### Scenario: A restart before the outcome
- **WHEN** a brightness write is accepted on a silent Pixoo and the runtime restarts before it completes
- **THEN** the next start reports it `uncertain` with `uncertain-result`, and the device never receives the write

#### Scenario: Refusals before acting
- **WHEN** a mode change names a stale configuration revision, a mode the Pixoo does not offer, or a power change a stale generation
- **THEN** each is refused with `revision-conflict`, `unsupported-capability` and `revision-conflict`, and nothing reaches the device

#### Scenario: A repeated request
- **WHEN** a brightness write is sent twice with one request ID
- **THEN** both are accepted, the device gets one write, and one outcome is published

### Requirement: Pixoo device state and availability

The module SHALL publish `device/2.0` for its device, kind `pixoo`, with the Pixoo's capabilities (power, brightness, the native modes `monitor` and `media`, the seven media actions and at most 256 playlist and rendition IDs). It SHALL also publish its availability; the desired power, brightness and mode; the observed power and brightness, only from the device's own probe; its pending commands and their families; its last outcome; its last transmission, for a command and for its own paints but never a probe; and its generation, a per-start epoch with the player's generation. It SHALL serve `device`, `pixoo-display`, `pixoo-rendition` and `pixoo-playlist` through sync, each record within the 256 KiB cap, at one stored revision that only rises, and SHALL publish only records that changed. When another module already serves `device`, it SHALL serve only its own families, keep publishing its device record, log one ERROR record, and keep running. Its start SHALL open only local resources and SHALL NOT wait on the device. It SHALL probe the device on the runtime's scheduler with a 2 s deadline: every 30 s while it answers, and after a doubling wait from 1 s while it does not. An unanswered probe SHALL make the device `unavailable`, never a module failure. A device that stays offline SHALL log one `device.unavailable` warning and DEBUG summaries, and its recovery one `device.available` record.

#### Scenario: Policy A in the module test kit
- **WHEN** the kit starts the module with a Pixoo that never answers
- **THEN** its start finishes within 1000 ms and the module then publishes the device `unavailable`

#### Scenario: Offline at start
- **WHEN** the module starts while its Pixoo refuses connections, stays so through several probes, then comes back
- **THEN** the module runs throughout, the device is `unavailable`, then `available`; one warning and one recovery that counts the failed probes are logged; and no device record repeats the one before it

#### Scenario: The catalog within the cap
- **WHEN** a playlist holds 1,000 items, with the longest name and largest numbers
- **THEN** its record fits a 256 KiB message with room for the envelope

#### Scenario: Another module serves the device family
- **WHEN** another participant serves `device` before the Pixoo starts
- **THEN** the Pixoo starts, logs one ERROR record, serves its own families through sync and still publishes its device record

### Requirement: Isolated media jobs

Media decoding and rendering SHALL run in a forked child process with a 256 MiB heap, killed with SIGKILL when its job is aborted, so a corrupt, oversized or hostile image fails only its own job. An import SHALL take inline content of at most 160 KiB, or a file the uploader staged in the module's `incoming` folder, named by its SHA-256, whose size and hash must match. An image that declares more pixels than the limit SHALL fail as `too-large` from its header, before decoding. A busy library lock SHALL be told by SQLite's code, never by an exception's message.

#### Scenario: A corrupt and an oversized image
- **WHEN** one import is not a valid PNG and another declares 20,000 by 20,000 pixels in a few bytes
- **THEN** the first completes `failed` with `invalid-request`, the second `failed` with `too-large`, the module keeps running and a valid import that follows succeeds

#### Scenario: The child's heap
- **WHEN** the media child process is forked
- **THEN** its heap limit is capped near 256 MiB rather than the default

### Requirement: Consumer-only dismissal

`pixoo-notice-dismiss` SHALL acknowledge one finished turn's notice to the core with `notice-acknowledge` (#918), for the Pixoo's own consumer ID `pixoo`, so it clears on the Pixoo only. It SHALL refuse a notice its copy of the session does not hold with `not-found`. The core's acceptance SHALL complete it `succeeded` with `observed`, its refusal `failed` with the core's code, and no answer `uncertain`.

#### Scenario: A finished turn dismissed on the Pixoo
- **WHEN** the core holds a session with an unacknowledged finished turn and the Pixoo's dismissal is sent
- **THEN** the core receives `notice-acknowledge` from `bunny/modules/pixoo` for consumer `pixoo` and that notice, the dismissal completes `observed`, and a dismissal of an unknown notice is refused with `not-found`

### Requirement: Pixoo code under the strict profile

The Pixoo code SHALL pass the strict profile, the module boundary and the safe-error rules with no lint baseline and no staging, and its moved tests SHALL pass from the module's build, with the three cancellation cases restored against the module's command handling.

#### Scenario: Lint and tests
- **WHEN** `npm run lint:js` and `npm run test:pixoo:built` run after a build
- **THEN** lint reports nothing for `modules/pixoo`, which has no baseline entry, and every moved, restored and module test passes

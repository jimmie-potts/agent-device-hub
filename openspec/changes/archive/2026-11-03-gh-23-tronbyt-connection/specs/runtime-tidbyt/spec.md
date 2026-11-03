## MODIFIED Requirements

### Requirement: One Tidbyt module with private cloud configuration

The runtime SHALL host one module, `tidbyt` (module API 1.3), that writes the Tidbyt's status and now-playing tiles through the one backend its section selects. Its `configure` SHALL accept a section with an `id`, a routing ID; an optional `backend`, `cloud` by default or `tronbyt`; for the cloud a `cloudDeviceId` of 1 to 128 letters, digits, underscores or hyphens, and for a Tronbyt server a `tronbyt` block as "Selected Tronbyt backend" states, each refused under the other backend; an optional `statusInstallation` of letters and digits, `agentdevicehub` by default; an optional `nowPlaying` of `{playback, installation?}`, the routing ID of the `playback` record to show and the card's own installation, `nowplaying` by default and different from the status tile's; and a `secrets` member that names the selected backend's API key's file as `token`. Any other section SHALL be refused with `invalid-request` and a fixed detail that repeats no value. The module SHALL name `id` as its one device and read the key once, at start. The cloud's device ID, a server's origin and device ID and the key SHALL NOT appear in any message, log record, span, error body or health entry.

#### Scenario: A valid section
- **WHEN** the section names `tidbyt`, a cloud device, both installations, the `living-room` playback record and the key's file
- **THEN** the runtime accepts it and the module's device is `tidbyt`; without `statusInstallation` or `nowPlaying.installation` the runner's defaults apply

#### Scenario: Sections the module refuses
- **WHEN** the section adds a member, gives an ID with capitals, a cloud device with a slash, an installation with a hyphen, a now-playing installation equal to the status one or a playback ID that is not a routing ID, or names no `secrets.token`
- **THEN** the module is refused with `invalid-request`, and the detail repeats no value

#### Scenario: No secret anywhere
- **WHEN** the module shows both tiles on the simulated cloud
- **THEN** no published message, log record or span holds the API key or the cloud's device ID, and the simulated cloud received the key from the secret file

### Requirement: Device record, commands and diagnostics

The module SHALL serve `device` through sync and publish the Tidbyt's `device/2.0` record of kind `tidbyt`. On the cloud backend every capability SHALL be unsupported, desired, observed, last outcome and external control `unknown`, and `pending` 0, and "Tronbyt display controls" states what a server's record declares. Availability follows the selected backend's answers as this requirement states them for the cloud. Its `availability` SHALL be `unknown` until the cloud first answers, `available` once it accepted a write or listed the installations, `degraded` while it rate limits, refuses a request or answers with a server error, and `unavailable` while it does not answer or refuses the key or the device. `lastTransmission` SHALL record each push or removal the cloud accepted. A new revision SHALL be published only when availability or the last transmission changes, and its revision SHALL rise across restarts. Every general command to the Tidbyt SHALL be refused with `unsupported-capability`; one whose subject is another device never reaches the module, since the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). Sync SHALL serve the record as last committed, never a revision the database refused. A cloud that does not answer SHALL log one `device.unavailable` warning per outage, later failures as DEBUG summaries, and one `device.available` on recovery; a tile's refused calls and failed renders SHALL log one `operation.failed` per run of failures, and another when the cloud refuses the key or the device inside that run; a database that refuses commits SHALL log one `operation.failed` and one `operation.completed` per run, and the record SHALL be published again once a commit works; a fault of the module's own in a tile's evaluation SHALL log one `operation.failed` at ERROR per run of faults and one `operation.completed` when an evaluation completes again. Each cloud call that goes out SHALL have a `bunny.device.call` span, a call a hold keeps back SHALL have none, and no trace context SHALL reach the cloud.

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

## ADDED Requirements

### Requirement: Selected Tronbyt backend

A section with `backend: "tronbyt"` SHALL name `tronbyt: {url, deviceId, minIntervalMs?, refreshMs?}`: the server's origin with no credentials, path, query or fragment, over `https`, or over `http` only to a loopback, private or single-label host or a `.local`, `.internal`, `.lan` or `.home.arpa` name; a device ID of 1 to 128 letters, digits, underscores or hyphens; and a gate and refresh of 1 s to a day, which default to the cloud's 15 s and 10 minutes. The module SHALL build exactly one connection in a run, with no failover to the other backend. Each push SHALL state `background` and name its installation, and SHALL never be anonymous. Presence SHALL be read by asking for the installation by name. A 404 `App not found` SHALL count as no such installation, and any other 404 as an unknown device. The cloud's gate and refresh SHALL NOT be configurable.

#### Scenario: Identical frames through both backends
- **WHEN** the same sessions and playback reach the module on the simulated cloud and on the simulated server
- **THEN** each installation shows the same picture, the server's took a named background push, and no anonymous push was made

#### Scenario: A section naming both backends
- **WHEN** a section selects one backend and carries the other's settings
- **THEN** it is refused with `invalid-request` and a fixed detail that repeats no value

#### Scenario: A public host over plain http
- **WHEN** a section names `http://` with a public host, since each request carries the key
- **THEN** it is refused

#### Scenario: A tile already gone
- **WHEN** a tile is removed and the server answers 404 `App not found`
- **THEN** the tile counts as removed, while `Device not found` makes the Tidbyt `unavailable`

### Requirement: Tronbyt display controls

The Tronbyt backend's record SHALL declare brightness from 0 to 100 and the native modes `rotation`, `interrupt`, `pin-status`, `hide-status` and, with a now-playing tile, `pin-now-playing` and `hide-now-playing`, and every other capability unsupported. It SHALL answer `brightness-set` and `device-mode-set` as tracked commands: stored before accepted, one write in the queue's turn behind its holds, never sent again, with an outcome stored with the record it changes and at most `transmitted` evidence; `observed` SHALL stay unknown. A repeat of an accepted command SHALL change nothing. Brightness SHALL scale its percent to the server's Gen 1 ceiling. `interrupt` SHALL make a tile's pushes interrupt the display. `hide-<tile>` SHALL remove that tile and write it no frame until another mode. `pin-<tile>` SHALL pin that tile while it stands and leave the rotation when it does not, following the tile across a removal and a new server ID. Mode and brightness SHALL survive a restart. A command a stop or a crash left without a stored outcome SHALL be reported at the next start, `uncertain` when its write may have begun and `failed` with `cancelled` otherwise, and never run again.

#### Scenario: An unanswered command
- **WHEN** a brightness write goes out and its answer is lost
- **THEN** its outcome is `uncertain` with evidence `none`, and it is not sent again

#### Scenario: A pinned tile that leaves and returns
- **WHEN** a pinned status tile is removed, then pushed again under a new server ID
- **THEN** the pin is cleared with the removal and set on the new ID

#### Scenario: The cloud backend
- **WHEN** a command reaches the module on the cloud backend
- **THEN** it is refused with `unsupported-capability`, and the record declares nothing

### Requirement: Backend handoff

The module SHALL record which backend its stored tiles belong to. When a start selects another, it SHALL drop the tiles' memory and the display's stored state, report a write the old writer left uncertain once, settle commands left without an outcome, and write the current frame fresh on the new backend once its gate allows, reading presence first where a removal needs it. No frame SHALL be stored or replayed, and the old backend SHALL hear nothing more. A database from before this record SHALL count as the cloud's, so an upgrade on the cloud pushes nothing while a tile stands.

#### Scenario: From the cloud to a server with a write under way
- **WHEN** the module stops during a cloud push that never answered, and starts selecting a server
- **THEN** one `uncertain-result` record and one `backend-changed` record appear, the server takes a fresh write of the current state, and the cloud hears nothing more

#### Scenario: Back to the cloud
- **WHEN** a section returns to the cloud
- **THEN** the tiles are written fresh, the controls are refused again and the record shows no mode

### Requirement: Simulated Tronbyt server

The module SHALL provide `SimulatedTronbyt` beside `SimulatedCloud`, answering as a disposable real server did: server-generated IDs in the list, by-name lookup and removal, plain-text 404s, `background` defaulting to false, an anonymous-push count, brightness stored unchecked and a pin that outlives its installation. It SHALL offer the same faults as the simulated cloud. An optional test SHALL run the same calls against a real server named by environment variables, and skip otherwise.

#### Scenario: The optional check without a server
- **WHEN** the module's tests run with no server named
- **THEN** the real-server test is skipped and nothing leaves the host

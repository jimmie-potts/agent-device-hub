## MODIFIED Requirements

### Requirement: One writer, the 15-second gate and no replay

Every cloud call SHALL go through one queue, one call at a time, in order, behind a lease on the cloud device in the module's private folder. Each tile SHALL push only when its frame changes, at most once every 15 s measured from the end of the tile's previous call: its answer, a failure such as a refused connection, or its 10-second deadline when nothing came back. A request reaches the cloud before its call ends, however long it takes on the way, so within one start of the module, while the wall clock does not step forward, the cloud SHALL receive a tile's writes at least 15 s apart. A write the module stops or crashes during keeps the time its request went out, because nothing is stored once the module stops, and its frame is unknown, so the next start pushes the current frame again once the gate allows; that push can reach the cloud less than 15 s after the stopped one, by the stopped request's travel time. Each tile SHALL coalesce changes into one push of the latest state, and SHALL push an unchanged frame again 10 minutes after that frame's push ended. A tile with nothing to show SHALL be removed; when its presence is unknown, the tile SHALL read the installation list first and delete only an installation that is there. A write that failed or may have taken effect SHALL NOT be sent again: a later write SHALL be a fresh one for the current state, after a wait that starts at 15 s and doubles up to 10 minutes, and an uncertain push SHALL make the installation's presence unknown. A 401, a 403 or the cloud's "no UID" 500 SHALL hold every later call without a request until the runtime restarts, and a 429 SHALL hold later calls for its `Retry-After`. A module that cannot take the lease SHALL write nothing and report the Tidbyt `unavailable`.

#### Scenario: A burst inside the gate
- **WHEN** three session changes arrive within 15 s of a push
- **THEN** nothing more is pushed inside the gate, and one push 15 s after the first shows the latest state; nothing follows without a change

#### Scenario: A push that reaches the cloud late
- **WHEN** the first push takes 300 ms to reach the cloud, and a session changes within the gate
- **THEN** the next push reaches the cloud 15 s after the first arrived, not 15 s after it went out

#### Scenario: A push that never answers
- **WHEN** a push takes 9 s to reach the cloud and its answer is lost, so its call ends uncertain at its 10-second deadline, and a session changes
- **THEN** the next push goes out no sooner than 15 s after that deadline, and the cloud receives the two at least 15 s apart

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
- **WHEN** a second instance of the module starts on the same state directory while the first runs and holds the lease
- **THEN** the second's start is refused with `SQLITE_BUSY` at the module's database, which the first keeps to itself, so it takes no lease and reaches no cloud, and a second take of the cloud device's lease is refused as busy

### Requirement: Device record, commands and diagnostics

The module SHALL serve `device` through sync and publish the Tidbyt's `device/2.0` record of kind `tidbyt` with every capability unsupported, desired, observed, last outcome and external control `unknown`, and `pending` 0. Its `availability` SHALL be `unknown` until the cloud first answers, `available` once it accepted a write or listed the installations, `degraded` while it rate limits, refuses a request or answers with a server error, and `unavailable` while it does not answer or refuses the key or the device. `lastTransmission` SHALL record each push or removal the cloud accepted. A new revision SHALL be published only when availability or the last transmission changes, and its revision SHALL rise across restarts. Every general command to the Tidbyt SHALL be refused with `unsupported-capability`; one whose subject is another device never reaches the module, since the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). Sync SHALL serve the record as last committed, never a revision the database refused. A cloud that does not answer SHALL log one `device.unavailable` warning per outage, later failures as DEBUG summaries, and one `device.available` on recovery; a tile's refused calls and failed renders SHALL log one `operation.failed` per run of failures, and another when the cloud refuses the key or the device inside that run; a database that refuses commits SHALL log one `operation.failed` and one `operation.completed` per run, and the record SHALL be published again once a commit works; a fault of the module's own in a tile's evaluation SHALL log one `operation.failed` at ERROR per run of faults and one `operation.completed` when an evaluation completes again. Each cloud call that goes out SHALL have a `bunny.device.call` span, a call a hold keeps back SHALL have none, and no trace context SHALL reach the cloud.

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

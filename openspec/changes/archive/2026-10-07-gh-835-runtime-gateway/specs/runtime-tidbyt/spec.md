## MODIFIED Requirements

### Requirement: Device record, commands and diagnostics

The module SHALL serve `device` through sync and publish the Tidbyt's `device/2.0` record of kind `tidbyt` with every capability unsupported, desired, observed, last outcome and external control `unknown`, and `pending` 0. Its `availability` SHALL be `unknown` until the cloud first answers, `available` once it accepted a write or listed the installations, `degraded` while it rate limits, refuses a request or answers with a server error, and `unavailable` while it does not answer or refuses the key or the device. `lastTransmission` SHALL record each push or removal the cloud accepted. A new revision SHALL be published only when availability or the last transmission changes, and its revision SHALL rise across restarts. Every general command to the Tidbyt SHALL be refused with `unsupported-capability`; one whose subject is another device never reaches the module, since the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). Sync SHALL serve the record as last committed, never a revision the database refused. A cloud that does not answer SHALL log one `device.unavailable` warning per outage, later failures as DEBUG summaries, and one `device.available` on recovery; a tile's refused calls and failed renders SHALL log one `operation.failed` per run of failures, and another when the cloud refuses the key or the device inside that run; a database that refuses commits SHALL log one `operation.failed` and one `operation.completed` per run, and the record SHALL be published again once a commit works; a fault of the module's own in a tile's evaluation SHALL log one `operation.failed` at ERROR per run of faults and one `operation.completed` when an evaluation completes again. Each cloud call that goes out SHALL have a `bunny.device.call` span, a call a hold keeps back SHALL have none, and no trace context SHALL reach the cloud.

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

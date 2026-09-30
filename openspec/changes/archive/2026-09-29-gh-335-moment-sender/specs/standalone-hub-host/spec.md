## ADDED Requirements

### Requirement: Bounded controller slot wait for sends
The host's per-device controller client SHALL keep one slot per controller. A send MAY wait for a busy slot for at most 2,500 ms, in arrival order, and SHALL fail with `capacity` without contacting the controller when the bound expires. Every read, including dashboard polls, the controller snapshot route and MCP tools, SHALL keep the immediate `capacity` rejection while the slot is held, including while sends are waiting. Closing the client SHALL fail waiting sends as unavailable.

#### Scenario: Send waits for a read
- **WHEN** a send starts while a dashboard read holds the controller's slot and the read finishes within the bound
- **THEN** the send takes the slot after the read and makes exactly one command POST

#### Scenario: Slot held past the bound
- **WHEN** the slot stays held for longer than 2,500 ms after a send starts waiting
- **THEN** the send returns `capacity` and the controller receives no command POST

#### Scenario: Reads do not wait
- **WHEN** a dashboard or route read arrives while the slot is held or sends are waiting
- **THEN** it is rejected with `capacity` at once

### Requirement: Controller 1.1 moment command path
The controller client SHALL send a 1.1 command only after validating it as `requestV1_1` for the configured controller and device, SHALL POST it to the controller's `/commands` exactly once, and SHALL return the answer only when it validates as `receiptV1_1` with the request's controller, device and ticket, for a 2xx answer or a typed non-2xx receipt. A mismatched or malformed answer, a timeout or a lost response SHALL be `uncertain-result` with no further POST. A typed refusal without a receipt SHALL keep its code. The 1.0 command path SHALL be unchanged and SHALL keep sending `apiVersion` 1.0.

#### Scenario: Receipt for the ticket
- **WHEN** a 1.1 controller answers a moment request with a `receiptV1_1` for the same ticket
- **THEN** the client returns that receipt after one POST

#### Scenario: Ambiguous answer
- **WHEN** the controller times out, drops the connection or answers a receipt for another ticket
- **THEN** the client reports `uncertain-result` after exactly one POST

### Requirement: Hub moment sender
The host SHALL provide an internal moment sender that sends one moment to one controller per call and adds no route, MCP tool, page, durable state or arbitration. The caller SHALL supply `momentId`, `mood`, optional `palette`, `durationMs`, `priorityClass`, `coversStatus`, an optional start instant on the hub's monotonic clock that defaults to the snapshot's arrival, and an optional `toleranceMs` that defaults to 10,000. The sender SHALL reject invalid input, including a `flourish` with `coversStatus:true`, a `toleranceMs` above 60,000 or a start more than 60,000 ms ahead, before any controller read. For valid input it SHALL wait for the controller's slot within the bounded send wait, read a fresh snapshot through the negotiated 1.1 read inside the same slot, and send nothing unless the snapshot is 1.1 and declares `moments` supported with the requested mood and a `maxDurationMs` of at least `durationMs`. It SHALL then build one `requestV1_1` with the snapshot's `nextRequestId`, configuration revision and generation, the caller's fields unchanged, `start.epoch` from `sampleClock.epoch` and `start.atMs` as `sampleClock.sampledAtMs` plus the hub-monotonic difference between the snapshot's arrival and the start instant, and POST it once. Each call SHALL return exactly one result carrying the `momentId` and the computed start, or no start when no snapshot was read: the controller's receipt; not sent, with `1.0-only`, `moments-unsupported`, `unsupported-capability`, `capacity` or `unavailable`; or `uncertain`. The sender SHALL never resend a moment, and a hub start, reconnect or read SHALL send no moment.

#### Scenario: Request built from the snapshot
- **WHEN** a caller sends a moment to a 1.1 controller that declares `moments` supported
- **THEN** exactly one POST carries a valid `requestV1_1` whose ticket, expected revision and generation equal the snapshot read just before it, whose `start.epoch` is the snapshot's clock epoch and whose `start.atMs` is `sampledAtMs` plus the hub-clock difference between the snapshot's arrival and the start instant

#### Scenario: Same hub instant on two devices
- **WHEN** a caller gives the same start instant to two calls for controllers with different clocks
- **THEN** each request names that hub instant in its own controller's clock

#### Scenario: Not sent
- **WHEN** the target serves only 1.0, declares moments unsupported, lacks the mood or allows a shorter duration
- **THEN** the call returns the matching not-sent reason and the controller receives no command POST

#### Scenario: Ambiguity and receipts
- **WHEN** the POST times out or loses its response, or the controller answers with a failed receipt such as `moment-missed`, `moment-blocked`, `moment-duplicate`, `revision-conflict` or `stale-generation`, or a typed refusal such as `request-order`
- **THEN** the call returns `uncertain` or the typed answer after exactly one POST and sends nothing more

#### Scenario: Independent devices
- **WHEN** a caller sends one moment to three devices concurrently and one is offline
- **THEN** the other two are sent and each call returns its own result

#### Scenario: No replay
- **WHEN** the hub restarts, reconnects or serves snapshot reads and dashboard polls
- **THEN** no controller receives a command POST

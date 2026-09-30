## ADDED Requirements

### Requirement: Owner moment route
`POST /api/controllers/v1/<alias>/moment` SHALL send one moment to that one device as an explicit owner command. It SHALL require `control` scope for that alias, the same origin and fetch-metadata checks as other controller routes and the `X-Pixoo-Request: 1` mutation header, and SHALL read its body only after authorization. The body SHALL be exactly `{mood, durationMs, coversStatus}` with a contract mood ID, an integer `durationMs` from 1,000 to 300,000 and a boolean `coversStatus`; any other body, a query string or an unknown alias SHALL be refused with a typed error before any controller contact. For a valid body the hub SHALL assign a fresh `momentId` and `priorityClass: "event"`, use the sender's default start and tolerance, call the moment sender exactly once and answer 200 with its typed result: the receipt, a not-sent reason or `uncertain`, with the `momentId` and start. The hub SHALL apply no arbitration; the device's own precedence decides whether the moment plays. The route SHALL answer within the hub's 3 s response cap: when the sender has not returned within the route's bound, it SHALL answer `uncertain` with that `momentId` and SHALL let the one call finish without resending. There SHALL be no MCP tool for this route.

#### Scenario: Scope and header
- **WHEN** a `read` principal, a principal without that alias or a request without the mutation header posts a moment
- **THEN** the hub answers `forbidden` and the controller receives nothing

#### Scenario: Invalid body
- **WHEN** the body adds a palette or another field, names a mood that is not a contract ID, or has a duration below 1,000 or above 300,000 ms
- **THEN** the hub answers 400 `invalid-request` and the controller receives no read and no command

#### Scenario: Undeclared mood or long duration
- **WHEN** the mood is not declared by the device or the duration exceeds its `maxDurationMs`
- **THEN** the hub answers the sender's `not-sent` result with `unsupported-capability` and the controller receives no command

#### Scenario: One send
- **WHEN** a control principal posts a valid moment for a 1.1 device that declares it
- **THEN** exactly one moment request reaches the controller with a fresh `momentId`, `priorityClass: "event"`, the chosen fields and no palette, and the hub answers the typed result

#### Scenario: Slow controller
- **WHEN** the controller holds the moment request past the route's bound
- **THEN** the hub answers `uncertain` within 3 s, and the controller receives that one request and no other

## MODIFIED Requirements

### Requirement: Hub moment sender
The host SHALL provide an internal moment sender that sends one moment to one controller per call. The sender itself adds no route, MCP tool, page, durable state or arbitration; callers such as the owner moment route and the automation intake apply their own policy. The caller SHALL supply `momentId`, `mood`, optional `palette`, `durationMs`, `priorityClass`, `coversStatus`, an optional start instant on the hub's monotonic clock that defaults to the snapshot's arrival, and an optional `toleranceMs` that defaults to 10,000. The sender SHALL reject invalid input, including a `flourish` with `coversStatus:true`, a `toleranceMs` above 60,000 or a start more than 60,000 ms ahead, before any controller read. For valid input it SHALL wait for the controller's slot within the bounded send wait, read a fresh snapshot through the negotiated 1.1 read inside the same slot, and send nothing unless the snapshot is 1.1 and declares `moments` supported with the requested mood and a `maxDurationMs` of at least `durationMs`. It SHALL then build one `requestV1_1` with the snapshot's `nextRequestId`, configuration revision and generation, the caller's fields unchanged, `start.epoch` from `sampleClock.epoch` and `start.atMs` as `sampleClock.sampledAtMs` plus the hub-monotonic difference between the snapshot's arrival and the start instant, and POST it once. Each call SHALL return exactly one result carrying the `momentId` and the computed start, or no start when no snapshot was read: the controller's receipt; not sent, with `1.0-only`, `moments-unsupported`, `unsupported-capability`, `capacity` or `unavailable`; or `uncertain`. The sender SHALL never resend a moment, and a hub start, reconnect or read SHALL send no moment.

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

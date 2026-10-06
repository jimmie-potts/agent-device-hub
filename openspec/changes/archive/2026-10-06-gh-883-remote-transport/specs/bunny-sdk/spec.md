## MODIFIED Requirements

### Requirement: Per-subscriber delivery

Each subscription and each responder SHALL have its own queue, which delivers one message at a time in publish order. A slow handler SHALL delay only its own queue, never the sender, other subscribers or requests. `publish` SHALL NOT wait for any handler, and no handler SHALL run inside the sender's call. Each queue SHALL hold at most `maxQueued` waiting messages, 1024 by default; a `maxQueued` that is not a positive integer SHALL throw `RangeError`. When a subscription's queue is full, a new message SHALL be dropped for that subscription only, and `onError` SHALL receive an `SdkError` with code `capacity`. When a responder's queue is full, the requester SHALL get a `rejected` result with `capacity` instead. A subscription MAY pass `onOverflow`: after its full queue dropped one or more messages, the SDK SHALL call `onOverflow` with the number dropped since it was last told, and with no count when a remote connection was lost and restored, in the subscription's order and before the next message is delivered, and `onError` SHALL still receive each `capacity` report. The notice says that messages were dropped, not where: messages queued before the drop MAY be delivered after it. An `onOverflow` that throws SHALL be reported to `onError`, and delivery SHALL go on. A handler that throws SHALL be reported to `onError` and SHALL keep receiving. Without an `onError`, each report SHALL become a `BunnySdkWarning` process warning whose message names the source and pattern, with the original error as its `cause`. Closing a subscription SHALL drop its waiting messages and resolve when its running handler finishes. Called from that handler's own async flow while it runs, it SHALL resolve without waiting for it. Called from any other flow, including another subscription's handler or a continuation that a finished delivery of the same subscription left behind, it SHALL wait for the running handler. Close detection thus follows the handler's async flow: a callback that an emitter created elsewhere invokes is not in that flow, and two handlers that await each other's close deadlock.

#### Scenario: A slow subscriber delays only itself
- **WHEN** one subscriber's handler stays blocked on its first message while five messages are published
- **THEN** publishing resolves without waiting, another subscriber receives all five, a request is still answered, and the slow subscriber receives the rest in order once released

#### Scenario: A slow responder delays only its own commands
- **WHEN** a responder's handler is blocked
- **THEN** subscribers still receive published messages, and the pending request resolves once the handler answers

#### Scenario: A full queue
- **WHEN** a blocked subscriber's queue already holds `maxQueued` waiting messages and more are published
- **THEN** those messages are dropped for that subscriber only, `onError` receives `capacity` for each one with the subscriber's source and pattern, and other subscribers receive every message

#### Scenario: A queue limit that is not a positive integer
- **WHEN** a bus is created with a `maxQueued` of zero, a negative, fractional or non-finite number, or a number above the safe-integer range
- **THEN** the constructor throws `RangeError`

#### Scenario: A handler that throws
- **WHEN** a subscriber's handler throws
- **THEN** the error is reported to `onError`, or as a `BunnySdkWarning` naming the source and pattern with the error as its `cause` when no `onError` is given, and the subscriber receives the next message

#### Scenario: Closing during a delivery
- **WHEN** a subscription closes while its handler is running and another message waits
- **THEN** the close resolves after the running handler finishes, and the waiting message is never delivered

#### Scenario: Closing from inside the handler
- **WHEN** a subscriber's handler, or a responder, closes its own subscription and waits for the close
- **THEN** the close resolves, the handler finishes, no later message reaches it, and the responder's reply arrives as `accepted`

#### Scenario: A subscriber told about dropped messages
- **WHEN** a stalled subscription that passed `onOverflow` has messages dropped because its queue is full, and its handler is then released
- **THEN** `onOverflow` receives the number dropped before the next message is delivered, even one queued before the drop, `onError` has received `capacity` for each one, other subscribers received every message, and a later message arrives without another notice until the next drop

#### Scenario: Closing another subscription from a handler
- **WHEN** one subscription's handler closes a second subscription whose handler is running
- **THEN** the close resolves only after the second subscription's handler finishes

#### Scenario: A continuation left by a finished delivery
- **WHEN** a continuation that a finished delivery started closes the same subscription while a later delivery's handler runs
- **THEN** the close resolves only after that later handler finishes

#### Scenario: A gap with no count
- **WHEN** a remote participant's stream is lost and the client reconnects
- **THEN** each of its subscriptions receives `onOverflow` with no `dropped` count before its next message

## ADDED Requirements

### Requirement: Publish a prepared message

The SDK SHALL give each participant `publishMessage(key, message)`, which publishes a message built earlier, such as one an outbox stored, unchanged: its `id`, `time` and trace context SHALL stay as they are. It SHALL follow `publish`'s key-class rules, SHALL refuse a kind that is not published with `invalid-request`, and SHALL refuse a message whose `source` is not the participant's with `forbidden`.

#### Scenario: An outbox resends a stored message
- **WHEN** a participant publishes a message and later publishes the same message again with `publishMessage`, on either transport
- **THEN** subscribers receive both, with the same `id` and `time`

#### Scenario: Another source's message
- **WHEN** a participant publishes a message whose `source` is another participant's
- **THEN** it is refused with `forbidden`

### Requirement: Carry the SDK calls to remote parts over SSE and HTTP

The SDK SHALL offer a `RemoteEdge` on an in-process bus and a client, `connectRemote`, that gives a remote part the same calls as a module. Messages SHALL flow down one `text/event-stream` per connection at `GET /api/sdk/v1/stream`, and calls SHALL go up as `POST /api/sdk/v1/<call>`. Every frame SHALL carry `schema` `sdk-remote/1.0`, and every refusal SHALL be the shared error body.

- **Credentials:** each remote source SHALL have a bearer token, compared in constant time. A call without a granted token SHALL be refused with `unauthenticated`. A message or connection of another source SHALL be refused with `forbidden`. A token SHALL NOT appear in any message, log record or error body.
- **Validation:** the client SHALL build every message, which keeps its own `id` and `time`. The edge SHALL validate each inbound message against profile 2.0, its registered payload schema and the 256 KiB cap, with its clock, and SHALL refuse a failing one with the validator's code (`invalid-message`, `too-large`, `unknown-schema`, `unsupported-version` or `expired`) before it reaches the bus.
- **Subscriptions:** `subscribe` SHALL resolve only once the edge has registered the subscription.
- **A slow consumer:** the edge SHALL wait for a connection's socket to drain before it writes the next message of a subscription, so a remote part that stops reading fills only its own subscriptions' bounded queues. Their drops SHALL be reported to `onError` as `capacity` and sent to the remote part as an overflow notice with the count.
- **Reconnects:** a client whose stream is lost SHALL reconnect, register its subscriptions, responders and sync owners again, and then tell each subscription of the gap with no count. Nothing missed SHALL be replayed.
- **Deadlines:** a remote requester's own deadline SHALL decide. A command still unanswered at its deadline SHALL be `uncertain-result`, and a sync request `unavailable`. The edge SHALL wait past the expiry before it gives up, so its late answer never reaches the requester first. A remote responder or owner SHALL ignore a command or sync request that reaches it past its expiry.
- **Close:** a remote participant SHALL be a participant whose `close` closes its sync copies first, so a first sync still under way resolves `cancelled`. A copy's withdrawn request SHALL drop its HTTP call, and the edge SHALL then take the request out of the owner's queue, so the owner never serves it. Every later call SHALL be refused with `invalid-state`.
- **Schedulers:** the client's deadlines and reconnect delays and the edge's waits SHALL run on an injectable scheduler, which defaults to `setTimeout`.
- **Sync answers:** the edge SHALL refuse a sync answer that has a state or `sync.completed` over 256 KiB with `too-large` and log it, so a first sync resolves `rejected` with that code and a later one ends the copy with `failed`.

#### Scenario: Credentials
- **WHEN** a call has no token or an ungranted one, or a granted token publishes another source's message
- **THEN** it is refused with `unauthenticated` or `forbidden` in the error body, and no token appears in the messages, log records and error bodies the test captured

#### Scenario: A refused message
- **WHEN** a remote part sends a message whose payload fails its schema, one over 256 KiB, one of an unregistered family, a call body over the call limit or a body that is not JSON
- **THEN** the edge refuses it with `invalid-message`, `too-large`, `unknown-schema`, `too-large` or `invalid-request`, and the message never reaches the bus

#### Scenario: An expired sync request at the edge
- **WHEN** a sync request reaches the edge past its expiry
- **THEN** it is refused with `expired`

#### Scenario: A reconnect resyncs without replay
- **WHEN** a remote copy's stream is lost while the owner changes a session, removes another and a turn ends
- **THEN** after the reconnect each subscription hears of the gap with no count, the copy resyncs to the owner's current state with the removed session dropped, and the occurrence is not replayed

#### Scenario: A slow remote consumer
- **WHEN** a remote part stops reading its stream while 150 messages of 100 KB are published
- **THEN** another subscriber receives all 150, drops for the slow subscription go to `onError`, and once it reads again it receives an overflow notice with the count

#### Scenario: Deadlines on an injected scheduler
- **WHEN** a remote requester whose scheduler holds its callbacks sends a command with a one-minute deadline that nobody answers, and the test runs the scheduled deadline
- **THEN** the request resolves as `uncertain` at once

#### Scenario: A sync answer over the cap
- **WHEN** an owner's snapshot makes `sync.completed` larger than 256 KiB
- **THEN** a remote copy that syncs again ends with `failed` and `too-large`, a first sync resolves `rejected` with `too-large`, and the edge logs the refusal

### Requirement: One conformance suite for every transport

One conformance suite SHALL run the same SDK calls against the in-process bus and the remote transport. Where a transport must answer differently, it SHALL state its own expectation:
- a command still queued at its deadline is `expired` in process, where the bus takes it out of the queue;
- it is `uncertain-result` on the remote transport, because the requester cannot know whether the handler started.

#### Scenario: Both transports
- **WHEN** the suite runs against each transport
- **THEN** both pass the same cases:
  - routing by pattern, with messages delivered exactly as published;
  - prepared messages;
  - subscriptions live before `subscribe` resolves;
  - request and respond, with refusals in the error body on the caller's trace;
  - no responder, and both deadline cases;
  - sync, with an owner's refusal and the `unavailable` deadline;
  - an overflow count;
  - malformed calls;
  - a closed participant refusing every call with `invalid-state`;
  - a closing participant's first sync resolving `cancelled`, with its waiting request never reaching the owner.

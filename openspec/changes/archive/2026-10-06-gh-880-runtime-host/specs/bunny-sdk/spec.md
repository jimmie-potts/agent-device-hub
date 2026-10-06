## MODIFIED Requirements

### Requirement: Request and respond with expiry

One responder SHALL own each command key. A `respond` whose pattern overlaps another responder's SHALL be refused with `invalid-state`. `request` SHALL refuse with `invalid-request` a key outside `bunny.cmd`, a command type that does not end in `.requested`, a `timeoutMs` that is not an integer from 1 to 2147483647 and a `requestId` that is not an identifier. It SHALL send one command with a `requestId` in its payload and `expiresat` set `timeoutMs` after its `time`, and SHALL resolve with exactly one result, the reply or a result in its place; the command's outcome is a separate published message:
- `accepted`, with the reply message;
- `rejected`, with the shared error body: the responder's refusal, `internal` when the responder throws, `unavailable` when no responder owns the key or it closed before the command reached it, `capacity` when its queue is full, `expired` when the command never reached the responder's handler before its expiry, or `cancelled` when the requester closed before the handler started the command;
- `uncertain`, with `uncertain-result`, when the responder's handler had the command when the deadline passed or the requester closed.

At the deadline, the SDK SHALL take a command that is still waiting in the responder's queue out of that queue and resolve its request as `rejected` with `expired`. The SDK SHALL never send a command again and SHALL ignore a reply that arrives after the deadline. Every error body in a result SHALL carry the `requestId` and the command's trace ID. A responder SHALL handle one command at a time. It SHALL ignore a command whose expiry has passed, at or after `expiresat`, send no reply to it and resolve its request as `rejected` with `expired` unless the request has already settled.

#### Scenario: An accepted request
- **WHEN** a responder accepts a command
- **THEN** the requester gets `accepted` with a reply of kind `reply` from the responder's source, whose type ends in `.replied` and whose payload names the command's `requestId`, and both messages validate against profile 2.0

#### Scenario: A refusal in the shared error body
- **WHEN** a responder returns an error body, or throws
- **THEN** the requester gets `rejected` with that body, or with `internal` after the error is reported to `onError`, and the error carries the `requestId` and trace ID

#### Scenario: No responder
- **WHEN** a request names a key that no responder owns
- **THEN** it resolves at once as `rejected` with the retryable code `unavailable`

#### Scenario: A full responder queue
- **WHEN** a request reaches a responder whose queue already holds `maxQueued` waiting commands
- **THEN** it resolves at once as `rejected` with the retryable code `capacity`, carrying its `requestId` and trace ID

#### Scenario: A responder closes with commands waiting
- **WHEN** a responder closes while one command is being handled and another waits
- **THEN** the waiting request resolves as `rejected` with `unavailable`, carrying its `requestId` and trace ID, and the command being handled still gets its reply

#### Scenario: A malformed request
- **WHEN** a request uses a key outside `bunny.cmd`, a command type that does not end in `.requested`, a `timeoutMs` that is zero, negative, fractional, not finite or above 2147483647, or a `requestId` that is not an identifier
- **THEN** it is refused with `invalid-request`

#### Scenario: A deadline recorded as uncertain
- **WHEN** the responder's handler has a command and no reply arrives before the deadline
- **THEN** the request stays pending until the deadline, then resolves as `uncertain` with `uncertain-result`, which is not retryable; a later reply changes nothing, and the responder receives the command only once

#### Scenario: A command still queued at its deadline
- **WHEN** a command waits behind another command in a responder's queue until its deadline passes
- **THEN** its request resolves as `rejected` with the non-retryable code `expired`, carrying its `requestId` and trace ID, the command leaves the queue, which then has room for another, and the responder's handler never receives it

#### Scenario: An expired command is ignored
- **WHEN** a command reaches the responder exactly at its expiry
- **THEN** the responder's handler never receives it, its request resolves at once as `rejected` with `expired`, and the responder still handles later commands

#### Scenario: One owner per key
- **WHEN** a second responder registers a pattern that overlaps the first responder's
- **THEN** it is refused with `invalid-state`, and it can register after the first responder closes

### Requirement: Per-subscriber delivery

Each subscription and each responder SHALL have its own queue, which delivers one message at a time in publish order. A slow handler SHALL delay only its own queue, never the sender, other subscribers or requests. `publish` SHALL NOT wait for any handler, and no handler SHALL run inside the sender's call. Each queue SHALL hold at most `maxQueued` waiting messages, 1024 by default; a `maxQueued` that is not a positive integer SHALL throw `RangeError`. When a subscription's queue is full, a new message SHALL be dropped for that subscription only, and `onError` SHALL receive an `SdkError` with code `capacity`. When a responder's queue is full, the requester SHALL get a `rejected` result with `capacity` instead. A subscription MAY pass `onOverflow`: after its full queue dropped one or more messages, the SDK SHALL call `onOverflow` with the number dropped since it was last told, in the subscription's order and before the next message is delivered, and `onError` SHALL still receive each `capacity` report. The notice says that messages were dropped, not where: messages queued before the drop MAY be delivered after it. An `onOverflow` that throws SHALL be reported to `onError`, and delivery SHALL go on. A handler that throws SHALL be reported to `onError` and SHALL keep receiving. Without an `onError`, each report SHALL become a `BunnySdkWarning` process warning whose message names the source and pattern, with the original error as its `cause`. Closing a subscription SHALL drop its waiting messages and resolve when its running handler finishes. Called from that handler's own async flow while it runs, it SHALL resolve without waiting for it. Called from any other flow, including another subscription's handler or a continuation that a finished delivery of the same subscription left behind, it SHALL wait for the running handler.

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

## ADDED Requirements

### Requirement: Participant close

`connect` SHALL return a participant whose `close` closes everything that participant opened. It SHALL first refuse every later call on the participant with `invalid-state`. It SHALL then settle each of the participant's requests that is still waiting for a result: a request whose command still waits in a responder's queue SHALL have that command taken out and resolve as `rejected` with `cancelled`, and a request whose command the responder's handler has SHALL resolve as `uncertain` with `uncertain-result`. Their deadlines SHALL be cancelled. It SHALL then close each subscription and responder the participant opened, as their own close does, and resolve when the participant's running handlers have finished. It SHALL NOT wait for another participant's handler. Closing again SHALL return the same promise.

#### Scenario: Subscriptions and responders close
- **WHEN** a participant with subscriptions and a responder closes
- **THEN** no later message reaches its subscriptions, a request to its key resolves as `rejected` with `unavailable`, and another participant can then respond to that key

#### Scenario: Pending requests settle and leave no deadline
- **WHEN** a participant closes with one command being handled by another participant's responder and another command waiting behind it
- **THEN** the waiting request resolves as `rejected` with `cancelled` and its command never reaches the responder, the handled request resolves as `uncertain` with `uncertain-result`, both carry their `requestId` and trace ID, and no deadline timer remains

#### Scenario: Later calls are refused
- **WHEN** a closed participant publishes, subscribes, requests or responds
- **THEN** each call is refused with `invalid-state`, and closing it again resolves

#### Scenario: The close waits only for the participant's own handlers
- **WHEN** a participant closes while its own handler awaits a request to another participant whose responder is blocked
- **THEN** that request resolves as `uncertain`, the handler finishes, and the close resolves while the other responder is still blocked; a participant whose own handler is blocked on something else closes only after that handler finishes

#### Scenario: A handler closes its own participant
- **WHEN** a participant's handler closes that participant and waits for the close
- **THEN** the close resolves, the handler finishes, and no later message reaches it

### Requirement: Injected clock and scheduler

The bus SHALL take its clock from `now` and run request deadlines through an injected `scheduler`, whose `after(delayMs, callback)` returns a function that cancels the callback. Without them it SHALL use `Date.now()` and the global `setTimeout`. A reply, a refusal or a participant's close SHALL cancel the request's deadline on that scheduler.

#### Scenario: Deadlines follow the injected scheduler
- **WHEN** a bus has an injected clock and scheduler and a request with a 1000 ms timeout is sent
- **THEN** its `expiresat` is 1000 ms after the injected clock's time, its deadline waits on the injected scheduler, the request resolves as `uncertain` only when that scheduler reaches the deadline, and a later request's reply leaves no deadline on it

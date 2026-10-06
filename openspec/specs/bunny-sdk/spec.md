# bunny-sdk Specification

## Purpose
Define the SDK's in-process bus under ADR 0012: publish and subscribe by routing key, request and respond with expiry and the shared error body, per-subscriber delivery with an overflow signal, participant close, injected clocks and schedulers, sync of a consumer's copy from its owner and W3C trace propagation. It also holds the module API that the runtime implements. It is a source library that the runtime and the remote transport build on, and it claims no running runtime, transport or device behavior.

## Requirements

### Requirement: Publish and subscribe by routing key

The SDK SHALL give each participant `publish` and `subscribe` on routing keys `bunny.<state|event|cmd>.<family>.<id>`. Each token SHALL be lowercase letters and digits, with single hyphens inside it. A subscription pattern SHALL be a key in which `*` stands for any one of the last three tokens. Each message kind SHALL use its own key class:
- state and removal messages use `bunny.state` keys;
- occurrence and outcome messages use `bunny.event` keys;
- commands use `bunny.cmd` keys, through request and respond only.

The SDK SHALL build each envelope with the participant's `source`, a new `id`, the current `time` and the fixed profile attributes. It SHALL pass the message to subscribers as the same plain object, without copying, serializing or validating it. A malformed key, pattern or kind SHALL be refused with an `SdkError` that carries the shared error body with code `invalid-request`; `connect` SHALL throw that error at once for a malformed source.

#### Scenario: Patterns select messages
- **WHEN** subscriptions exist on `bunny.state.session.*`, `bunny.*.session.s1`, `bunny.*.*.*` and `bunny.state.mode.wall`, and state, occurrence and removal messages for sessions s1 and s2 are published
- **THEN** each subscription receives exactly the messages whose keys match its pattern, in publish order, and the mode subscription receives none

#### Scenario: A published message follows profile 2.0
- **WHEN** a participant publishes a message
- **THEN** the returned message validates against profile 2.0 with the participant's source, and subscribers receive that same object

#### Scenario: A kind on the wrong key class
- **WHEN** a state or removal message is published on a `bunny.event` key, an occurrence or outcome on a `bunny.state` key or any message, an outcome included, on a `bunny.cmd` key, a subscription names `bunny.cmd`, or a responder names another class
- **THEN** the call is refused with `invalid-request`

#### Scenario: Malformed keys, patterns and sources
- **WHEN** a key has the wrong number of tokens, prefix, class, case or characters, a pattern uses a wildcard that is not a whole `*` token, or a source does not follow the profile
- **THEN** the call is refused with `invalid-request`

#### Scenario: A closed subscription
- **WHEN** a subscription is closed
- **THEN** it receives no later message

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
- **THEN** the responder's handler never receives it, its request resolves at once as `rejected` with `expired`, and the responder handles the next command

#### Scenario: One owner per key
- **WHEN** a second responder registers a pattern that overlaps the first responder's
- **THEN** it is refused with `invalid-state`, and it can register after the first responder closes

### Requirement: Per-subscriber delivery

Each subscription and each responder SHALL have its own queue, which delivers one message at a time in publish order. A slow handler SHALL delay only its own queue, never the sender, other subscribers or requests. `publish` SHALL NOT wait for any handler, and no handler SHALL run inside the sender's call. Each queue SHALL hold at most `maxQueued` waiting messages, 1024 by default; a `maxQueued` that is not a positive integer SHALL throw `RangeError`. When a subscription's queue is full, a new message SHALL be dropped for that subscription only, and `onError` SHALL receive an `SdkError` with code `capacity`. When a responder's queue is full, the requester SHALL get a `rejected` result with `capacity` instead. A subscription MAY pass `onOverflow`: after its full queue dropped one or more messages, the SDK SHALL call `onOverflow` with the number dropped since it was last told, in the subscription's order and before the next message is delivered, and `onError` SHALL still receive each `capacity` report. The notice says that messages were dropped, not where: messages queued before the drop MAY be delivered after it. An `onOverflow` that throws SHALL be reported to `onError`, and delivery SHALL go on. A handler that throws SHALL be reported to `onError` and SHALL keep receiving. Without an `onError`, each report SHALL become a `BunnySdkWarning` process warning whose message names the source and pattern, with the original error as its `cause`. Closing a subscription SHALL drop its waiting messages and resolve when its running handler finishes. Called from that handler's own async flow while it runs, it SHALL resolve without waiting for it. Called from any other flow, including another subscription's handler or a continuation that a finished delivery of the same subscription left behind, it SHALL wait for the running handler. Close detection thus follows the handler's async flow: a callback that an emitter created elsewhere invokes is not in that flow, and two handlers that await each other's close deadlock.

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

### Requirement: Trace context on every message

Every message SHALL carry a W3C version-00 `traceparent`. A message sent with a `parent` SHALL keep the parent's trace ID, flags and `tracestate` and get a new span ID. A reply SHALL continue its command's trace in the same way. Without a parent, or with a malformed or all-zero one, the message SHALL start a new trace with the sampled flag set and no `tracestate`.

#### Scenario: A new trace
- **WHEN** messages are published without a parent
- **THEN** each one starts its own trace with flags `01`, and subscribers receive the same `traceparent`

#### Scenario: A continued trace
- **WHEN** a handler publishes with the received message as its parent
- **THEN** the new message has the parent's trace ID, flags and `tracestate` and a different span ID

#### Scenario: A command and its reply
- **WHEN** a request is sent with a parent
- **THEN** the command and its reply carry the parent's trace ID with different span IDs, and an uncertain result names that trace ID

#### Scenario: A parent that is not adopted
- **WHEN** a parent has an all-zero trace or span ID, another version, uppercase hex digits or no valid shape
- **THEN** the message starts a new trace and carries no `tracestate`

### Requirement: Sync a consumer's copy from its owner

The SDK SHALL give each participant `sync(families, handler, {timeoutMs, maxBuffered, parent})`, which keeps a copy of one owner's families. It SHALL subscribe to `bunny.state.<family>.*` for each family before it sends any sync request of kind `sync-request` with a `requestId`, the families and `expiresat` set `timeoutMs` after its `time`, even when an overflow comes first. An entity SHALL be a state's schema family and `data.id`, or a removal's `data.entity`, at its `data.revision`.

Until the owner answers, live messages SHALL wait in a buffer of at most `maxBuffered` messages, 1024 by default. On the answer, the copy SHALL first take the owner's states. It SHALL then drop each held entity that is not a member and is at or below the sync revision, and apply each buffered message above the revision in order. Only then SHALL the handler be told about each change in that order: `updated`, `removed` and `synced`, so that when `synced` is told the copy has applied the snapshot and every buffered message above its revision. A change applied to the copy SHALL always be told, unless the copy was closed first.

After a sync, the copy SHALL apply live messages in order, with the same buffer bound while its handler catches up. It SHALL drop a duplicate, a revision older than the one it holds, anything at or below the sync revision, and a state at or below the revision of a removal it applied. A live message that names no entity of the synced families SHALL be reported to `onError` and ignored.

A buffer overflow, or a message dropped on one of the copy's subscriptions, SHALL make the copy want a new sync, and a served answer to a request sent before the latest overflow SHALL NOT be applied; a refusal still ends the first sync or the copy. Each such overflow SHALL be reported to the bus's `onSyncRestart` with the copy's source and `sync <families>` as its pattern. A copy SHALL have at most one sync request outstanding: it SHALL send the next one only when no other is outstanding and its handler is not running.

`sync` SHALL resolve with the copy after its first sync. If that sync is refused, `sync` SHALL resolve as `rejected` with the shared error body instead. If it has not completed within `timeoutMs` of its first request, `sync` SHALL resolve as `rejected` with `unavailable`, naming the last request it sent; each later request of the first sync SHALL get only the time left. Only the first request SHALL join `parent`'s trace; a later request SHALL start its own. After that, a sync that cannot be served SHALL end the copy with a `failed` change; the copy SHALL keep its last records. A refused or failed copy SHALL follow nothing more, however many messages arrive. Closing a copy SHALL withdraw its outstanding request, and a first sync still under way SHALL resolve as `rejected` with `cancelled`. A request that the transport rejects or throws on SHALL be reported to `onError` and refused with `unavailable`. A family list that is empty, longer than 32, repeated, not made of family names or longer than 256 characters joined SHALL be refused with `invalid-request`. So SHALL a `timeoutMs` that is not an integer from 1 to 2147483647 and a `maxBuffered` that is not a positive integer.

#### Scenario: Current state, then live messages
- **WHEN** an owner holds two sessions and a consumer syncs, and the owner later updates one
- **THEN** the handler hears `updated` for each session and `synced` at the owner's revision, the request and `sync.completed` validate against profile 2.0 and continue the caller's trace, and the later update arrives as `updated`

#### Scenario: Buffered live messages apply above the sync revision
- **WHEN** live messages at and below the snapshot's revision, and others above it, arrive while the answer is on its way
- **THEN** nothing is applied before the answer, the messages at or below the revision are dropped, and those above it apply after `synced`, in order

#### Scenario: An entity above the sync revision survives the sync
- **WHEN** a copy holds a@5, starts a sync, receives y@15 live, and the sync completes at revision 14 with members [a]
- **THEN** the copy holds a@5 and y@15

#### Scenario: A removal during a sync stays removed
- **WHEN** a removal of y at 16 arrives during a sync that completes at 14 listing y, and a state of y at 15 arrives afterwards
- **THEN** y is removed, and the late state does not bring it back

#### Scenario: A buffer overflow restarts the sync
- **WHEN** more live messages arrive during a sync than the buffer holds
- **THEN** a new sync request is sent, nothing from the first answer is applied, and the copy matches the second answer

#### Scenario: A sync replaces membership
- **WHEN** a copy holds a and b, b's removal is dropped by its full queue, and the next sync's members are [a]
- **THEN** the handler hears that b was removed without a removal message, and the copy holds only a

#### Scenario: A delivery-queue overflow restarts the sync
- **WHEN** the copy's subscription drops an update because its queue is full
- **THEN** the copy sends a new sync request and ends with the dropped update's state, not the older one

#### Scenario: A refused first sync
- **WHEN** the owner refuses the first sync with an error body
- **THEN** `sync` resolves as `rejected` with that body, its `requestId` and the caller's trace ID, the handler hears nothing, and later live messages do not reach it

#### Scenario: A later sync that cannot be served
- **WHEN** the owner stops serving and the copy's subscription then drops a message
- **THEN** the handler hears `failed` with `unavailable`, and the copy follows nothing more but keeps its last records

#### Scenario: Duplicates and stale revisions
- **WHEN** a synced copy receives a repeated state, older states, a state at or below the sync revision, a removal, a state older than that removal and the removal again
- **THEN** only the newer state and the first removal change the copy

#### Scenario: No replay
- **WHEN** an owner published occurrences and removed a session before a consumer syncs, and publishes another occurrence during the sync
- **THEN** the handler hears only the current state and `synced`

#### Scenario: A stalled handler
- **WHEN** a copy's handler stalls while 49 messages arrive, 46 more than its buffer of 3 holds
- **THEN** the owner receives no more than one further sync request, and once the handler returns it hears the resync rather than each buffered message

#### Scenario: A second consumer while another copy overflows
- **WHEN** one copy's buffer overflows again and again while the owner serves its request, and a second consumer then syncs
- **THEN** the second consumer is served next, and the first copy replaces its request once

#### Scenario: A copy's own requests and the owner's queue
- **WHEN** the owner's queue holds at most one waiting request and a copy overflows several times while its request is served
- **THEN** the copy completes its sync, never refused with `capacity` by its own requests

#### Scenario: A first sync that keeps overflowing
- **WHEN** two answers to a copy's first sync each arrive 400 ms after more live messages than its buffer holds, and a third never arrives
- **THEN** the third request gets only the 200 ms left, and `sync` resolves as `rejected` with the retryable `unavailable` at 1000 ms

#### Scenario: A first sync out of time
- **WHEN** the only answer to a first sync arrives at its deadline after an overflow
- **THEN** no further request is sent, and `sync` resolves as `rejected` with `unavailable` naming the request that was sent

#### Scenario: Subscriptions before any request
- **WHEN** a copy of two families sees an overflow on the first while the second is still subscribing
- **THEN** no request is sent until the second subscription exists, and then exactly one is

#### Scenario: Only the first request joins the caller's trace
- **WHEN** a copy synced with a parent trace syncs again after an overflow
- **THEN** the first request carries the parent's trace ID and the second starts a new trace

#### Scenario: A refused copy stays stopped
- **WHEN** an owner refuses a first sync, or a later sync fails, and more messages than the buffer holds then arrive while an owner serves
- **THEN** no further sync request is sent and the handler hears nothing more

#### Scenario: A snapshot older than the copy
- **WHEN** a copy applied a@5 live and a later sync answers with a cached snapshot at revision 3 that lacks a
- **THEN** the copy keeps a@5

#### Scenario: Closing during a change
- **WHEN** a copy is closed while its handler runs on the first of several changes from one answer
- **THEN** the close resolves after that handler returns, and the remaining changes are not told

#### Scenario: A message without an entity
- **WHEN** a live message on a synced family's key has no schema identifier
- **THEN** it is reported to `onError` with the copy's source and ignored, and later messages still apply

#### Scenario: A transport that fails
- **WHEN** the transport's sync request rejects, or throws
- **THEN** the error is reported, and `sync` resolves as `rejected` with `unavailable` naming the request

#### Scenario: Hub #842's reference scenarios
- **WHEN** each of the eight sync, removal and expiry scenarios in `fixtures/v2/families.json` is fed to SDK copies as a transport would deliver it
- **THEN** the copies hold exactly the entities the scenario expects

#### Scenario: A malformed sync call
- **WHEN** a sync names no family, a repeated or malformed family, more than 32 families or more than 256 characters of them joined, or has a bad `timeoutMs` or `maxBuffered`
- **THEN** it is refused with `invalid-request`

### Requirement: Serve sync from the owner's current state

The SDK SHALL give each participant `serveSync(families, provider)`. One owner SHALL serve each family; a `serveSync` naming a family that another owner serves SHALL be refused with `invalid-state`, and an empty, repeated or malformed family list with `invalid-request`. An owner MAY serve any number of families; the request caps apply only to one sync request. The owner SHALL handle one sync request at a time and SHALL ignore a request at or past its expiry. A request still waiting in the owner's queue at its deadline, or withdrawn, SHALL leave the queue, so the owner never serves it; one at its deadline SHALL still be refused with `unavailable`, never `expired`, because a sync changes nothing and asking again is safe. The provider SHALL receive the request and return `{revision, states}`, one state draft per entity, or an error body. The SDK SHALL send each state as a state message from the owner, then `sync.completed` with the `requestId`, the revision and the members. It SHALL send them straight to the requester, never to subscribers, continuing the request's trace.

A sync request SHALL be refused in the shared error body, naming its `requestId` and trace ID, with no `sync.completed`:
- with the provider's error body;
- `internal` when the provider throws, or its snapshot holds a state outside the requested families, without an entity ID or above the snapshot's revision, has a revision that is not a whole number from 0, or holds more than 4096 states; the error SHALL also go to `onError`;
- `unavailable` when no owner serves a family, the owner closed before serving it, no answer came by the deadline, or the transport failed to send it;
- `cancelled` when the requester's copy or participant closed before the answer came;
- `capacity` when the owner's queue already holds `maxQueued` waiting requests;
- `invalid-request` when the families belong to more than one owner.

#### Scenario: A sync nobody can serve
- **WHEN** a sync names a family that no owner serves, or the owner's provider throws or returns a snapshot that does not fit the request
- **THEN** it resolves as `rejected` with `unavailable` or `internal`, and each provider failure is reported to `onError` with the owner's source

#### Scenario: An owner closes or is full
- **WHEN** an owner is serving one request, a second waits, a third arrives and the owner then closes
- **THEN** the third is refused with `capacity`, the second with `unavailable`, and the first still gets its answer

#### Scenario: A deadline and an expired request
- **WHEN** the owner is busy past one request's deadline and then answers a request whose own deadline passed while it waited
- **THEN** each request resolves as `unavailable` at its deadline, a late answer changes nothing, and the provider never receives the expired request

#### Scenario: A sync request still queued at its deadline
- **WHEN** a sync request waits behind another in an owner's queue of one until its deadline passes
- **THEN** it resolves as `rejected` with the retryable `unavailable`, naming its `requestId` and trace ID, the next request queues in the room it left instead of being refused with `capacity`, and the provider never receives it

#### Scenario: A restart is reported
- **WHEN** a synced copy's delivery queue drops a message and the copy syncs again
- **THEN** `onSyncRestart` receives the copy's source and `sync <families>` once, and the first sync was not reported

#### Scenario: One owner per family
- **WHEN** a second owner serves a family that one owner already serves, a sync names families of two owners, or an owner serves 38 families
- **THEN** the first is refused with `invalid-state` and the second resolves as `rejected` with `invalid-request`, while the owner of 38 families and a sync of one owner's families succeed

### Requirement: Participant close

`connect` SHALL return a participant whose `close` closes everything that participant opened. It SHALL first refuse every later call on the participant with `invalid-state`. It SHALL then settle each of the participant's requests that is still waiting for a result: a request whose command still waits in a responder's queue SHALL have that command taken out and resolve as `rejected` with `cancelled`, and a request whose command the responder's handler has SHALL resolve as `uncertain` with `uncertain-result`. Their deadlines SHALL be cancelled. It SHALL then close each subscription, responder, sync copy and sync owner the participant opened, as their own close does; a copy SHALL withdraw its outstanding sync request and cancel its deadline. It SHALL resolve when the participant's running handlers have finished, and SHALL NOT wait for another participant's handler. Closing again SHALL return the same promise.

#### Scenario: Subscriptions and responders close
- **WHEN** a participant with subscriptions and a responder closes
- **THEN** no later message reaches its subscriptions, a request to its key resolves as `rejected` with `unavailable`, and another participant can then respond to that key

#### Scenario: Pending requests settle and leave no deadline
- **WHEN** a participant closes with one command being handled by another participant's responder and another command waiting behind it
- **THEN** the waiting request resolves as `rejected` with `cancelled` and its command never reaches the responder, the handled request resolves as `uncertain` with `uncertain-result`, both carry their `requestId` and trace ID, and no deadline timer remains

#### Scenario: Sync copies close and their requests are withdrawn
- **WHEN** a participant closes with a synced copy, a copy whose first sync is being served and a copy whose first sync waits in the owner's queue
- **THEN** both first syncs resolve as `rejected` with `cancelled`, no sync deadline remains on the scheduler, the synced copy follows nothing more, and the owner never receives the waiting request

#### Scenario: Sync owners close
- **WHEN** a participant that serves sync closes while one request is being served and another waits
- **THEN** the waiting request resolves as `rejected` with `unavailable` and "the owner closed", the one being served still syncs, another participant can then serve the family, and the closed participant's `sync` and `serveSync` are refused with `invalid-state`

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

The bus SHALL take its clock from `now` and run request and sync deadlines through an injected `scheduler`, whose `after(delayMs, callback)` returns a function that cancels the callback. Without them it SHALL use `Date.now()` and the global `setTimeout`. A reply, a refusal or a participant's close SHALL cancel the request's deadline on that scheduler.

#### Scenario: Deadlines follow the injected scheduler
- **WHEN** a bus has an injected clock and scheduler and a request with a 1000 ms timeout is sent
- **THEN** its `expiresat` is 1000 ms after the injected clock's time, its deadline waits on the injected scheduler, the request resolves as `uncertain` only when that scheduler reaches the deadline, and a later request's reply leaves no deadline on it

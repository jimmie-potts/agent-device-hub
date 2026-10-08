# bunny-sdk Specification

## Purpose
Define the SDK's in-process bus under ADR 0012: publish and subscribe by routing key, request and respond with expiry and the shared error body, per-subscriber delivery with an overflow signal, participant close, injected clocks and schedulers, sync of a consumer's copy from its owner, W3C trace propagation, and an SSE/HTTP remote transport that carries the same calls to remote parts. It also holds the module API that the runtime implements, the module manifest checks, the per-module outbox that keeps each outcome until the core acknowledges it, and the module test kit that every module runs. It is a source library that the runtime builds on, and it claims no running runtime, installed edge or device behavior.

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

One responder SHALL own each command key. A `respond` whose pattern overlaps another responder's SHALL be refused with `invalid-state`. `request` SHALL refuse with `invalid-request` a key outside `bunny.cmd`, a command type that does not end in `.requested`, a `timeoutMs` that is not an integer from 1 to `MAX_TIMEOUT_MS`, 86400000 (one day), and a `requestId` that is not an identifier. It SHALL send one command with a `requestId` in its payload and `expiresat` set `timeoutMs` after its `time`, and SHALL resolve with exactly one result, the reply or a result in its place; the command's outcome is a separate published message:
- `accepted`, with the reply message;
- `rejected`, with the shared error body, only when the command had no effect: the responder's typed refusal, a valid error body it returned from `errorBody`, `unavailable` when no responder owns the key or it closed before the command reached it, `capacity` when its queue is full, `expired` when the command never reached the responder's handler before its expiry, or `cancelled` when the requester closed before the handler started the command;
- `uncertain`, with `uncertain-result`, once the responder's handler had the command: when the handler throws, an `SdkError` from a call it makes included, or answers with something other than a valid reply, and when the handler still had the command when the deadline passed or the requester closed.

A valid refusal SHALL carry a registered code with that code's `retryable` flag. The SDK SHALL rebuild it with at most 1024 characters of detail and nothing else, and SHALL treat an error body with an unregistered code, the wrong flag or no code as no reply.

A handler's exception SHALL be reported to `onError`, its request SHALL get no reply message, and the error body SHALL carry the fixed detail `the responder failed after it started`, never the exception's message.

At the deadline, the SDK SHALL take a command that is still waiting in the responder's queue out of that queue and resolve its request as `rejected` with `expired`. The SDK SHALL never send a command again and SHALL ignore a reply that arrives after the deadline. Every error body in a result SHALL carry the `requestId` and the command's trace ID. A responder SHALL handle one command at a time. It SHALL ignore a command whose expiry has passed, at or after `expiresat`, send no reply to it and resolve its request as `rejected` with `expired` unless the request has already settled.

#### Scenario: An accepted request
- **WHEN** a responder accepts a command
- **THEN** the requester gets `accepted` with a reply of kind `reply` from the responder's source, whose type ends in `.replied` and whose payload names the command's `requestId`, and both messages validate against profile 2.0

#### Scenario: A refusal in the shared error body
- **WHEN** a responder returns an error body
- **THEN** the requester gets `rejected` with that body in a reply message, and the error carries the `requestId` and trace ID

#### Scenario: A responder that fails once it started
- **WHEN** a responder throws before or after its effect, throws the `SdkError` of a nested SDK call, returns something other than a reply, or returns an error body with an unregistered code, the wrong flag or no code
- **THEN** each request resolves as `uncertain` with `uncertain-result`, its `requestId`, its trace ID and the fixed detail, with no reply message; each error is reported to `onError` once; and the handler received each command exactly once, with nothing sent again after every deadline has passed

#### Scenario: A refusal rebuilt in process
- **WHEN** a responder in process refuses with a registered code, a 5000-character detail and an extra field
- **THEN** the requester gets `rejected` with that code, the detail cut to 1024 characters and no extra field, in a reply that follows profile 2.0

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
- **WHEN** a request uses a key outside `bunny.cmd`, a command type that does not end in `.requested`, a `timeoutMs` that is zero, negative, fractional, not finite or above `MAX_TIMEOUT_MS`, or a `requestId` that is not an identifier
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

### Requirement: Trace context on every message

Every message SHALL carry a W3C version-00 `traceparent` and no `tracestate`, which profile 2.0 does not define. A message sent with a `parent` SHALL keep the parent's trace ID and flags and get a new span ID; a `tracestate` that the parent carries SHALL NOT be passed on. A reply SHALL continue its command's trace in the same way. Without a parent, or with a malformed or all-zero one, the message SHALL start a new trace with the sampled flag set.

#### Scenario: A new trace
- **WHEN** messages are published without a parent
- **THEN** each one starts its own trace with flags `01`, and subscribers receive the same `traceparent`

#### Scenario: A continued trace
- **WHEN** a handler publishes with the received message as its parent
- **THEN** the new message has the parent's trace ID and flags and a different span ID, and no `tracestate`, even when the parent carried one

#### Scenario: A command and its reply
- **WHEN** a request is sent with a parent
- **THEN** the command and its reply carry the parent's trace ID with different span IDs, and an uncertain result names that trace ID

#### Scenario: A parent that is not adopted
- **WHEN** a parent has an all-zero trace or span ID, another version, uppercase hex digits or no valid shape
- **THEN** the message starts a new trace and carries no `tracestate`

#### Scenario: Only traceparent is passed on
- **WHEN** `childOf` is given a parent that carries `tracestate`, and a message that carries `tracestate` is validated
- **THEN** the child context holds only `traceparent`, in the parent's trace, and the message is refused with `invalid-message` naming `tracestate` as an undeclared attribute

### Requirement: Sync a consumer's copy from its owner

The SDK SHALL give each participant `sync(families, handler, {timeoutMs, maxBuffered, parent, owner})`, which keeps a copy of one owner's families. `owner`, when given, SHALL be the owning participant's source, such as `bunny/modules/lifx`: every sync request of the copy SHALL go to that owner, and a served answer whose `sync.completed` comes from another source SHALL be refused with `unavailable`, which ends a first sync or the copy. A copy without `owner` SHALL send each request to its families' only owner and SHALL follow the owner whose `sync.completed` first served it; a later served answer from another source SHALL be refused with `unavailable`, which ends the copy, so a copy never holds two owners' records. Every copy SHALL follow only the live messages whose `source` is the owner it follows: another source's state or removal on a synced family SHALL NOT change the copy or be reported to `onError`, a named copy SHALL NOT buffer it, and a message that waited in the buffer from another source than the owner that served the answer SHALL NOT be applied. It SHALL subscribe to `bunny.state.<family>.*` for each family before it sends any sync request of kind `sync-request` with a `requestId`, the families and `expiresat` set `timeoutMs` after its `time`, even when an overflow comes first. An entity SHALL be a state's schema family and `data.id`, or a removal's `data.entity`, at its `data.revision`.

Until the owner answers, live messages SHALL wait in a buffer of at most `maxBuffered` messages, 1024 by default. On the answer, the copy SHALL first take the owner's states. It SHALL then drop each held entity that is not a member and is at or below the sync revision, and apply each buffered message above the revision in order. Only then SHALL the handler be told about each change in that order: `updated`, `removed` and `synced`, so that when `synced` is told the copy has applied the snapshot and every buffered message above its revision. A change applied to the copy SHALL always be told, unless the copy was closed first.

After a sync, the copy SHALL apply live messages in order, with the same buffer bound while its handler catches up. It SHALL drop a duplicate, a revision older than the one it holds, anything at or below the sync revision, and a state at or below the revision of a removal it applied. A live message from the owner the copy follows that names no entity of the synced families SHALL be reported to `onError` and ignored.

A buffer overflow, or a message dropped on one of the copy's subscriptions, SHALL make the copy want a new sync, and a served answer to a request sent before the latest overflow SHALL NOT be applied; a refusal still ends the first sync or the copy. Each such overflow SHALL be reported to the bus's `onSyncRestart` with the copy's source and `sync <families>` as its pattern. A copy SHALL have at most one sync request outstanding: it SHALL send the next one only when no other is outstanding and its handler is not running.

`sync` SHALL resolve with the copy after its first sync. If that sync is refused, `sync` SHALL resolve as `rejected` with the shared error body instead. If it has not completed within `timeoutMs` of its first request, `sync` SHALL resolve as `rejected` with `unavailable`, naming the last request it sent; each later request of the first sync SHALL get only the time left. Only the first request SHALL join `parent`'s trace; a later request SHALL start its own. After that, a sync that cannot be served SHALL end the copy with a `failed` change; the copy SHALL keep its last records. A refused or failed copy SHALL follow nothing more, however many messages arrive. Closing a copy SHALL withdraw its outstanding request, and a first sync still under way SHALL resolve as `rejected` with `cancelled`. A copy closed while it is still subscribing to its families SHALL make no further subscription and SHALL close the one it was making. A request that the transport rejects or throws on SHALL be reported to `onError` and refused with `unavailable`. A family list that is empty, longer than 32, repeated, not made of family names or longer than 256 characters joined SHALL be refused with `invalid-request`. So SHALL a `timeoutMs` that is not an integer from 1 to `MAX_TIMEOUT_MS`, a `maxBuffered` that is not a positive integer, and an `owner` that is not a participant source, before any request is sent.

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
- **WHEN** a live message from the copy's owner on a synced family's key has no schema identifier, and another source publishes such a message too
- **THEN** the owner's is reported to `onError` with the copy's source and ignored, the other source's is ignored without a report, and later messages still apply

#### Scenario: A transport that fails
- **WHEN** the transport's sync request rejects, or throws
- **THEN** the error is reported, and `sync` resolves as `rejected` with `unavailable` naming the request

#### Scenario: Hub #842's reference scenarios
- **WHEN** each of the eight sync, removal and expiry scenarios in `fixtures/v2/families.json` is fed to SDK copies as a transport would deliver it
- **THEN** the copies hold exactly the entities the scenario expects

#### Scenario: A malformed sync call
- **WHEN** a sync names no family, a repeated or malformed family, more than 32 families or more than 256 characters of them joined, or has a bad `timeoutMs`, `maxBuffered` or `owner`, on either transport
- **THEN** it is refused with `invalid-request`, and no owner receives a request

#### Scenario: Each owner of one family by name
- **WHEN** two owners serve `device`, one over the transport under test and one on the bus, a consumer syncs `device` from each by name, and then each owner publishes a device update, and the second owner publishes a removal of the first owner's device
- **THEN** on both transports each copy holds only its owner's devices, its `sync.completed` comes from that owner and lists only them, each copy applies only its own owner's updates, the removal changes neither copy, and nothing is reported to `onError`

#### Scenario: Another owner's traffic and a named copy's buffer
- **WHEN** a copy that names its owner and holds at most two buffered messages waits for its first answer while another owner of the family publishes five messages and its own owner publishes one
- **THEN** the copy applies its owner's snapshot and update, restarts no sync, and its owner receives one request

#### Scenario: A copy that names no owner and a second owner
- **WHEN** a copy without an owner has synced `device` at revision 5 from its only owner, a second owner then serves `device` and publishes its own device at revisions 3 and 7 and a removal of the first owner's device, and the first owner publishes an update
- **THEN** on both transports the copy holds only the first owner's device, at its update, and nothing is reported to `onError`

#### Scenario: A copy without an owner whose resync another owner answers
- **WHEN** a copy without an owner has synced `device` at revision 10 from its only owner, its handler stalls while more updates arrive than its buffer holds, its owner then stops serving and a second owner serves `device` alone at revision 2, and the handler returns
- **THEN** on both transports the copy's resync, which the second owner answers, is refused with `unavailable`, the handler hears `failed` with `unavailable`, and the copy keeps its first owner's last record and holds none of the second owner's

#### Scenario: Another owner's messages buffered during a first sync
- **WHEN** a copy without an owner waits for its only owner's answer while a second owner starts serving `device` and publishes, and its own owner publishes an update
- **THEN** the copy applies its owner's snapshot and update and not the second owner's message

#### Scenario: An answer from another owner
- **WHEN** a named copy's first answer comes from another owner, and another named copy's resync after an overflow is answered by another owner
- **THEN** the first resolves as `rejected` with `unavailable`, its `requestId`, the caller's trace ID and a detail naming both owners, and its handler hears nothing; the second copy's handler hears `failed` with `unavailable`

#### Scenario: A named copy's later requests
- **WHEN** an overflow restarts the sync of a copy that names its owner, and a copy that names none syncs
- **THEN** both requests of the first copy name that owner, and the second copy's request carries no owner

### Requirement: Participant close

`connect` SHALL return a participant whose `close` closes everything that participant opened. It SHALL first refuse every later call on the participant with `invalid-state`. It SHALL then settle each of the participant's requests that is still waiting for a result: a request whose command still waits in a responder's queue SHALL have that command taken out and resolve as `rejected` with `cancelled`, and a request whose command the responder's handler has SHALL resolve as `uncertain` with `uncertain-result`. Their deadlines SHALL be cancelled. It SHALL then close each subscription, responder, sync copy and sync owner the participant opened, as their own close does; a copy SHALL withdraw its outstanding sync request and cancel its deadline, and the participant SHALL refuse any subscription a copy still asks for. It SHALL resolve when the participant's running handlers have finished, and SHALL NOT wait for another participant's handler. Closing again SHALL return the same promise.

#### Scenario: Subscriptions and responders close
- **WHEN** a participant with subscriptions and a responder closes
- **THEN** no later message reaches its subscriptions, a request to its key resolves as `rejected` with `unavailable`, and another participant can then respond to that key

#### Scenario: Pending requests settle and leave no deadline
- **WHEN** a participant closes with one command being handled by another participant's responder and another command waiting behind it
- **THEN** the waiting request resolves as `rejected` with `cancelled` and its command never reaches the responder, the handled request resolves as `uncertain` with `uncertain-result`, both carry their `requestId` and trace ID, and no deadline timer remains

#### Scenario: Sync copies close and their requests are withdrawn
- **WHEN** a participant closes with a synced copy, a copy whose first sync is being served and a copy whose first sync waits in the owner's queue
- **THEN** both first syncs resolve as `rejected` with `cancelled`, no sync deadline remains on the scheduler, the synced copy follows nothing more, and the owner never receives the waiting request

#### Scenario: A participant closed while its sync subscribes
- **WHEN** a participant closes right after it begins a sync of four families, before the sync resolves
- **THEN** the sync resolves as `rejected` with `cancelled`, and a burst on every family queues nothing for the closed participant

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

- **Credentials:** each remote source SHALL have a bearer token, compared in constant time. The edge SHALL refuse at start a grant with a malformed source or a token that two grants share. A call without a granted token SHALL be refused with `unauthenticated`. A message or connection of another source SHALL be refused with `forbidden`, including a close, reply or sync answer on another source's connection. A token SHALL NOT appear in any message, diagnostic, log record or error body.
- **Validation:** the client SHALL build every message, which keeps its own `id` and `time`. The edge SHALL validate each inbound message against profile 2.0, its registered payload schema and the 256 KiB cap, with its clock, and SHALL refuse a failing one with the validator's code (`invalid-message`, `too-large`, `unknown-schema`, `unsupported-version` or `expired`) before it reaches the bus. It SHALL refuse a sync request whose subject is not its families joined by commas with `invalid-message`, and a call body over its limit with `too-large` without reading the rest. It SHALL rebuild a remote responder's or owner's refusal as the shared error body, with its registered code and at most 1024 characters of detail, and SHALL drop anything else it carried.
- **Subscriptions:** `subscribe` SHALL resolve only once the edge has registered the subscription.
- **A slow consumer:** the edge SHALL wait for a connection's socket to drain before it writes the next message of a subscription, so a remote part that stops reading fills only its own subscriptions' bounded queues. Their drops SHALL be reported to `onError` as `capacity` and sent to the remote part as an overflow notice with the count.
- **Reconnects:** a client whose stream is lost SHALL reconnect, queue a gap notice with no count for each subscription before any message of the new stream, register its subscriptions, responders and sync owners again, and only then deliver the notices. Nothing missed SHALL be replayed. It SHALL report the lost stream once to `onDiagnostic` as `remote.disconnected` at WARN and the recovery as `remote.reconnected` at INFO with the count of failed attempts, and SHALL NOT report each failed attempt to `onError`. A call that needs the stream and meets a lost one SHALL be refused with the retryable `unavailable`, and a registration that failed SHALL leave nothing at the edge.
- **A failed remote responder:** a remote responder whose handler throws, or answers with something other than a valid reply, SHALL report the error to its `onError` and answer the edge with `{"status": "uncertain"}`. The edge SHALL then settle the request `uncertain` with `uncertain-result` and the fixed detail, with no reply message, as in process; it SHALL NOT refuse it.
- **Safe errors:** the edge SHALL answer an exception it did not expect with `internal` and the fixed detail `the edge failed`. Once it has handed a command to its bus, it SHALL answer one with `uncertain-result` and the fixed detail `the edge failed after it sent the command` instead, because a handler may have run it. It SHALL report either once to `onDiagnostic` as `edge.failed` at ERROR with the code it answered, the route, the granted source if any and the exception's type, never as a refusal; after dispatch the record SHALL also carry the command's routing key, request ID, message ID and trace, as the bus's records of it do. A refusal's detail MAY quote what the caller sent, such as a path, a claimed source, an id or an attribute the validator refused. A refusal's diagnostic SHALL carry its code, never its detail. An exception's message, stack and cause SHALL NOT reach any response, diagnostic or log record.
- **Edge answers at the client:** the client SHALL take an edge refusal only with a registered code and that code's flag, and SHALL treat any other body as `internal`. It SHALL settle a command whose request call the edge answers with `internal` or `uncertain-result` as `uncertain` with `uncertain-result`, because the edge may have failed after the command reached a handler, and SHALL report that decision once to `onDiagnostic` as `remote.command.uncertain` at WARN, as it does when the edge cannot be heard or the requester closes first; any other refusal SHALL stay `rejected`, and the client SHALL NOT report it, since the edge does.
- **A dropped stream:** the edge SHALL NOT answer a forwarded command whose frame reached the socket as a refusal, whether its stream dropped, the edge closed or its own wait ran out. A reply that comes on the reconnected stream SHALL still reach the requester, matched by the forwarded command's message id, so a retry that reuses a `requestId` gets its own reply. Otherwise the request SHALL settle `uncertain` with `uncertain-result` and no reply message. A forwarded command whose frame never reached the socket, and a forwarded sync request, SHALL be refused with `unavailable`. A prepared command whose requester has already stopped waiting SHALL be refused with `cancelled` and never run.
- **Deadlines:** the deadline answers SHALL be those in process. The edge SHALL answer when its bus settles: `expired` for a command still queued at its deadline, `uncertain-result` for one a handler had, otherwise the reply, and `unavailable` for a sync request. A remote requester SHALL wait `REQUESTER_GRACE_MS` (1 s) past its deadline, on its scheduler, for that answer, and only then settle a command as `uncertain-result` and a sync as `unavailable`. An edge `expired` refusal of a remote part's own sync request SHALL reach it as the retryable `unavailable`. A remote responder or owner SHALL ignore a command or sync request that reaches it past its expiry.
- **Close:** a remote participant SHALL be a participant whose `close` returns the same promise every time. It SHALL first settle each request still waiting for the edge as `uncertain-result`, drop its call and cancel its deadline and the reconnect backoff; the edge SHALL then take a still-queued command out. It SHALL then close its sync copies, so a first sync still under way resolves `cancelled`; a copy's withdrawn request SHALL drop its HTTP call, and the edge SHALL take the request out of the owner's queue, so the owner never serves it. Every later call SHALL be refused with `invalid-state`.
- **Schedulers:** the client's deadlines and reconnect delays and the edge's waits SHALL run on an injectable scheduler, which defaults to `setTimeout`.
- **Sync answers:** the edge SHALL refuse a sync answer that has a state or `sync.completed` over 256 KiB with `too-large` and report the refusal, so a first sync resolves `rejected` with that code and a later one ends the copy with `failed`.

#### Scenario: Credentials
- **WHEN** a call has no token or an ungranted one, or a granted token publishes another source's message
- **THEN** it is refused with `unauthenticated` or `forbidden` in the error body, and no token appears in the messages, diagnostics and error bodies the test captured

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

#### Scenario: The edge's deadline answer, and a silent edge
- **WHEN** a remote requester's command is held by a handler past a 300 ms deadline, and another requester, whose scheduler holds its callbacks, sends a command with a one-minute deadline and the test runs its deadline plus grace
- **THEN** the first resolves as `uncertain-result` with the bus's own refusal, before the grace ends, and the second as `uncertain-result` because the edge did not answer

#### Scenario: A dropped stream while a remote handler holds a command
- **WHEN** a remote responder's stream drops while its handler holds a command
- **THEN** the requester gets `uncertain-result` at the deadline, never `unavailable`, and when the handler replies on the reconnected stream before the deadline, the requester gets that reply

#### Scenario: A held command at the edge's close or its own wait
- **WHEN** the edge closes while a remote handler holds a command, or the edge's own scheduler runs out the forward's wait before the bus's deadline
- **THEN** the request settles `uncertain` with `uncertain-result`, with no reply message

#### Scenario: A retry with a reused requestId
- **WHEN** a held command's stream drops, its request ends `uncertain-result`, the requester retries at once with the same `requestId`, and the held command then refuses late
- **THEN** the retry gets its own `accepted` reply

#### Scenario: A gap before the new stream's messages
- **WHEN** after a reconnect one subscription is registered again while another's registration is held, and a message for the first is published
- **THEN** the first subscription hears of the gap before that message

#### Scenario: Remote refusals rebuilt
- **WHEN** a remote responder or owner refuses with a registered code, a 5000-character detail and an extra field
- **THEN** the requester gets the shared error body with that code, the detail cut to 1024 characters and no extra field

#### Scenario: Security and cleanup checks
- **WHEN** a token acts on another source's connection, a remote responder and owner reconnect twice, a remote responder's clock is ahead, or a command reaches the edge past its expiry
- **THEN** the call is `forbidden`, the responder and owner still serve, the responder never sees the expired command, and the edge refuses it with `expired`

#### Scenario: A call on a lost stream
- **WHEN** a remote part registers a responder on a stream the edge has just dropped
- **THEN** the call is refused with the retryable `unavailable`, and after the reconnect the same key can be registered again

#### Scenario: A sync request's clock skew
- **WHEN** a remote part whose clock is ten minutes behind syncs
- **THEN** the sync resolves as `rejected` with the retryable `unavailable`

#### Scenario: Grants and close
- **WHEN** the edge is given grants with a shared token or a malformed source, or a remote participant closes during its reconnect backoff
- **THEN** the edge refuses the grants with `invalid-request` without naming the token, and nothing is left on the participant's scheduler

#### Scenario: A sync answer over the cap
- **WHEN** an owner's snapshot makes `sync.completed` larger than 256 KiB
- **THEN** a remote copy that syncs again ends with `failed` and `too-large`, a first sync resolves `rejected` with `too-large`, and the edge reports the refusal

#### Scenario: An exception inside the edge
- **WHEN** the edge throws while it answers a sync, with an exception whose message holds a synthetic secret
- **THEN** the remote part's sync and a raw call each get `internal` with the detail `the edge failed`, the edge reports each as one `edge.failed` diagnostic with `internal` and the exception's type and no `edge.refused`, and the secret reaches no response, diagnostic or reported error

#### Scenario: An edge failure after dispatch
- **WHEN** the edge's bus runs a remote part's command and the edge then fails while it answers
- **THEN** the requester gets `uncertain` with `uncertain-result` and the detail `the edge failed after it sent the command`, the handler ran the command once, the bus records the command's admission and reply, the edge reports one `edge.failed` with `uncertain-result` and the command's key, request ID, message ID and trace, and the client reports one `remote.command.uncertain`

#### Scenario: Edge answers outside the registry
- **WHEN** an edge answers a call with an unregistered code, the wrong flag or no code, or answers a command's request call with `internal`
- **THEN** the client reports the first three as `internal`, and settles the command as `uncertain` with `uncertain-result`, reporting `remote.command.uncertain`; an edge refusal such as `invalid-message` still makes the request `rejected`, with no client diagnostic

### Requirement: One conformance suite for every transport

One conformance suite SHALL run the same SDK calls against the in-process bus and the remote transport. A command still queued at its deadline SHALL be `expired` on both. Where a transport must answer differently, it SHALL state its own expectation: a closing participant's request whose command still waits in the responder's queue is `cancelled` in process, where the bus knows, and the command never runs; remotely it is `uncertain-result`, where the requester cannot know, and a command still queued when the edge sees the dropped call never runs.

#### Scenario: Both transports
- **WHEN** the suite runs against each transport
- **THEN** both pass the same cases:
  - routing by pattern, with messages delivered exactly as published;
  - prepared messages;
  - subscriptions live before `subscribe` resolves;
  - request and respond, with refusals in the error body on the caller's trace;
  - a responder that throws before or after its effect, throws a nested `SdkError`, answers with a non-reply or answers with a malformed refusal, leaving the request `uncertain-result` with no reply and its command handled once, with every deadline passed on an injected scheduler;
  - no responder, and both deadline cases;
  - sync, with an owner's refusal and the `unavailable` deadline;
  - an overflow count;
  - malformed calls;
  - a closed participant refusing every call with `invalid-state`;
  - a closing participant's first sync resolving `cancelled`, with its waiting request never reaching the owner;
  - a closing participant's waiting request settled, the command never running and a second close returning the same promise;
  - a sync request and its `sync.completed` naming the families, joined by commas;
  - a `timeoutMs` above `MAX_TIMEOUT_MS` refused with `invalid-request`.

### Requirement: Per-module outbox

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant and clock. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id`, `time` and trace context it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out, and `transaction` SHALL reject with it. The type of `work` SHALL refuse a promise, and work that returns one anyway SHALL roll back with a `TypeError`, leaving its promise handled. A database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. Once the work commits, `transaction` SHALL resolve with the work's result after the publish ends and SHALL NOT reject, so no caller takes a refused publish for a rollback and does the work again. If publishing is refused after the commit, the messages SHALL stay stored, unpublished, and the next transaction or start SHALL send them unchanged; nothing SHALL send them again on its own. The outbox SHALL report the refusal once per run of refusals with the same code, and again only after a send went through or the code changed, in one place: given the module's `log`, as one `outbox.deferred` record, as "Outbox records and spans" requires; otherwise to its `onError` as an `SdkError` with the refusal's registry code, or `internal` for an error without one, the fixed detail `committed, awaiting publication` and the refusal as its `cause`. Without an `onError`, the report SHALL become a `BunnySdkWarning` process warning that names the code and the fixed detail, never the refusal's message. `republish()` SHALL pass a refusal on to its caller, which it rejects, and SHALL NOT report it. Given a validator, `add` SHALL check each message against it and refuse a message it refuses with the validator's code, rolling the transaction back. A refusal that lasts holds back every later message, which waits behind the refused one in commit order, so a remote part's outbox SHALL be given `edgeValidator(schemas)`, the validator a remote edge checks with: profile 2.0, the core families, the device families and the given module schemas (Hub #782).

A state, removal or occurrence message SHALL be deleted once it has gone out, and an outcome SHALL be marked published. Once a send's messages settle, the outbox SHALL delete or mark every message that went out in one commit, after the sends, including those that went out before a refusal stopped the send. That commit, like `acknowledge` and the work's own commit, SHALL run at the connection's own `synchronous` level, so a power loss never undoes it. A send SHALL take the messages waiting when it starts: transactions that commit before a queued send starts SHALL share its commit, and one that commits while a send is under way SHALL wait for the next send. An outcome already marked published SHALL need no write. Once that commit lands, a state, removal or occurrence that went out SHALL never be sent again. A crash after a send and before that commit SHALL leave the batch to go out again at the next start, and a failure of that commit SHALL leave it to go out again with the next send, in both cases with the same `id`s; the failure SHALL be reported as a refused publish is, with the refusal's code when a refusal also stopped the send and `internal` otherwise. An outcome SHALL stay stored after it goes out until `acknowledge(id)` deletes it; `acknowledge` SHALL return whether the outbox held that outcome. The outbox SHALL follow the core's acknowledgments itself (Hub #782): when its participant can subscribe, `republish()` SHALL first subscribe, once, to `bunny.event.outcome-recorded.<module>`, and SHALL forget an outcome only on an `outcome-recorded` occurrence that names the participant's own source and the outcome's `id` and whose sender, the envelope's `source`, is the core, `bunny/core`. The acknowledgments heard in one turn of the event loop SHALL be forgotten together at its end, in one commit at the connection's level, so a burst of them costs one sync to disk; one heard as the module stops, before its turn ends, SHALL leave the outcome stored, to go out again at the next start. An acknowledgment from any other sender SHALL be ignored, keeping the outcome, and recorded once as `message.received` at WARN with `forbidden`; one that forgot an outcome SHALL be recorded as `outbox.acknowledged` at INFO, in its trace. So a lost or forged acknowledgment SHALL never discard a stored outcome. `republish()` SHALL then send, in order, everything still stored: messages a crash kept from going out or from being forgotten, and every outcome not yet acknowledged. It SHALL resolve with how many went out. The core drops duplicates by `(source, id)`. Nothing SHALL forget a message by time. One outbox SHALL serve one database connection.

#### Scenario: Messages go out after the commit
- **WHEN** a transaction changes the module's table and adds a state, an occurrence and an outcome
- **THEN** the change commits, and the consumer receives each message once, in that order, exactly as `add` returned it, from the module's source

#### Scenario: A rolled-back transaction sends nothing
- **WHEN** the work adds messages and then throws
- **THEN** the transaction rejects with that error, the table and the outbox are unchanged, and nothing goes out, then or after a restart

#### Scenario: A crash between commit and publish
- **WHEN** the process dies after the commit and before any publish, and the module restarts on the same database and republishes
- **THEN** the three stored messages go out once, the outcome naming its `requestId`, and the next restart sends only the outcome again while a duplicate-dropping consumer still holds each exactly once

#### Scenario: A clean restart replays nothing but the unacknowledged outcome
- **WHEN** a run publishes a state, an occurrence and an outcome, and the module restarts and republishes
- **THEN** only the outcome goes out again, unchanged, the consumer takes each message once, and a later transaction sends only its own messages

#### Scenario: An outcome published while the core had failed
- **WHEN** an outcome goes out while no consumer listens, ten minutes pass, and the module restarts with the consumer listening
- **THEN** the outcome goes out again, and the consumer takes it once

#### Scenario: An acknowledged outcome
- **WHEN** the core acknowledges an outcome, before or after it first goes out
- **THEN** `acknowledge` returns true once, the outbox no longer holds it, and no start sends it again; acknowledging a state, an occurrence or an unknown id returns false

#### Scenario: Each message once per run, in order
- **WHEN** three transactions commit one after another without waiting for each other
- **THEN** their messages go out once each, in commit order

#### Scenario: A refused publish keeps the message
- **WHEN** the module's participant has closed and a transaction commits
- **THEN** the transaction resolves with the work's result, the work stays committed, every message waits unpublished, and the next start sends them unchanged, with their trace context

#### Scenario: Committed, then published with the next transaction
- **WHEN** a transaction commits while its publish is refused, a second one commits while it is still refused, and a later transaction commits once publishing works again
- **THEN** the first resolves with the work's result and is reported once as committed and awaiting publication, with the refusal's code; nothing sends again on its own past every deadline; the second is not reported again; the later transaction sends the waiting messages first, exactly as stored, then its own; and the next refusal is reported again

#### Scenario: A message the edge refuses
- **WHEN** an outbox over a remote participant stores an occurrence whose schema the edge does not know, and then a state
- **THEN** both transactions resolve, the refusal is reported once with `unknown-schema`, and both messages wait; with the edge's validator, the same occurrence rolls its transaction back with `unknown-schema`, nothing waits, and the next message goes out

#### Scenario: No command goes in
- **WHEN** work adds a command, a command on an event key, an occurrence on a state key or a message on a malformed key
- **THEN** each transaction is refused with `invalid-request`, and nothing is stored or sent

#### Scenario: Only synchronous work in the outbox's own transaction
- **WHEN** work returns a promise, the database is already in a transaction, or `add` is called after its transaction ended
- **THEN** the first rejects with `TypeError` and leaves no unhandled rejection, the others are refused with `invalid-state`, and nothing is stored or sent

#### Scenario: One commit for a publication batch
- **WHEN** a transaction adds a state, an occurrence and an outcome and all three go out, and later three transactions commit one after another without waiting for each other
- **THEN** the first makes two commits, its work's and one for the three messages, and the three make four, one each and one for the batch the first send took

#### Scenario: A transaction during a send
- **WHEN** a second transaction commits while the first transaction's send is under way
- **THEN** the first send takes only the first transaction's message, the second's goes out in the next send with a bookkeeping commit of its own, and each goes out once, in commit order

#### Scenario: A send refused partway
- **WHEN** the first of three messages goes out and the second is refused
- **THEN** one bookkeeping commit marks the first, the other two wait unpublished, the first's publication is recorded once, and the next transaction sends the two first

#### Scenario: A republish of published outcomes
- **WHEN** a module restarts with an outcome that went out but was not acknowledged, and republishes it
- **THEN** the outcome goes out again, unchanged, and nothing is written

#### Scenario: A failed bookkeeping commit
- **WHEN** the commit that would forget and mark a batch fails after its state, occurrence and outcome went out, and a later transaction commits once that commit can succeed
- **THEN** every row stays stored, the failure is reported once with `internal` and three messages waiting, no publication is recorded, and the next send sends the three again with their `id`s before the new message and records the outcome's publication once

#### Scenario: A kill between the sends and their bookkeeping
- **WHEN** a module process is killed with SIGKILL after its transaction's three messages went out and before their bookkeeping committed, and it restarts twice on the same database
- **THEN** the first restart sends the three again exactly as first sent, a consumer that drops duplicates takes each once, the second restart sends only the outcome, and the outcome's publication is recorded once

#### Scenario: A kill between the commit and the first send
- **WHEN** a module process is killed with SIGKILL after its transaction committed and before its first send, and it restarts twice on the same database
- **THEN** the work and the three messages are stored, unpublished, the first restart sends each once, the second only the outcome, and the outcome's publication is recorded once

#### Scenario: A kill after an acknowledgment mid-batch
- **WHEN** the core acknowledges an outcome after it went out and before its batch's bookkeeping committed, the module process is then killed with SIGKILL, and it restarts twice on the same database
- **THEN** the acknowledgment records the outcome's publication once, the outcome never goes out again, and the state and occurrence go out once more at the first restart only

#### Scenario: Every commit at the connection's level
- **WHEN** a module's database is opened as the runtime opens it, a transaction commits and publishes, the core acknowledges its outcome, and another transaction commits and publishes
- **THEN** the database is in WAL mode with exclusive locking at `synchronous = FULL`, and each work commit, each bookkeeping commit and the acknowledgment runs at FULL

#### Scenario: The core's acknowledgment forgets an outcome, and only the core's
- **WHEN** a module's outbox has republished, its outcome has gone out, another module publishes an `outcome-recorded` naming it, the core publishes one naming another module's outcome with the same ID, and then the core acknowledges it
- **THEN** the first two change nothing and the forged one is recorded as `message.received` at WARN with `forbidden`; the core's forgets the outcome, recorded as `outbox.acknowledged` at INFO in the outcome's trace; and the next start sends it no more

#### Scenario: Acknowledgments in one commit
- **WHEN** the core acknowledges 50 of a module's outcomes in one turn
- **THEN** the outbox forgets all 50 in one commit at the connection's level and records each as `outbox.acknowledged`

#### Scenario: A lost acknowledgment discards nothing
- **WHEN** a module stops before the core's acknowledgment of its outcome arrives, and starts again with the core acknowledging every outcome it gets
- **THEN** the outcome goes out again at the start, the core takes it once, and its acknowledgment then forgets it

#### Scenario: A remote outbox with the edge's validator
- **WHEN** a remote participant's outbox stores an occurrence the edge would refuse and then an outcome, without and then with `edgeValidator()`
- **THEN** without it the outcome waits behind the refused occurrence; with it the occurrence's transaction is refused with `unknown-schema` and the outcome goes out

### Requirement: Module manifest checks

The SDK SHALL export `checkModuleName`, `checkApiVersion`, `checkContributions` and `checkManifest`, which return the runtime's own reason for refusing a module, as a code from the 2.0 error registry and a fixed sentence, or undefined when the runtime would accept it. `MODULE_API_VERSION` SHALL be `1.2`: `1.1` added the module's configuration, secrets, private folder and worker calls to `1.0`, and `1.2` adds its contributions to the runtime's gateway (Hub #835); a `1.0` or `1.1` module SHALL still be accepted.

A manifest MAY declare `pages` (at most 16, each `{id, title, render}`, with distinct IDs of lowercase letters and digits with single hyphens of at most 64 characters, never `content`, and titles of at most 80 characters), `content(ref)` (content by reference, `{type, bytes}` or undefined), `tools` (at most 16 read tools, each `{name, description, input, output, read}`, with distinct names of a lowercase letter then lowercase letters, digits and underscores of at most 48 characters, descriptions of at most 1024 characters, an object `input` schema that allows no other member and an object `output` schema) and `settings` (`{schema, show}`, an object schema and what to show of the configuration `configure` accepted, so a module that declares settings SHALL declare `configure`, keeping one configuration path). `checkContributions` SHALL refuse each malformed one with `invalid-request`, and SHALL refuse any of them in a manifest written for a module API older than `1.2`. `checkManifest` SHALL include it.

The manifest MAY declare a synchronous `configure(section)` that returns `{config, devices?}` or a refusal from `errorBody`, whose detail SHALL be fixed text that repeats no value from the section, since health shows it. A module's context SHALL type its configuration as possibly undefined, because `configure` is optional. `checkConfiguration(manifest, section)` SHALL check a module's own section of the runtime's configuration file as the runtime does before it starts the module, and SHALL return `{status: 'accepted', config, devices, secrets}` or `{status: 'refused', problem}`: a module that declares `configure` needs a section (`not-found`); a section is a JSON object (`invalid-request`); its `secrets` member, when present, maps at most 16 names, each lowercase letters and digits with single hyphens, to absolute paths (`invalid-request`); `configure` must not refuse, with the refusal's code and detail, throw (`internal`, keeping what it threw in memory only) or answer neither a configuration nor a valid refusal (`internal`); and its devices must be distinct routing IDs of at most 128 characters (`invalid-request`). A module without `configure` SHALL get an undefined configuration and the secrets its section names. The runtime and the module test kit SHALL both use them.

#### Scenario: The kit and the runtime refuse the same manifests
- **WHEN** a module declares API version `2.0` to a runtime that supports `1.0`
- **THEN** `checkManifest` returns `unsupported-version`, the runtime refuses the module, and the kit's manifest check fails

#### Scenario: The kit and the runtime check the same configuration
- **WHEN** `checkConfiguration` gets no section for a module with `configure`, an array, malformed secrets, a refusing or throwing `configure`, devices that are not distinct routing IDs, and a valid section
- **THEN** it refuses them with `not-found`, `invalid-request`, `invalid-request`, the refusal's code or `internal`, and `invalid-request`, and accepts the valid one with its configuration, devices and secrets; the runtime refuses and the kit's manifest check fails for the same sections

#### Scenario: Contributions checked like the rest of the manifest
- **WHEN** `checkManifest` checks a `1.2` module with a page, content, a tool and settings, the same contributions declared by `1.0` and `1.1` modules, pages with malformed, repeated or reserved IDs, a missing title or render, tools with malformed or repeated names, an input that allows other members, a non-object output or no read, and settings without `configure`, schema or show
- **THEN** it accepts the `1.2` module and a `1.3` one, refuses the older ones with `pages, content, tools and settings need module API 1.2` while each still runs without contributions, and refuses every malformed contribution with `invalid-request` and a fixed sentence naming it

### Requirement: Module test kit

The SDK SHALL export, from `@jimmie-potts/sdk/testing`, one conformance suite that any module runs from a description of it: a factory for fresh instances, its payload schemas, and, each optional, its section of the configuration file, its secrets' synthetic text, an instance whose device never answers with how to recognize its `unavailable` report, the families it serves, the families it copies with the snapshot a stand-in owner serves, a command it accepts and a command it refuses with its error code. `moduleConformance(spec)` SHALL register the checks as a node:test suite named for the module and SHALL be the only part of the kit that loads `node:test`. `conformanceChecks(spec)` SHALL return the checks that apply as `{name, run}` for any runner. Each check SHALL host a fresh instance with `ModuleHarness` on its own bus and state directory, with a stand-in owner for the copied families: `bunny/core`, or the owner the description names for them, as a module that copies one device module's `device` records names it. Each check SHALL fail when any message it sees breaks profile 2.0, with the core families, the core's acknowledgment among them, and the module's schemas registered; when a record the module logs is not one the runtime writes whole as a diagnostic-contract record, because its event is not registered for the `bunny.module` scope, a field is not a registered attribute, or a value is outside its registered type; when a message it sees, a command or sync request the module sends, a record the module logs, a span, a reply or a synced state carries one of the module's secrets, naming where but never the secret; or when a handler, timer or worker of the module fails, or its stop throws or outlasts its deadline. `checkModuleRecord(name, record)` SHALL return that record check's reason, naming the event and attribute keys but never a value, or undefined. The checks SHALL be:
- always, the manifest is one the runtime accepts, and `checkConfiguration` accepts the module's section;
- always, the module starts and stops within the deadline, and afterwards its accepted command and its served families, synced from the module by name, when given, are `unavailable`, and no timer or worker it started through its context and no open database is left;
- with an instance whose device never answers, policy A: that instance's start finishes within 1000 ms by default, because start opens only local resources, and the module then publishes a state that reports the device `unavailable`;
- with served families, a sync of them that names the module as its owner completes with states of those families from the module;
- with more than one served family, a sync of each family alone that names the module as its owner completes with states of that family only, so a module that answers outside the request fails, as a reader whose grant reads one family would find it;
- with copied families, its start syncs them and asks for nothing else, and, when the description names their owner, every sync of them names that owner;
- with an accepted command, it accepts it;
- with a refused command, it refuses it in its own reply with the declared code;
- with an accepted command, the command's outcome is published, and published again, unchanged, after a restart on the same database without an acknowledgment;
- with an accepted command, an acknowledgment of its outcome from a participant other than the core changes nothing, so a restart publishes the outcome again; once `bunny/core` acknowledges it, the module records `outbox.acknowledged`, and the next restart publishes it no more (Hub #782).

`ModuleHarness` SHALL host a module as the runtime does: its section, checked with `checkConfiguration` before start, which throws the refusal's `SdkError` and never starts a module the runtime would refuse; its own participant with source `bunny/modules/<name>`, given to the module without `close`, whose commands and sync requests it keeps, each sync with the owner it names, since no subscriber sees them; a context whose SQLite file is `<name>.sqlite` and whose private folder is `<name>/` in a given directory, whose `secrets.read` serves the given secrets' text from memory for the names the section gives, and whose worker calls are the runtime's; and a stop that aborts the signal, cancels timers, closes the participant, runs `stop()`, ends workers and closes the database. The participant close and `stop()` SHALL each have a deadline, 5 s by default, and a step that throws or outlasts it SHALL be recorded as a failure without keeping the later steps from running.

The kit's stand-in acknowledgment is gone: a test's stand-in core SHALL publish the core's own, `acknowledgmentOf(outcome)`, as `bunny/core` (Hub #782).

#### Scenario: A conforming module passes
- **WHEN** a module that serves its family, answers its command and reports the outcome through its outbox runs the suite
- **THEN** every check passes, and there is no copies check when it copies nothing

#### Scenario: A module that only consumes
- **WHEN** a module that copies the mode and serves and answers nothing runs the suite
- **THEN** only the manifest, lifecycle and copies checks run, and they pass

#### Scenario: A module that copies a family that several modules serve
- **WHEN** a module that copies a bulb module's family names that owner, names none, or names an owner nobody runs, with the description naming the bulb module as the owner
- **THEN** every check passes for the first; only the copies check fails for the second; the lifecycle and copies checks fail for the third; and the harness keeps the module's sync with the owner it named

#### Scenario: The kit catches a non-conforming module
- **WHEN** a module publishes its outcome without the outbox, declares an unsupported API version, refuses with another code, has a stop that never finishes, or sends a state its schema refuses
- **THEN** the outbox and acknowledgment checks; the manifest check; the refusal check; the lifecycle, outbox and acknowledgment checks; or the sync, accept, outbox and acknowledgment checks fail, respectively, and every other check passes

#### Scenario: The kit catches a module record the runtime would not write
- **WHEN** a module logs an event the catalog does not register for modules, one of the runtime's own events, an unregistered attribute holding a raw message, or a URL in a registered attribute, while it handles its accepted command
- **THEN** the accept, outbox and acknowledgment checks fail, every other check passes, and the reason names no value

#### Scenario: The harness stops a module as the runtime does
- **WHEN** a hosted module's stop throws, or never finishes
- **THEN** the module had no `close` on its participant, the harness's stop still ends within its deadline and closes the database, and it records the error or the passed deadline as a failure

#### Scenario: Another runner
- **WHEN** a process imports the kit, or Vitest runs `conformanceChecks`
- **THEN** `node:test` is not loaded

#### Scenario: Policy A's check
- **WHEN** a configured module that reaches its device on its scheduler with a deadline runs the suite, and a variant whose start waits on its device runs it too
- **THEN** every check passes for the first, the offline check included, and for the variant only the offline check fails

#### Scenario: A configuration the module refuses or lacks
- **WHEN** a configured module runs the suite with a section its `configure` refuses, or with none
- **THEN** every check fails, since the module never starts

#### Scenario: A secret where it must not be
- **WHEN** a configured module puts the secret it read in a log record, in a published state, in a command it sends that nothing answers, in a span it records, in a refusal's detail, or only in the states it serves through sync
- **THEN** every check that starts it fails for the record, the state, the command and the span, only the refusal check fails for the detail, only the serves check fails for the synced state, and no failure quotes the secret

#### Scenario: The harness's secrets and folder
- **WHEN** a hosted module reads a named secret held with a trailing line break, a secret its section does not name, and a named secret with no text, and asks for its folder, then stops
- **THEN** it gets the text without the line break, `not-found` twice, a mode 700 folder `<name>/`, and after the stop `invalid-state` for both

#### Scenario: The kit catches a module that mishandles the core's acknowledgment
- **WHEN** a module's outbox gets a participant that cannot subscribe, or a module forgets an outcome on any acknowledgment that names it, whoever sent it
- **THEN** only the acknowledgment check fails, and for the second it says that an acknowledgment from another participant than the core must be ignored

#### Scenario: A module that answers outside the request
- **WHEN** a module that serves two families answers every sync with both, whatever the request names
- **THEN** only the check that syncs each family alone fails; the same module answering with the requested family only passes every check, and a module that serves one family runs no such check

### Requirement: Decision records at the SDK's boundaries

The bus, the remote edge and the remote client SHALL each take an optional `onDiagnostic(diagnostic)` callback, a no-op by default, and SHALL report each decision they make to it exactly once, at the level ADR 0012 sets. A diagnostic SHALL be a closed record of an event, a level and values the SDK has already validated: the participant's source, the command's routing key or `sync <families>`, the request ID, the message ID, an outcome, a 2.0 registry code, the edge's route, an exception's type and an attempt count, with the trace context of the work. It SHALL NOT hold a payload, an error object, an exception's message or a credential. A decision that ends with a registry code SHALL take that code's level from one table that the bus, the edge and sync all use: INFO for validation and domain refusals (`invalid-request`, `invalid-message`, `unsupported-version`, `unknown-schema`, `unsupported-capability`, `not-found`, `invalid-state` and `revision-conflict`) and for `cancelled`; WARN for refusals a correct caller should never receive (`unauthenticated`, `forbidden`, `too-large` and `duplicate-conflict`), lost capacity (`capacity` and `unavailable`), `expired` and `uncertain-result`; ERROR for `internal`. The events and their levels SHALL be:
- `command.admitted`, INFO: the bus put a command in its owner's queue;
- `command.refused`, at its code's level, which is WARN for each code the bus refuses with: the bus refused a command that never reached a handler because no responder owns its key, its owner's queue is full, its deadline passed while it waited or it reached the handler past its expiry, its responder closed, or the edge could not deliver it;
- `command.cancelled`, INFO: its requester closed or stopped waiting before a handler started it;
- `command.replied`, INFO for `accepted` and its code's level for the owner's typed refusal: the owner replied;
- `command.uncertain`, WARN: the handler had the command and the request ended `uncertain-result`;
- `sync.served`, INFO, and `sync.refused`, at its code's level whether the owner or the bus refused: the bus's answer to a sync request;
- `sync.restarted`, DEBUG: an overflow restarted a copy's sync;
- `edge.connected` and `edge.disconnected`, INFO; `edge.refused`, at its code's level, with `cancelled` for a call its caller dropped while the edge read it; `edge.failed`, ERROR as an internal fault, with the code it answered: the edge's own decisions;
- `remote.disconnected`, WARN, and `remote.reconnected`, INFO: the remote client's stream;
- `remote.command.uncertain`, WARN: the remote client settled a request `uncertain-result` itself, because the edge answered `internal` or `uncertain-result`, could not be heard by its deadline and grace, or the requester closed first.

Every record about one request SHALL be made at its admission or inside its one settlement, so a late reply, a second deadline or a close after it settled makes none. A call that the SDK refuses with `SdkError` SHALL make no bus record; the edge SHALL record its refusal of a remote call. A catch that only passes an error to `onError` SHALL record nothing. A record that the edge makes before it authenticates a call SHALL carry only its route, which is one of the edge's calls or `other`, and its code. The edge SHALL record a repeated refusal by the repetition rule: the first refusal with a given route, code and source at once, then the repeats counted and recorded as one summary of the same refusal, with their count as `attempts`, at the end of each minute on the edge's scheduler that counted any; a minute with none SHALL end the run, so the next refusal is recorded at once, and closing the edge SHALL record what its open windows counted. A callback that throws SHALL NOT change a result and SHALL NOT be called again about its own failure.

#### Scenario: One record for each command decision, on both transports
- **WHEN** commands are accepted, refused by their owner, sent with no responder, refused by a full queue, expired in the queue, cancelled while queued, held by a handler past the deadline and failed by a handler that throws, in process and through the edge
- **THEN** each request makes exactly one admission record when it reached the queue and exactly one ending record at its level, every record carries the request ID, the requester's source, the routing key and the command's trace, and a late reply makes none

#### Scenario: Levels by registry code
- **WHEN** an owner refuses commands with `invalid-state`, `too-large`, `forbidden` and `internal`, a sync owner refuses with `forbidden` and then fails, a sync covers two owners' families, and the edge refuses an oversized body, a malformed message and another source's call
- **THEN** each record takes its code's level from the one table: INFO for `invalid-state`, `invalid-message` and `invalid-request`, WARN for `too-large`, `forbidden` and `unauthenticated`, and ERROR for `internal`

#### Scenario: Concurrent requests keep their own trace
- **WHEN** two requests from different traces wait in the same owner's queue and both end
- **THEN** each record carries only its own request's trace and request ID

#### Scenario: Sync decisions
- **WHEN** a sync is served, refused by its owner, refused for no owner, and a copy's overflow restarts its sync
- **THEN** each makes one record at its level with the copy's source and `sync <families>`

#### Scenario: A failing callback
- **WHEN** the bus's, the edge's and a remote client's `onDiagnostic` throw on every record, in process and through the edge, while requests are accepted, refused and unanswered, syncs are served and refused, the edge refuses calls and fails, and a stream drops and reconnects
- **THEN** every request, sync and edge call ends exactly as it does without the callback, the callback still hears each decision, and nothing reports the callback's failure

#### Scenario: A refusal that repeats
- **WHEN** a part with a revoked token reconnects five times within a minute, three times in the next and not in the third, while other sources and codes are refused on another route
- **THEN** the edge records the first refusal at once, one summary counting four repeats and one counting three, nothing for the quiet minute, the next refusal at once again, and each other route, code and source as its own run

#### Scenario: Before authentication
- **WHEN** a call reaches the edge without a granted token, from a path that is not one of its calls, with a traceparent in its body
- **THEN** its record carries the route `other` and the code `unauthenticated`, and no source, trace or anything the caller sent

### Requirement: Recorded spans

The SDK SHALL define `SpanRecorder.start(name, {parent?, links?, kind?, attributes?})`, which returns a span with its own trace context and `end(status?)`, for the diagnostic contract's registered span names. The default recorder SHALL record nothing and give a span the context `childOf(parent)`, so a message's trace context is unchanged without a recorder. Given a recorder, the bus SHALL record for each command a `bunny.command.request` span, started when a participant sends it or when the edge hands the bus a command whose context it authenticated and validated; a command sent in process SHALL carry that span's context. The bus SHALL parent a `bunny.command.queue` span, from admission until a handler takes the command or it leaves the queue, and a `bunny.command.execute` span, for the handler's run, to that request span, and a reply SHALL carry the execute span's context. A span SHALL end with status `error` when its request is uncertain or the bus refused it other than by cancellation, and when a handler throws; a typed refusal SHALL NOT be an error. Recording a span SHALL never throw into domain work or change a result. `ModuleContext.trace.start` SHALL record a module's own spans, such as `bunny.device.call` around a device call, and no trace context SHALL be sent to a device.

#### Scenario: A command's spans
- **WHEN** a request is accepted
- **THEN** the command carries its request span's context, the queue and execute spans are children of that span in its trace, the reply carries the execute span's context, and each span has a start and an end

#### Scenario: Concurrent requests have their own spans
- **WHEN** two requests from different traces run at once
- **THEN** each queue and execute span is the child of its own request span, and no span joins the other trace

#### Scenario: Failures in spans
- **WHEN** a handler throws, a command expires in its queue and an owner refuses with its own code
- **THEN** the first request's and execute spans end with `error`, the expired command's queue and request spans end with `error`, and the refused command's spans do not

#### Scenario: Without a recorder
- **WHEN** the bus has no recorder
- **THEN** messages carry the same trace contexts as before, each in a new span of its parent's trace

### Requirement: Outbox records and spans

An `Outbox` given the module's `log` SHALL record an outcome's first publication at most once, as `outcome.published` at INFO for `succeeded` and WARN for `failed` or `uncertain`, with its request ID, message ID, outcome and error code and the outcome's own trace context. It SHALL make that record once the commit that marks the outcome published lands, so after a crash between the send and that commit the run that sends the outcome again makes it, and a kill right after that commit may leave it out. An acknowledgment that lands after the outcome went out and before that commit SHALL make the record itself, since no later send will. Publishing a stored outcome again SHALL make no such record. A publish refused after the commit SHALL make one `outbox.deferred` record at WARN with the refusal's code and the count of messages still waiting, once per run of refusals, in place of the report to `onError`; a refusal that `republish()` passes on to its caller SHALL make none. Given the module's `trace`, the outbox SHALL record a `bunny.outcome.publish` span for each outcome it sends: a child of the outcome's stored context when the same transaction stored it, and otherwise a new root linked to that context, never a child of it, as after a restart or a deferred publish. Without them, the outbox SHALL record nothing.

#### Scenario: First publication and replay
- **WHEN** a transaction stores and publishes an outcome, and the module restarts and republishes it
- **THEN** there is exactly one `outcome.published` record, in the outcome's trace, the first publish span is the stored context's child, and the replayed one is a root linked to it

#### Scenario: A deferred publish
- **WHEN** a transaction commits while its publish is refused, and a later transaction publishes the waiting messages
- **THEN** one `outbox.deferred` warning names the code and the waiting count, a second refused transaction in that run makes none, `onError` hears nothing, the outcome's publication is recorded once when it goes out, and its publish span links to its stored context

#### Scenario: An acknowledgment before the bookkeeping
- **WHEN** the core acknowledges an outcome while the next message of its batch goes out, before the batch's bookkeeping commits
- **THEN** the acknowledgment records the outcome's publication once, the bookkeeping records nothing more, and the outbox no longer holds any of the batch

### Requirement: Device availability

The SDK SHALL offer `DeviceAvailability`, which takes a module's `log` and clock. `unreachable(device, code, trace?)` SHALL log a device's first failure as one `device.unavailable` record at WARN, and SHALL count later failures and log them as one `device.unavailable` summary at DEBUG with `bunny.attempt_count` at most once a minute. `reached(device, trace?)` after failures SHALL log one `device.available` record at INFO with the count of failed attempts and the outage's duration; while the device is available it SHALL log nothing. A device ID that the contract's `bunny.device.id` pattern refuses SHALL be left out of these records, which SHALL be kept, as a request ID that its pattern refuses is.

#### Scenario: A polled device that stays offline
- **WHEN** a device fails 200 polls over ten minutes and then answers
- **THEN** at INFO and above there is one `device.unavailable` warning and one `device.available` record that counts 200 failures, and at DEBUG at most one summary a minute

#### Scenario: A device ID outside the pattern
- **WHEN** a module reports a device whose ID is an address with a path and a token
- **THEN** its `device.unavailable` and `device.available` records are written without `bunny.device.id`, and the ID appears in none of them

### Requirement: Safe default error report

Without an `onError`, the bus and the remote client SHALL report each error as a `BunnySdkWarning` whose message names the source, the pattern and the error's type, and for an `SdkError` its code, never the error's message; the error SHALL stay the warning's `cause` in memory.

#### Scenario: A secret in a handler's exception
- **WHEN** a handler with no `onError` throws an error whose message holds `tok_SYNTHETIC123`
- **THEN** the warning names the source, pattern and `Error`, and its message holds no part of the secret

### Requirement: The kit checks records and spans

The module test kit SHALL record the bus's diagnostics and the spans of the bus and the hosted module. Its accept and refusal checks SHALL fail unless the command makes exactly one `command.admitted` and one `command.replied` record, with the expected outcome and code, each carrying the command's trace, and its request, queue and execute spans are parented as "Recorded spans" requires and ended. Its outbox check SHALL fail unless the outcome's publication is recorded once across the restart, in the command's trace, and the replay's publish span links to the stored context without being its child. Every check SHALL fail when a span's parent is neither a recorded span, a message's own span nor absent. `ModuleHarness` SHALL take a span recorder, and `RecordedSpans` SHALL record spans for tests.

#### Scenario: A module whose outbox records nothing
- **WHEN** a module builds its outbox without its `log` and `trace`
- **THEN** the outbox check fails, naming the missing publication record

#### Scenario: A lost parent
- **WHEN** a hosted module starts a span whose parent is a context no recorded span or message has
- **THEN** the check fails, naming the span

### Requirement: Bounded worker calls

`WorkerCalls`, which the runtime and the kit's harness both give a module as `workers.call(file, request, {timeoutMs, signal?, transferList?})`, SHALL run one request in a new worker thread from a module file: the worker gets `request` as its `workerData` and answers with one message, and the call SHALL resolve with that message and terminate the worker. The deadline SHALL be an integer from 1 to `MAX_TIMEOUT_MS` on the module's scheduler, and a module SHALL have at most `MAX_WORKER_CALLS`, 4, calls running. A call SHALL end once, terminating its worker and releasing its deadline and listeners, and SHALL reject with an `SdkError` with a fixed detail. Before its worker starts, a call SHALL be refused with no effect: `invalid-state` once the module has stopped, `invalid-request` for a malformed deadline, `cancelled` when its own signal has already aborted, `capacity` beyond the limit, and `internal` when the worker cannot start. Once the worker has the request, every ending but its reply SHALL be `uncertain-result`, since the worker may have done part of its work (ADR 0012: a rejection proves no effect, and cancellation is not undo): the deadline passing, the module's signal or the call's own signal aborting, the worker throwing, its reply being unreadable, or its ending without a reply. What the worker threw SHALL stay in memory as the cause only.

#### Scenario: A reply, a deadline and a stop
- **WHEN** a worker answers, another never answers with a 2000 ms deadline on a manual scheduler, and a third never answers when the module's signal aborts
- **THEN** the first resolves with the reply and leaves no deadline, the second is still pending at 1999 ms and rejects with `uncertain-result` at 2000 ms, the third rejects with `uncertain-result`, every worker is terminated, and a later call rejects with `invalid-state`

#### Scenario: Failures stay with the call
- **WHEN** a worker throws an error quoting a synthetic token, another ends without a reply, a third's reply cannot be read, a call's own signal aborts after its worker started, a fifth call starts while four run, and calls have deadlines of 0, -1, 1.5, `MAX_TIMEOUT_MS` + 1 and NaN
- **THEN** the first four reject with `uncertain-result`, the first keeping the thrown error as the cause, the fifth with `capacity` and the deadlines with `invalid-request`, and no error message quotes the token

#### Scenario: Refused before the worker starts
- **WHEN** a call's own signal has already aborted, or its file is not a `file:` URL
- **THEN** it rejects with `cancelled` or `internal`, and no worker starts

### Requirement: Serve sync from each owner's current state

The SDK SHALL give each participant `serveSync(families, provider)`. Ownership SHALL be keyed by source and family. Only a shared family, which the SDK lists and exports as `SHARED_FAMILIES` and which today is `device` alone, MAY have several owners, each for its own entities, as every device module serves `device` for its own devices. A `serveSync` naming a family that the same source already serves, or a family that is not shared and that another source serves, SHALL be refused with `invalid-state`, and an empty, repeated or malformed family list with `invalid-request`. The bus SHALL name the families each source serves now, in the order it registered them, through `served(source)`. An owner MAY serve any number of families; the request caps apply only to one sync request. The owner SHALL handle one sync request at a time and SHALL ignore a request at or past its expiry. A request still waiting in the owner's queue at its deadline, or withdrawn, SHALL leave the queue, so the owner never serves it; one at its deadline SHALL still be refused with `unavailable`, never `expired`, because a sync changes nothing and asking again is safe. A sync request SHALL go to the owner it names, or, when it names none, to the only owner of its families, and to that owner alone: the SDK SHALL never spread one request across owners or merge owners' records. The owner SHALL travel beside the request, not in its message: in the transport's sync call, as a routing key travels beside a command. A remote edge SHALL pass a `sync` call's `owner` to its bus, and SHALL refuse one that is not a participant source with `invalid-request`. The provider SHALL receive the request and return `{revision, states}`, one state draft per entity, or an error body. The SDK SHALL send each state as a state message from the owner, then `sync.completed` with the `requestId`, the revision and the members. It SHALL send them straight to the requester, never to subscribers, continuing the request's trace.

A sync request SHALL be refused in the shared error body, naming its `requestId` and trace ID, with no `sync.completed`:
- with the provider's error body;
- `internal` when the provider throws, or its snapshot holds a state outside the requested families, without an entity ID or above the snapshot's revision, has a revision that is not a whole number from 0, or holds more than 4096 states; the error SHALL also go to `onError`;
- `unavailable` when no owner serves a family, the named owner does not serve one of its families, the owner closed before serving it, no answer came by the deadline, or the transport failed to send it;
- `cancelled` when the requester's copy or participant closed before the answer came;
- `capacity` when the owner's queue already holds `maxQueued` waiting requests;
- `invalid-request` when the request names no owner and several owners serve one of its families, saying to name the owner, or when its families do not all belong to one `serveSync` of one owner.

#### Scenario: A sync nobody can serve
- **WHEN** a sync names a family that no owner serves, or the owner's provider throws or returns a snapshot that does not fit the request
- **THEN** it resolves as `rejected` with `unavailable` or `internal`, and each provider failure is reported to `onError` with the owner's source

#### Scenario: An owner closes or is full
- **WHEN** an owner is serving one request, a second waits, a third arrives and the owner then closes
- **THEN** the third is refused with `capacity`, the second with `unavailable`, and the first still gets its answer

#### Scenario: A deadline and an expired request
- **WHEN** the owner is busy past one request's deadline and then answers a request whose own deadline passed while it waited
- **THEN** each request resolves as `unavailable` at its deadline, a late answer changes nothing, and the provider never receives the expired request

#### Scenario: A copy closed while it subscribes
- **WHEN** a copy of three families is closed while its transport is still making the first subscription
- **THEN** it resolves as `rejected` with `cancelled`, asks for no other family and closes the subscription it was making

#### Scenario: A sync request still queued at its deadline
- **WHEN** a sync request waits behind another in an owner's queue of one until its deadline passes
- **THEN** it resolves as `rejected` with the retryable `unavailable`, naming its `requestId` and trace ID, the next request queues in the room it left instead of being refused with `capacity`, and the provider never receives it

#### Scenario: A restart is reported
- **WHEN** a synced copy's delivery queue drops a message and the copy syncs again
- **THEN** `onSyncRestart` receives the copy's source and `sync <families>` once, and the first sync was not reported

#### Scenario: One owner per family per source
- **WHEN** an owner serves a family again, from the same participant or another participant with the same source, another source serves a family that is not shared, two more sources serve `device`, a sync names families of two owners, or an owner serves 38 families
- **THEN** the first two are refused with `invalid-state`, each other source's `device` succeeds, the sync resolves as `rejected` with `invalid-request`, and the owner of 38 families and a sync of one owner's families succeed

#### Scenario: A faulty owner of a family that is not shared
- **WHEN** the core serves its family and `device`, a third participant serves `playback`, `lifx-light` and `device`, and another participant then serves the core's family, alone or with `mode`, `playback`, or `lifx-light` with `mode`, and then `mode` and `device`
- **THEN** on both transports the first four are refused with `invalid-state` naming the family's owner, the last succeeds, and a sync of the core's family that names no owner is served by the core

#### Scenario: The families a source serves
- **WHEN** a source serves one family, then two more through another registration, another source serves `device`, the first registration closes, and then the source's participant closes
- **THEN** `served` lists the source's three families in registration order, the other source's `device`, nothing for a source that serves nothing, then the two families left, and then nothing

#### Scenario: A sync that names no owner
- **WHEN** one owner serves `device` and a consumer syncs it without naming an owner, then a second owner serves `device` and the consumer syncs it again, then the first owner closes and the consumer syncs once more
- **THEN** on both transports the first sync is served by the only owner; the second resolves as `rejected` with `invalid-request`, its `requestId`, the caller's trace ID and the detail `several owners serve device; name the owner to sync from`, neither provider receives it, no `sync.completed` follows and the bus records one `sync.refused` at INFO; and the third is served by the remaining owner

#### Scenario: A named owner that does not serve the family
- **WHEN** a consumer names an owner that serves another family, one that is not connected, or one that serves only some of the requested families
- **THEN** on both transports each sync resolves as `rejected` with the retryable `unavailable` and the detail `no owner serves <family> as <owner>`, the bus records one `sync.refused` at WARN for each, and no provider receives a request

#### Scenario: A malformed owner at the edge
- **WHEN** a remote part's `sync` call names an owner that is not a participant source, then one that serves the family, then none while two owners serve it
- **THEN** the edge refuses the first with `invalid-request` and records the refusal without its detail, serves the second with that owner's states only, and the third is refused with `invalid-request`

### Requirement: Edge grants by calls and routing keys

A `RemoteEdge` grant MAY list the `calls` it may make and the routing-key patterns, `keys`, it may use; either left out SHALL allow all. A key a part publishes or requests SHALL match one of its patterns, and a pattern it subscribes or responds to, and the state keys `bunny.state.<family>.*` of each family it syncs or serves, SHALL lie within one; `reply` SHALL come with `respond` and `answer` with `serve`, and every part MAY open its stream and close what it opened on it. A grant MAY also list `publishes`, the payload families, by the family of a message's `dataschema`, that it may publish. The edge SHALL NOT filter what a part receives: a sync answer carries the owner's every record and its whole membership, and a subscription every message its pattern matches, since no grant limits a part to some devices (owner decision, 2026-10-07). Anything else SHALL be refused with `forbidden` before it reaches the bus, recorded as an `edge.refused` warning with the part's source. The edge SHALL refuse at start a grant whose calls are not its own, whose patterns it cannot read or whose families are malformed, without naming the token. A host MAY authenticate calls itself with `authenticate(request)`, which returns the principal a call acts as, `{source, id?, calls?, keys?, publishes?}`, or undefined for `unauthenticated`, and `disconnectPrincipal(id)` SHALL end the streams a principal opened. The client SHALL name its source in every call's `bunny-source` header, and the edge SHALL refuse a token used under another source with `forbidden` at connect. A refusal's detail SHALL be fixed text that quotes nothing the caller sent, such as a key, a path, an ID or a source, and every answer of the edge SHALL carry `x-content-type-options: nosniff`.

#### Scenario: A grant's calls and keys
- **WHEN** a part granted only `publish` on `bunny.event.test-turn.*` publishes there and elsewhere, requests, subscribes and syncs; a reader granted `subscribe` and `sync` on every state and event key syncs, publishes, responds and serves; and a panel granted `request` on one device and `subscribe` on one family commands that device and another, subscribes within and beyond its pattern, and syncs
- **THEN** only the hook's own publish, the reader's sync, the panel's own command and its narrow subscription go through; everything else is `forbidden` and never reaches the bus, a raw sync request without `sync` included

#### Scenario: Another declared source
- **WHEN** a part connects with another source's token, or posts a call naming another source
- **THEN** both are `forbidden` and no stream opens, while the token's own source connects

#### Scenario: The families a part may publish
- **WHEN** a part granted `publish` on every event key but only the `test-turn` family publishes an outcome on an event key, and its own observation
- **THEN** the outcome is `forbidden` and no subscriber hears it, and the observation goes through

#### Scenario: Refusals quote nothing the caller sent
- **WHEN** a part calls a route the edge does not have, a key outside its grant and a command from another source, each naming a marker
- **THEN** each answer is the shared error body without the marker or the other source, with `nosniff`

### Requirement: Commands are never sent twice through an edge

The edge SHALL remember each command it hands its bus, by the sender's source and the message ID, and SHALL refuse the same message again with `duplicate-conflict` before anything happens, whether or not the first one has settled, so a raw HTTP client cannot make a responder run a command twice. It SHALL remember a command while its bus has it, and once settled until its `expiresat`, at most `REMEMBER_MS`, 10 minutes. A command refused before it reached the bus, or one the bus refused with no reply, before any responder had it, SHALL be forgotten, since sending it again is safe. A command SHALL count against its principal's quota, the principal the host's `authenticate` names by `id` or else its source: one principal SHALL have at most `MAX_REMEMBERED_PER_PRINCIPAL`, 1,024, remembered at once, one source's principals together `MAX_REMEMBERED_PER_SOURCE`, 4,096, and all of them `MAX_REMEMBERED_COMMANDS`, 135,168, which 33 sources at their bound fit; past any, that principal's next command SHALL be refused with the retryable `capacity`, settled entries whose time has passed being forgotten first, and another principal's SHALL still go through, of the same source until that source's bound and of another source always. Forgetting SHALL keep every count right and every remembered command reachable, so a command sent after its part's memory was emptied is remembered too. A repeat SHALL be a duplicate whichever principal of the source sends it. A new edge, as after a restart, SHALL remember none.

#### Scenario: A command repeated after its first forward settled
- **WHEN** a raw client sends a command that the responder accepts, then the same message again, then a new message with the same request ID
- **THEN** the repeat answers 409 with `duplicate-conflict` and an `edge.refused` warning, the new message goes through, and the responder ran the first command once

#### Scenario: A command repeated while its first forward waits
- **WHEN** a raw client sends a command a remote responder holds, its stream drops and the responder registers again, and the client sends the same message again
- **THEN** the repeat is refused with `duplicate-conflict` and the responder saw the command once

#### Scenario: A refusal is not remembered
- **WHEN** a command is refused for a key outside the grant, then sent with a key inside it
- **THEN** the second is accepted

#### Scenario: One source's quota
- **WHEN** one source's quota is two and it sends three commands, and another source sends one
- **THEN** its third is refused with `capacity`, retryable, and the other source's goes through

#### Scenario: A memory emptied at its quota
- **WHEN** with one remembered command per principal and one in all, a part's command settles and expires, the part sends another, which empties its memory as it is swept, sends that one again, and, once it expired too, another part sends one
- **THEN** the repeat is `duplicate-conflict`, the other part's command is accepted, and the responder ran each command once

#### Scenario: Principals that cycle
- **WHEN** with two remembered commands per principal, four per source and eight in all, six principals of one source send two commands each, and then a principal of another source sends one
- **THEN** the source's first four are accepted and the rest `capacity`, and the other source's command is accepted

#### Scenario: Principals of one source
- **WHEN** a host names two principals of one source, one fills its quota of two, the other sends a command and then one the first sent
- **THEN** the first's third is `capacity`, the other's command is accepted, and its repeat of the first's message is `duplicate-conflict`

#### Scenario: Forgotten when refused, bounded once settled
- **WHEN** a command with a minute to its expiry goes to a key nobody responds to, then again once a responder registers, again, and again 999 ms and 1,000 ms after it settled, with `rememberMs` 1,000
- **THEN** the answers are `unavailable`, accepted, `duplicate-conflict`, `duplicate-conflict` and accepted, and the responder ran it twice

### Requirement: Commands bound to their key's entity

As the profile requires (`bunny-message-profile`, "A message's subject is its key's routing ID"), a command's `subject`, the entity it is for, SHALL be its key's last token. The bus SHALL refuse any other command, on every transport, from `request` and from a remote edge's `requestMessage`, with `invalid-message` before a responder has it, so a grant of a key covers exactly the entity a responder acts on. A remote edge SHALL refuse with `invalid-message` a message a remote part publishes whose subject is not its key's last token; a malformed key SHALL still be the bus's `invalid-request`. The bus SHALL refuse with `invalid-message`, wherever it is published, a state or removal whose subject is not its key's last token, so a record never reaches a reader of another entity's key. The bus's own refusals SHALL quote no key, pattern or source.

#### Scenario: A command for another entity than its key's
- **WHEN** a participant in process, a raw client and the SDK's client each send, on a key their grant covers, a command whose subject names another entity, and then one for the key's own
- **THEN** each misrouted one is `invalid-message`, nothing reaches a queue or a responder, and the last is accepted

#### Scenario: A module's state for another entity
- **WHEN** a participant in process publishes a state for `s2` on `s1`'s key, one for `s1` on `s2`'s, a removal naming `s2` on `s1`'s key and a prepared message naming `s2`, while a reader follows `s1`'s key
- **THEN** each is refused with `invalid-message` and the reader hears `s1`'s own state alone

#### Scenario: A remote publish for another entity
- **WHEN** a remote part publishes an observation on `bunny.event.test-turn.s1` whose subject is `s2`
- **THEN** it is refused with `invalid-message` and no subscriber hears it

### Requirement: Stream liveness

The edge SHALL write a heartbeat comment line on each stream every 15 s (`HEARTBEAT_MS`) and SHALL end a stream whose socket stays full for 30 s (`STALL_MS`), its reader having stopped, so its subscriptions close and free their queued messages; it SHALL report that end as an `edge.disconnected` warning with `capacity`. The client SHALL take a stream that delivers nothing, heartbeats included, for 45 s (`IDLE_MS`) as lost, reconnect and tell its subscriptions of the gap, so its copies sync again with nothing replayed. These timers SHALL run on a `liveness` scheduler that defaults to real timers that keep no process alive, whatever the deadline scheduler is.

#### Scenario: Heartbeats
- **WHEN** a stream stays open with nothing to send
- **THEN** it gets a heartbeat at each interval and none before

#### Scenario: A stalled reader
- **WHEN** a reader subscribes and stops reading, the publisher fills its socket and its queue, and the stall limit passes
- **THEN** a full socket alone ends nothing, the limit ends the stream with an `edge.disconnected` warning with `capacity`, and a later publish queues nothing for the reader

#### Scenario: A silent stream
- **WHEN** the edge sends no heartbeat and the client's idle limit passes while it holds a synced copy
- **THEN** the client reports the lost stream, reconnects, and the copy syncs again at the owner's new revision

### Requirement: Publish one prepared message without a stream

The SDK SHALL export `prepareMessage(source, draft, {now?, parent?})`, which gives a profile 2.0 message from `source` with a new `id`, the current `time` and a `traceparent` that continues `parent` or starts a new sampled trace, and `publishOnce({url, source, token, timeoutMs}, key, message)`, which sends one prepared message to an edge's `publish` call over `http` without a stream: one POST of `{schema, key, message}` to `<url>/api/sdk/v1/publish`, with the token only in the `authorization` header, the source in `bunny-source` and the message's `traceparent` as a header. `timeoutMs`, an integer from 1 to `MAX_TIMEOUT_MS`, SHALL bound the whole call, connecting included. It SHALL resolve, and never reject for the edge's answer, with `published`; `rejected` with the edge's registry body, or `unavailable` when the edge could not be reached, since then the message was not published; or `uncertain` with `uncertain-result` when the call reached the edge and its answer was lost, late, over 16 KiB or not the edge's, or the edge failed with `internal` or `uncertain-result`, since the message may have been published. Every error body SHALL carry the message's trace ID. It SHALL reject with `SdkError` `invalid-request`, before anything is sent, a malformed deadline, a URL that is not `http`, or a token or source that cannot be sent in a header. It SHALL send nothing again and report nothing but its result.

#### Scenario: Published in one call
- **WHEN** a prepared message is published through an edge with its source's token
- **THEN** the result is `published`, a subscriber on the edge's bus receives the message unchanged, and the edge read one publish call and no stream

#### Scenario: Refused by the edge
- **WHEN** the call carries a token the edge does not grant, a message from another source than the token's, a message outside the token's grant, or a message the profile refuses
- **THEN** the result is `rejected` with `unauthenticated`, `forbidden`, `forbidden` and `invalid-message`, carrying the message's trace ID, and nothing is published

#### Scenario: An edge never reached
- **WHEN** nothing listens on the edge's port
- **THEN** the result is `rejected` with `unavailable` at once

#### Scenario: A lost or foreign answer
- **WHEN** the edge takes the call and never answers, answers `internal` or `uncertain-result`, answers with an unregistered code, a flag that disagrees with the registry, a body that is not JSON, a 200 that is not its publication, or more than 16 KiB
- **THEN** the result is `uncertain` with `uncertain-result`, at the deadline for the silent edge

#### Scenario: The call's headers
- **WHEN** a message is published to a listener that records the call
- **THEN** the call goes to `/api/sdk/v1/publish` with the token in `authorization`, the source in `bunny-source` and the message's `traceparent`, and the body holds the key and the message and no token

#### Scenario: A malformed call
- **WHEN** `timeoutMs` is 0, negative, fractional, over `MAX_TIMEOUT_MS` or not a number, or the URL is `https` or not a URL
- **THEN** the call rejects with `invalid-request` and nothing is sent

### Requirement: One full-disk test

The SDK SHALL export `fullDisk(error)`, which SHALL be true when the error, or one of at most seven causes that wrap it, carries `SQLITE_FULL` in the low byte of its `errcode`, as node:sqlite reports a full database, or the code `ENOSPC`, as the file system reports a full disk, and false otherwise. It SHALL read only those codes, never an error's text, and SHALL end its walk at a cycle or after the seventh cause. `openModuleDatabaseFile`, the Nanoleaf module and the runtime's migration tools SHALL use it rather than a check of their own.

#### Scenario: A full disk by its codes
- **WHEN** a real full database's error, an extended result code with `SQLITE_FULL` in its low byte, an `ENOSPC` error, and each of those one cause deep or seven causes deep is tested
- **THEN** each is a full disk

#### Scenario: Nothing else
- **WHEN** a full disk eight causes deep, `SQLITE_BUSY`, `EACCES`, an error whose text alone says the disk is full, a value that is not an object, and an error that is its own cause are tested
- **THEN** none is a full disk, and the walk ends

### Requirement: Module registration

The SDK SHALL export `ModuleRegistration`, which each runtime module exports as `registration` from its package entry (Hub #999): the module's factory (`name`, `create`, `simulate`, its own payload `schemas` and its `simulatedSection`), `shipped`, `order`, a number, and `after`, the module names that must start before it; optionally `registerFamilies`, which registers its families on a validator with checks beyond their schemas, and `simulation`, how the runtime's scenario harnesses simulate its devices. A `simulation` SHALL name the `actions` a scenario may ask for and, through `admits`, the other fields each action takes, and SHALL give two halves: `memory`, which creates the simulated device on a harness's clock and scheduler, reads its state, acts on a simulation and builds the module on it; and `run`, which creates what a disposable run's supervisor holds, reads its state, acts on a simulation with a `push` to the runtime's process, answers each call the runtime's module makes over its link, and builds the module with a `DeviceLink`, optionally starting from what the last runtime left (`handover`). A link's `call(method, args, signal)` SHALL resolve with `answered` and the device's value, `failed`, or `abandoned` when the signal aborted first. Its types SHALL need nothing but the SDK and the contracts packages, so a module registers itself within its boundary.

#### Scenario: Each module registers itself
- **WHEN** the runtime's build collects the device modules
- **THEN** each one's package exports a `registration` whose `name` is its manifest's, with its factory, its place in the shipped list and its simulation, and its folder imports only the SDK and the contracts packages

### Requirement: A browser page as a remote part

The SDK SHALL offer the remote client alone at `@jimmie-potts/sdk/remote`, whose module graph imports no Node built-in and reads no file, so a browser page such as the dashboard (Hub #922) can bundle it; its message, request and trace IDs SHALL come from Web Crypto, which Node and a browser both have, and the error body, `MAX_DETAIL` and `SCHEMA_BASE` SHALL come from the event contracts' `v2/errors` module, which the `v2` entry exports unchanged. `connectRemote({browser: true})` SHALL send no `authorization` header, so the browser's session cookie and its own `Origin` stand for the page, and SHALL mark every call with `bunny-request: 1`. A browser has no async context, so there a handler's close of its own subscription SHALL be detected only in the handler's synchronous part. When the edge refuses a reconnect with `unauthenticated` or `forbidden`, the client SHALL keep trying with its backoff and SHALL report `remote.refused` with the code at WARN once per code until it reconnects, so a page can offer to sign in again; the runtime SHALL write no record of it, as of the client's other decisions.

The browser entry SHALL expose the existing `childOf` helper for other HTTP calls, with the same W3C validation and parent semantics as the main SDK entry.

#### Scenario: The client bundles for a browser
- **WHEN** a test bundles `@jimmie-potts/sdk/remote`, and the package's main entry, for a browser
- **THEN** the remote entry bundles with the client and no Node built-in, validator or file read, and the main entry fails to bundle

#### Scenario: Context for other browser HTTP calls
- **WHEN** a page imports the existing childOf helper from the remote entry to send an HTTP call outside the SDK edge
- **THEN** the helper bundles for a browser and supplies valid W3C context, continuing a valid explicit parent or starting a root without one, with no tracestate or baggage

#### Scenario: A browser session's calls
- **WHEN** a part connects with `{browser: true}` to an edge whose host admits a call that carries no token and the page's mark, syncs a family and sends a command
- **THEN** every call, the stream included, carries no `authorization`, `bunny-request: 1` and the part's source, the sync holds the owner's records and the command is accepted

#### Scenario: A session that ended
- **WHEN** the edge ends a browser part's stream and refuses its reconnects as `unauthenticated` several times, then admits it again
- **THEN** the client reports `remote.disconnected`, one `remote.refused` with `unauthenticated` at WARN, and `remote.reconnected`, in that order

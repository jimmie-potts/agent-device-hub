## MODIFIED Requirements

### Requirement: Per-subscriber delivery

Each subscription and each responder SHALL have its own queue, which delivers one message at a time in publish order. A slow handler SHALL delay only its own queue, never the sender, other subscribers or requests. `publish` SHALL NOT wait for any handler, and no handler SHALL run inside the sender's call. Each queue SHALL hold at most `maxQueued` waiting messages, 1024 by default; a `maxQueued` that is not a positive integer SHALL throw `RangeError`. When a subscription's queue is full, a new message SHALL be dropped for that subscription only, and `onError` SHALL receive an `SdkError` with code `capacity`. When a responder's queue is full, the requester SHALL get a `rejected` result with `capacity` instead. A subscription MAY pass `onOverflow`: after its full queue dropped one or more messages, the SDK SHALL call `onOverflow` with the number dropped since it was last told, in the subscription's order and before the next message is delivered, and `onError` SHALL still receive each `capacity` report. An `onOverflow` that throws SHALL be reported to `onError`, and delivery SHALL go on. A handler that throws SHALL be reported to `onError` and SHALL keep receiving. Without an `onError`, each report SHALL become a `BunnySdkWarning` process warning whose message names the source and pattern, with the original error as its `cause`. Closing a subscription SHALL drop its waiting messages and resolve when its running handler finishes. Called from inside that handler, it SHALL resolve without waiting for it.

#### Scenario: A slow subscriber delays only itself
- **WHEN** one subscriber's handler stays blocked on its first message while five messages are published
- **THEN** publishing resolves without waiting, another subscriber receives all five, a request is still answered, and the slow subscriber receives the rest in order once released

#### Scenario: A slow responder delays only its own commands
- **WHEN** a responder's handler is blocked
- **THEN** subscribers still receive published messages, and the pending request resolves once the handler answers

#### Scenario: A full queue
- **WHEN** a blocked subscriber's queue already holds `maxQueued` waiting messages and more are published
- **THEN** those messages are dropped for that subscriber only, `onError` receives `capacity` for each one with the subscriber's source and pattern, and other subscribers receive every message

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
- **THEN** `onOverflow` receives the number dropped before the next message is delivered, `onError` has received `capacity` for each one, other subscribers received every message, and a later message arrives without another notice until the next drop

## ADDED Requirements

### Requirement: Sync a consumer's copy from its owner

The SDK SHALL give each participant `sync(families, handler, {timeoutMs, maxBuffered, parent})`, which keeps a copy of one owner's families. It SHALL subscribe to `bunny.state.<family>.*` for each family before it sends a sync request of kind `sync-request` with a `requestId`, the families and `expiresat` set `timeoutMs` after its `time`. An entity SHALL be a state's schema family and `data.id`, or a removal's `data.entity`, at its `data.revision`.

Until the owner answers, live messages SHALL wait in a buffer of at most `maxBuffered` messages, 1024 by default. On the answer, the copy SHALL first take the owner's states. It SHALL then drop each held entity that is not a member and is at or below the sync revision, and apply each buffered message above the revision in order. Only then SHALL the handler be told about each change in that order: `updated`, `removed` and `synced`. A change applied to the copy SHALL always be told.

After a sync, the copy SHALL apply live messages in order. It SHALL drop a duplicate, a revision older than the one it holds, anything at or below the sync revision, and a state at or below the revision of a removal it applied. A buffer overflow, or a message dropped on one of the copy's subscriptions, SHALL send a new sync request, and the answer to the replaced request SHALL be ignored.

`sync` SHALL resolve with the copy after its first sync. If that sync is refused, `sync` SHALL resolve as `rejected` with the shared error body instead, and the copy SHALL follow nothing. After that, a sync that cannot be served SHALL end the copy with a `failed` change; the copy SHALL keep its last records. A family list that is empty, longer than 32, repeated, not made of family names or longer than 256 characters joined SHALL be refused with `invalid-request`. So SHALL a `timeoutMs` that is not an integer from 1 to 2147483647 and a `maxBuffered` that is not a positive integer.

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

#### Scenario: A malformed sync call
- **WHEN** a sync names no family, a repeated or malformed family or more than 32, or has a bad `timeoutMs` or `maxBuffered`
- **THEN** it is refused with `invalid-request`

### Requirement: Serve sync from the owner's current state

The SDK SHALL give each participant `serveSync(families, provider)`. One owner SHALL serve each family; a `serveSync` naming a family that another owner serves SHALL be refused with `invalid-state`, and malformed families with `invalid-request`. The owner SHALL handle one sync request at a time and SHALL ignore a request at or past its expiry. The provider SHALL receive the request and return `{revision, states}`, one state draft per entity, or an error body. The SDK SHALL send each state as a state message from the owner, then `sync.completed` with the `requestId`, the revision and the members. It SHALL send them straight to the requester, never to subscribers, continuing the request's trace.

A sync request SHALL be refused in the shared error body, naming its `requestId` and trace ID, with no `sync.completed`:
- with the provider's error body;
- `internal` when the provider throws, or its snapshot holds a state outside the requested families, without an entity ID or above the snapshot's revision, has a revision that is not a whole number from 0, or holds more than 4096 states; the error SHALL also go to `onError`;
- `unavailable` when no owner serves a family, the owner closed before serving it, or no answer came by the deadline;
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

#### Scenario: One owner per family
- **WHEN** a second owner serves a family that one owner already serves, or a sync names families of two owners
- **THEN** the first is refused with `invalid-state` and the second resolves as `rejected` with `invalid-request`, while a sync of one owner's families succeeds

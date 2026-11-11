## MODIFIED Requirements

### Requirement: Sync a consumer's copy from its owner

The SDK SHALL give each participant `sync(families, handler, {timeoutMs, maxBuffered, parent, owner})`, which keeps a copy of one owner's families. `owner`, when given, SHALL be the owning participant's source, such as `bunny/modules/lifx`: every sync request of the copy SHALL go to that owner, and a served answer whose `sync.completed` comes from another source SHALL be refused with `unavailable`, which ends a first sync or the copy. A copy without `owner` SHALL send each request to its families' only owner and SHALL follow the owner whose `sync.completed` first served it; a later served answer from another source SHALL be refused with `unavailable`, which ends the copy, so a copy never holds two owners' records. Every copy SHALL follow only the live messages whose `source` is the owner it follows: another source's state or removal on a synced family SHALL NOT change the copy or be reported to `onError`, a named copy SHALL NOT buffer it, and a message that waited in the buffer from another source than the owner that served the answer SHALL NOT be applied. It SHALL subscribe to `bunny.state.<family>.*` for each family before it sends any sync request of kind `sync-request` with a `requestId`, the families and `expiresat` set `timeoutMs` after its `time`, even when an overflow comes first. An entity SHALL be a state's schema family and `data.id`, or a removal's `data.entity`, at its `data.revision`.

Until the owner answers, live messages SHALL wait in a buffer of at most `maxBuffered` messages, 1024 by default. On the answer, the copy SHALL first take the owner's states. It SHALL then drop each held entity that is not a member and is at or below the sync revision, and apply each buffered message above the revision in order. Only then SHALL the handler be told about each change in that order: `updated`, `removed` and `synced`, so that when `synced` is told the copy has applied the snapshot and every buffered message above its revision. A change applied to the copy SHALL always be told, unless the copy was closed first.

After a sync, the copy SHALL apply live messages in order, with the same buffer bound while its handler catches up. It SHALL drop a duplicate, a revision older than the one it holds, anything at or below the sync revision, and a state at or below the revision of a removal it applied. A live message from the owner the copy follows that names no entity of the synced families SHALL be reported to `onError` and ignored.

A buffer overflow, or a message dropped on one of the copy's subscriptions, SHALL make the copy want a new sync, and a served answer to a request sent before the latest overflow SHALL NOT be applied; a refusal still ends the first sync or the copy. Each such overflow SHALL be reported to the bus's `onSyncRestart` with the copy's source and `sync <families>` as its pattern. A copy SHALL have at most one sync request outstanding: it SHALL send the next one only when no other is outstanding and its handler is not running.

`sync` SHALL resolve with the copy after its first sync. If that sync is refused, `sync` SHALL resolve as `rejected` with the shared error body instead. If it has not completed within `timeoutMs` of its first request, `sync` SHALL resolve as `rejected` with `unavailable`, naming the last request it sent; each later request of the first sync SHALL get only the time left. Only the first request SHALL join `parent`'s trace; a later request SHALL start its own. After that, a sync that cannot be served SHALL end the copy with a `failed` change; the copy SHALL keep its last records. The one exception is a later sync that a transport whose stream reconnects answers as `interrupted`, because it was refused `unavailable` while the stream it went out under was lost (Hub #1700): the copy SHALL NOT end or hear `failed`, SHALL stay syncing with its last records and apply no live message, as during the reconnect, and SHALL send its next request only when the reconnect's gap notice, or another overflow, wants one. A first sync answered `interrupted` SHALL resolve as `rejected` with its error body, as before. A refused or failed copy SHALL follow nothing more, however many messages arrive. Closing a copy SHALL withdraw its outstanding request, and a first sync still under way SHALL resolve as `rejected` with `cancelled`. A copy closed while it is still subscribing to its families SHALL make no further subscription and SHALL close the one it was making. A request that the transport rejects or throws on SHALL be reported to `onError` and refused with `unavailable`. A family list that is empty, longer than 32, repeated, not made of family names or longer than 256 characters joined SHALL be refused with `invalid-request`. So SHALL a `timeoutMs` that is not an integer from 1 to `MAX_TIMEOUT_MS`, a `maxBuffered` that is not a positive integer, and an `owner` that is not a participant source, before any request is sent.

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

#### Scenario: A later sync that meets a lost stream
- **WHEN** a copy's resync is answered `interrupted` and a live message then arrives
- **THEN** the handler hears no `failed`, the copy keeps its last record and applies nothing, and only the next gap notice sends a request, whose served answer the handler hears as usual

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

## ADDED Requirements

### Requirement: A remote resync survives a reconnect

The remote client SHALL answer a copy's sync request as `interrupted`, with the refusal's error body, when the request is refused `unavailable`, by the edge, by its deadline or because the edge could not be reached, while the stream it went out under is lost: that stream was lost or replaced before the answer, or no stream was open when it went out (Hub #1700). A request that could not reach the edge while its stream still looks open SHALL wait, within the request's own deadline, to hear whether that stream is lost; if the stream stays open, the refusal SHALL be passed on unchanged and end the copy as before. Any refusal with another code, and any refusal while the stream it went out under stays open, SHALL be passed on unchanged. The repeat SHALL be paced by the reconnect alone: the client SHALL send no request of its own and SHALL add no timer, retry loop, message format or error shape, so a copy ends only when its participant closes or a refusal ends it. A sync only reads, so this repeat is a resync after reconnection under ADR 0012's retry rule and never resends a command.

#### Scenario: A reconnect that straddles a second restart
- **WHEN** the runtime restarts again while the reconnect from a first restart registers a copy's family, and the resync that the reconnect's gap notice starts cannot reach the edge
- **THEN** the copy neither fails nor takes anything new, and once the next reconnect's gap notice arrives it syncs to the owner's current state

#### Scenario: A refused resync heard before the lost stream
- **WHEN** a resync cannot reach the edge and the client hears afterwards that its stream was lost, as when a runtime stops with both open
- **THEN** the copy waits, and syncs again after the next reconnect

#### Scenario: A refused resync while the stream stays open
- **WHEN** a resync cannot reach the edge and its stream stays open until the request's deadline
- **THEN** the handler hears `failed` with `unavailable` at that deadline

#### Scenario: Another refusal during a reconnect
- **WHEN** a resync is refused `forbidden` while the stream is lost
- **THEN** the handler hears `failed` with `forbidden`

## MODIFIED Requirements

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

### Requirement: Carry the SDK calls to remote parts over SSE and HTTP

The SDK SHALL offer a `RemoteEdge` on an in-process bus and a client, `connectRemote`, that gives a remote part the same calls as a module. Messages SHALL flow down one `text/event-stream` per connection at `GET /api/sdk/v1/stream`, and calls SHALL go up as `POST /api/sdk/v1/<call>`. Every frame SHALL carry `schema` `sdk-remote/1.0`, and every refusal SHALL be the shared error body.

- **Credentials:** each remote source SHALL have a bearer token, compared in constant time. The edge SHALL refuse at start a grant with a malformed source or a token that two grants share. A call without a granted token SHALL be refused with `unauthenticated`. A message or connection of another source SHALL be refused with `forbidden`, including a close, reply or sync answer on another source's connection. A token SHALL NOT appear in any message, log record or error body.
- **Validation:** the client SHALL build every message, which keeps its own `id` and `time`. The edge SHALL validate each inbound message against profile 2.0, its registered payload schema and the 256 KiB cap, with its clock, and SHALL refuse a failing one with the validator's code (`invalid-message`, `too-large`, `unknown-schema`, `unsupported-version` or `expired`) before it reaches the bus. It SHALL refuse a sync request whose subject is not its families joined by commas with `invalid-message`, and a call body over its limit with `too-large` without reading the rest. It SHALL rebuild a remote responder's or owner's refusal as the shared error body, with its registered code and at most 1024 characters of detail, and SHALL drop anything else it carried.
- **Subscriptions:** `subscribe` SHALL resolve only once the edge has registered the subscription.
- **A slow consumer:** the edge SHALL wait for a connection's socket to drain before it writes the next message of a subscription, so a remote part that stops reading fills only its own subscriptions' bounded queues. Their drops SHALL be reported to `onError` as `capacity` and sent to the remote part as an overflow notice with the count.
- **Reconnects:** a client whose stream is lost SHALL reconnect, queue a gap notice with no count for each subscription before any message of the new stream, register its subscriptions, responders and sync owners again, and only then deliver the notices. Nothing missed SHALL be replayed. A call that needs the stream and meets a lost one SHALL be refused with the retryable `unavailable`, and a registration that failed SHALL leave nothing at the edge.
- **A failed remote responder:** a remote responder whose handler throws, or answers with something other than a valid reply, SHALL report the error to its `onError` and answer the edge with `{"status": "uncertain"}`. The edge SHALL then settle the request `uncertain` with `uncertain-result` and the fixed detail, with no reply message, as in process; it SHALL NOT refuse it.
- **Safe errors:** the edge SHALL answer an exception it did not expect with `internal` and the fixed detail `the edge failed`, in the response and in its log record. Once it has handed a command to its bus, it SHALL answer one with `uncertain-result` and the fixed detail `the edge failed after it sent the command` instead, because a handler may have run it. A refusal's detail MAY quote what the caller sent, such as a path, a claimed source, an id or an attribute the validator refused. An exception's message, stack and cause SHALL NOT reach any response or log record.
- **Edge answers at the client:** the client SHALL take an edge refusal only with a registered code and that code's flag, and SHALL treat any other body as `internal`. It SHALL settle a command whose request call the edge answers with `internal` or `uncertain-result` as `uncertain` with `uncertain-result`, because the edge may have failed after the command reached a handler; any other refusal SHALL stay `rejected`.
- **A dropped stream:** the edge SHALL NOT answer a forwarded command whose frame reached the socket as a refusal, whether its stream dropped, the edge closed or its own wait ran out. A reply that comes on the reconnected stream SHALL still reach the requester, matched by the forwarded command's message id, so a retry that reuses a `requestId` gets its own reply. Otherwise the request SHALL settle `uncertain` with `uncertain-result` and no reply message. A forwarded command whose frame never reached the socket, and a forwarded sync request, SHALL be refused with `unavailable`. A prepared command whose requester has already stopped waiting SHALL be refused with `cancelled` and never run.
- **Deadlines:** the deadline answers SHALL be those in process. The edge SHALL answer when its bus settles: `expired` for a command still queued at its deadline, `uncertain-result` for one a handler had, otherwise the reply, and `unavailable` for a sync request. A remote requester SHALL wait `REQUESTER_GRACE_MS` (1 s) past its deadline, on its scheduler, for that answer, and only then settle a command as `uncertain-result` and a sync as `unavailable`. An edge `expired` refusal of a remote part's own sync request SHALL reach it as the retryable `unavailable`. A remote responder or owner SHALL ignore a command or sync request that reaches it past its expiry.
- **Close:** a remote participant SHALL be a participant whose `close` returns the same promise every time. It SHALL first settle each request still waiting for the edge as `uncertain-result`, drop its call and cancel its deadline and the reconnect backoff; the edge SHALL then take a still-queued command out. It SHALL then close its sync copies, so a first sync still under way resolves `cancelled`; a copy's withdrawn request SHALL drop its HTTP call, and the edge SHALL take the request out of the owner's queue, so the owner never serves it. Every later call SHALL be refused with `invalid-state`.
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
- **THEN** a remote copy that syncs again ends with `failed` and `too-large`, a first sync resolves `rejected` with `too-large`, and the edge logs the refusal

#### Scenario: An exception inside the edge
- **WHEN** the edge throws while it answers a sync, with an exception whose message holds a synthetic secret
- **THEN** the remote part's sync and a raw call each get `internal` with the detail `the edge failed`, the edge logs each refusal with that detail, and the secret reaches no response, log record or reported error

#### Scenario: An edge failure after dispatch
- **WHEN** the edge's bus runs a remote part's command and the edge then fails while it answers
- **THEN** the requester gets `uncertain` with `uncertain-result` and the detail `the edge failed after it sent the command`, the handler ran the command once, and the edge logs that refusal

#### Scenario: Edge answers outside the registry
- **WHEN** an edge answers a call with an unregistered code, the wrong flag or no code, or answers a command's request call with `internal`
- **THEN** the client reports the first three as `internal`, and settles the command as `uncertain` with `uncertain-result`; an edge refusal such as `invalid-message` still makes the request `rejected`

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

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant and clock. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id`, `time` and trace context it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out, and `transaction` SHALL reject with it. The type of `work` SHALL refuse a promise, and work that returns one anyway SHALL roll back with a `TypeError`, leaving its promise handled. A database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. Once the work commits, `transaction` SHALL resolve with the work's result after the publish ends and SHALL NOT reject, so no caller takes a refused publish for a rollback and does the work again. If publishing is refused after the commit, the messages SHALL stay stored, unpublished, and the next transaction or start SHALL send them unchanged; nothing SHALL send them again on its own. The outbox SHALL report the refusal to its `onError` as an `SdkError` with the refusal's registry code, or `internal` for an error without one, the fixed detail `committed, awaiting publication` and the refusal as its `cause`, once per run of refusals with the same code; it SHALL report again only after a send went through or the code changed. Without an `onError`, the report SHALL become a `BunnySdkWarning` process warning. Given a validator, `add` SHALL check each message against it and refuse a message it refuses with the validator's code, rolling the transaction back. A refusal that lasts holds back every later message, which waits behind the refused one in commit order.

A state, removal or occurrence message SHALL be deleted once it has gone out, so it is never sent again. An outcome SHALL stay stored after it goes out until `acknowledge(id)` deletes it; `acknowledge` SHALL return whether the outbox held that outcome. `republish()` SHALL send, in order, everything still stored: messages a crash kept from going out, and every outcome not yet acknowledged. It SHALL resolve with how many went out. The consumer drops duplicates by `(source, id)`. Nothing SHALL forget a message by time.

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

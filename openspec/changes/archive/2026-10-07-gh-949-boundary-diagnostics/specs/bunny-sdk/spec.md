## ADDED Requirements

### Requirement: Decision records at the SDK's boundaries

The bus, the remote edge and the remote client SHALL each take an optional `onDiagnostic(diagnostic)` callback, a no-op by default, and SHALL report each decision they make to it exactly once, at the level ADR 0012 sets. A diagnostic SHALL be a closed record of an event, a level and values the SDK has already validated: the participant's source, the command's routing key or `sync <families>`, the request ID, the message ID, an outcome, a 2.0 registry code, the edge's route, an exception's type and an attempt count, with the trace context of the work. It SHALL NOT hold a payload, an error object, an exception's message or a credential. The events and their levels SHALL be:
- `command.admitted`, INFO: the bus put a command in its owner's queue;
- `command.refused`, WARN: the bus refused a command that never reached a handler because no responder owns its key, its owner's queue is full, its deadline passed while it waited or it reached the handler past its expiry, its responder closed, or the edge could not deliver it;
- `command.cancelled`, INFO: its requester closed or stopped waiting before a handler started it;
- `command.replied`, INFO: the owner replied, `accepted` or with its typed refusal and code;
- `command.uncertain`, WARN: the handler had the command and the request ended `uncertain-result`;
- `sync.served`, INFO, and `sync.refused`, INFO for the owner's typed refusal or a cancellation and WARN otherwise: the bus's answer to a sync request;
- `sync.restarted`, DEBUG: an overflow restarted a copy's sync;
- `edge.connected` and `edge.disconnected`, INFO; `edge.refused`, WARN for `unauthenticated`, `forbidden`, `capacity`, `unavailable` and `internal` and INFO for other validation refusals, and INFO with `cancelled` for a call its caller dropped while the edge read it; `edge.failed`, ERROR, with the code it answered: the edge's own decisions;
- `remote.disconnected`, WARN, and `remote.reconnected`, INFO: the remote client's stream;
- `remote.command.uncertain`, WARN: the remote client settled a request `uncertain-result` itself, because the edge answered `internal` or `uncertain-result`, could not be heard by its deadline and grace, or the requester closed first.

Every record about one request SHALL be made at its admission or inside its one settlement, so a late reply, a second deadline or a close after it settled makes none. A call that the SDK refuses with `SdkError` SHALL make no bus record; the edge SHALL record its refusal of a remote call. A catch that only passes an error to `onError` SHALL record nothing. A record that the edge makes before it authenticates a call SHALL carry only its route, which is one of the edge's calls or `other`, and its code. A callback that throws SHALL NOT change a result and SHALL NOT be called again about its own failure.

#### Scenario: One record for each command decision, on both transports
- **WHEN** commands are accepted, refused by their owner, sent with no responder, refused by a full queue, expired in the queue, cancelled while queued, held by a handler past the deadline and failed by a handler that throws, in process and through the edge
- **THEN** each request makes exactly one admission record when it reached the queue and exactly one ending record at its level, every record carries the request ID, the requester's source, the routing key and the command's trace, and a late reply makes none

#### Scenario: Concurrent requests keep their own trace
- **WHEN** two requests from different traces wait in the same owner's queue and both end
- **THEN** each record carries only its own request's trace and request ID

#### Scenario: Sync decisions
- **WHEN** a sync is served, refused by its owner, refused for no owner, and a copy's overflow restarts its sync
- **THEN** each makes one record at its level with the copy's source and `sync <families>`

#### Scenario: A failing callback
- **WHEN** `onDiagnostic` throws on every record
- **THEN** every request, sync and edge call ends exactly as it does without the callback, and nothing reports the callback's failure

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

An `Outbox` given the module's `log` SHALL record an outcome's first publication once, as `outcome.published` at INFO for `succeeded` and WARN for `failed` or `uncertain`, with its request ID, message ID, outcome and error code and the outcome's own trace context. Publishing a stored outcome again SHALL make no such record. A publish refused after the commit SHALL make one `outbox.deferred` record at WARN with the refusal's code and the count of messages still waiting, once per run of refusals, in place of the report to `onError`; a refusal that `republish()` passes on to its caller SHALL make none. Given the module's `trace`, the outbox SHALL record a `bunny.outcome.publish` span for each outcome it sends: a child of the outcome's stored context when the same transaction stored it, and otherwise a new root linked to that context, never a child of it, as after a restart or a deferred publish. Without them, the outbox SHALL record nothing.

#### Scenario: First publication and replay
- **WHEN** a transaction stores and publishes an outcome, and the module restarts and republishes it
- **THEN** there is exactly one `outcome.published` record, in the outcome's trace, the first publish span is the stored context's child, and the replayed one is a root linked to it

#### Scenario: A deferred publish
- **WHEN** a transaction commits while its publish is refused, and a later transaction publishes the waiting messages
- **THEN** one `outbox.deferred` warning names the code and the waiting count, a second refused transaction in that run makes none, `onError` hears nothing, the outcome's publication is recorded once when it goes out, and its publish span links to its stored context

### Requirement: Device availability

The SDK SHALL offer `DeviceAvailability`, which takes a module's `log` and clock. `unreachable(device, code, trace?)` SHALL log a device's first failure as one `device.unavailable` record at WARN, and SHALL count later failures and log them as one `device.unavailable` summary at DEBUG with `bunny.attempt_count` at most once a minute. `reached(device, trace?)` after failures SHALL log one `device.available` record at INFO with the count of failed attempts and the outage's duration; while the device is available it SHALL log nothing.

#### Scenario: A polled device that stays offline
- **WHEN** a device fails 200 polls over ten minutes and then answers
- **THEN** at INFO and above there is one `device.unavailable` warning and one `device.available` record that counts 200 failures, and at DEBUG at most one summary a minute

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

## MODIFIED Requirements

### Requirement: Carry the SDK calls to remote parts over SSE and HTTP

The SDK SHALL offer a `RemoteEdge` on an in-process bus and a client, `connectRemote`, that gives a remote part the same calls as a module. Messages SHALL flow down one `text/event-stream` per connection at `GET /api/sdk/v1/stream`, and calls SHALL go up as `POST /api/sdk/v1/<call>`. Every frame SHALL carry `schema` `sdk-remote/1.0`, and every refusal SHALL be the shared error body.

- **Credentials:** each remote source SHALL have a bearer token, compared in constant time. The edge SHALL refuse at start a grant with a malformed source or a token that two grants share. A call without a granted token SHALL be refused with `unauthenticated`. A message or connection of another source SHALL be refused with `forbidden`, including a close, reply or sync answer on another source's connection. A token SHALL NOT appear in any message, diagnostic, log record or error body.
- **Validation:** the client SHALL build every message, which keeps its own `id` and `time`. The edge SHALL validate each inbound message against profile 2.0, its registered payload schema and the 256 KiB cap, with its clock, and SHALL refuse a failing one with the validator's code (`invalid-message`, `too-large`, `unknown-schema`, `unsupported-version` or `expired`) before it reaches the bus. It SHALL refuse a sync request whose subject is not its families joined by commas with `invalid-message`, and a call body over its limit with `too-large` without reading the rest. It SHALL rebuild a remote responder's or owner's refusal as the shared error body, with its registered code and at most 1024 characters of detail, and SHALL drop anything else it carried.
- **Subscriptions:** `subscribe` SHALL resolve only once the edge has registered the subscription.
- **A slow consumer:** the edge SHALL wait for a connection's socket to drain before it writes the next message of a subscription, so a remote part that stops reading fills only its own subscriptions' bounded queues. Their drops SHALL be reported to `onError` as `capacity` and sent to the remote part as an overflow notice with the count.
- **Reconnects:** a client whose stream is lost SHALL reconnect, queue a gap notice with no count for each subscription before any message of the new stream, register its subscriptions, responders and sync owners again, and only then deliver the notices. Nothing missed SHALL be replayed. It SHALL report the lost stream once to `onDiagnostic` as `remote.disconnected` at WARN and the recovery as `remote.reconnected` at INFO with the count of failed attempts, and SHALL NOT report each failed attempt to `onError`. A call that needs the stream and meets a lost one SHALL be refused with the retryable `unavailable`, and a registration that failed SHALL leave nothing at the edge.
- **A failed remote responder:** a remote responder whose handler throws, or answers with something other than a valid reply, SHALL report the error to its `onError` and answer the edge with `{"status": "uncertain"}`. The edge SHALL then settle the request `uncertain` with `uncertain-result` and the fixed detail, with no reply message, as in process; it SHALL NOT refuse it.
- **Safe errors:** the edge SHALL answer an exception it did not expect with `internal` and the fixed detail `the edge failed`. Once it has handed a command to its bus, it SHALL answer one with `uncertain-result` and the fixed detail `the edge failed after it sent the command` instead, because a handler may have run it. It SHALL report either once to `onDiagnostic` as `edge.failed` at ERROR with the code it answered, the route, the granted source if any and the exception's type, never as a refusal. A refusal's detail MAY quote what the caller sent, such as a path, a claimed source, an id or an attribute the validator refused. A refusal's diagnostic SHALL carry its code, never its detail. An exception's message, stack and cause SHALL NOT reach any response, diagnostic or log record.
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
- **THEN** the requester gets `uncertain` with `uncertain-result` and the detail `the edge failed after it sent the command`, the handler ran the command once, the bus records the command's admission and reply, the edge reports one `edge.failed` with `uncertain-result`, and the client reports one `remote.command.uncertain`

#### Scenario: Edge answers outside the registry
- **WHEN** an edge answers a call with an unregistered code, the wrong flag or no code, or answers a command's request call with `internal`
- **THEN** the client reports the first three as `internal`, and settles the command as `uncertain` with `uncertain-result`, reporting `remote.command.uncertain`; an edge refusal such as `invalid-message` still makes the request `rejected`, with no client diagnostic

### Requirement: Per-module outbox

The SDK SHALL give a module an `Outbox` on its own SQLite database, participant and clock. `transaction(work)` SHALL run synchronous `work` in one transaction that the outbox opens. Each message that `add(key, draft, {parent?})` stores SHALL commit with the work's changes and SHALL be published only after the commit, in commit order, unchanged, with the `id`, `time` and trace context it was stored with. A throw SHALL roll back the work and its messages, so nothing goes out, and `transaction` SHALL reject with it. The type of `work` SHALL refuse a promise, and work that returns one anyway SHALL roll back with a `TypeError`, leaving its promise handled. A database already in a transaction SHALL be refused with `invalid-state`. `add` SHALL refuse with `invalid-request`, rolling the transaction back, any kind other than state, removal, occurrence and outcome, and any key outside the kind's key class, so no command is ever stored or sent again. Once the work commits, `transaction` SHALL resolve with the work's result after the publish ends and SHALL NOT reject, so no caller takes a refused publish for a rollback and does the work again. If publishing is refused after the commit, the messages SHALL stay stored, unpublished, and the next transaction or start SHALL send them unchanged; nothing SHALL send them again on its own. The outbox SHALL report the refusal once per run of refusals with the same code, and again only after a send went through or the code changed, in one place: given the module's `log`, as one `outbox.deferred` record, as "Outbox records and spans" requires; otherwise to its `onError` as an `SdkError` with the refusal's registry code, or `internal` for an error without one, the fixed detail `committed, awaiting publication` and the refusal as its `cause`. Without an `onError`, the report SHALL become a `BunnySdkWarning` process warning that names the code and the fixed detail, never the refusal's message. `republish()` SHALL pass a refusal on to its caller, which it rejects, and SHALL NOT report it. Given a validator, `add` SHALL check each message against it and refuse a message it refuses with the validator's code, rolling the transaction back. A refusal that lasts holds back every later message, which waits behind the refused one in commit order.

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

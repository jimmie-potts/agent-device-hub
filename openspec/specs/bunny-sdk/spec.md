# bunny-sdk Specification

## Purpose
Define the SDK's in-process bus under ADR 0012: publish and subscribe by routing key, request and respond with expiry and the shared error body, per-subscriber delivery and W3C trace propagation. It is a source library that the runtime, sync and the remote transport build on, and it claims no running runtime, transport or device behavior.

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
- `rejected`, with the shared error body: the responder's refusal, `internal` when the responder throws, `unavailable` when no responder owns the key or it closed before the command reached it, or `capacity` when its queue is full;
- `uncertain`, with `uncertain-result`, when the deadline passes first.

The SDK SHALL never send a command again and SHALL ignore a reply that arrives after the deadline. Every error body in a result SHALL carry the `requestId` and the command's trace ID. A responder SHALL handle one command at a time. It SHALL ignore a command whose expiry has passed, at or after `expiresat`, and send no reply to it.

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
- **WHEN** no reply arrives before the deadline
- **THEN** the request stays pending until the deadline, then resolves as `uncertain` with `uncertain-result`, which is not retryable; a later reply changes nothing, and the responder receives the command only once

#### Scenario: An expired command is ignored
- **WHEN** a command's expiry passes while it waits behind another command, or the command reaches the responder exactly at its expiry
- **THEN** the responder's handler never receives it, and the responder still handles later commands

#### Scenario: One owner per key
- **WHEN** a second responder registers a pattern that overlaps the first responder's
- **THEN** it is refused with `invalid-state`, and it can register after the first responder closes

### Requirement: Per-subscriber delivery

Each subscription and each responder SHALL have its own queue, which delivers one message at a time in publish order. A slow handler SHALL delay only its own queue, never the sender, other subscribers or requests. `publish` SHALL NOT wait for any handler, and no handler SHALL run inside the sender's call. Each queue SHALL hold at most `maxQueued` waiting messages, 1024 by default; a `maxQueued` that is not a positive integer SHALL throw `RangeError`. When a subscription's queue is full, a new message SHALL be dropped for that subscription only, and `onError` SHALL receive an `SdkError` with code `capacity`. When a responder's queue is full, the requester SHALL get a `rejected` result with `capacity` instead. A handler that throws SHALL be reported to `onError` and SHALL keep receiving. Without an `onError`, each report SHALL become a `BunnySdkWarning` process warning whose message names the source and pattern, with the original error as its `cause`. Closing a subscription SHALL drop its waiting messages and resolve when its running handler finishes. Called from inside that handler, it SHALL resolve without waiting for it.

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

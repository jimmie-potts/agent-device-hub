# B.U.N.N.Y. SDK

Private workspace package `@jimmie-potts/sdk`. It is the one way B.U.N.N.Y. parts
talk, as [ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) decides.
This version holds the in-process bus: `publish`, `subscribe`, `request`,
`respond`, `sync` and its owner side, `serveSync`. Nothing runs it yet. Later
stories add the module host (#880) and the SSE/HTTP remote transport (#883)
without changing these calls, so a module never sees which transport carries its
messages.

Messages are [profile 2.0](../event-contracts/README.md#profile-20) envelopes.
They pass in process as plain objects, never copied or serialized. The bus does
not validate them; the tests check every message they see against profile 2.0.

## Use

```ts
import {InProcessBus} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';

const bus = new InProcessBus({onError: (error, {source, pattern}) => log(error, source, pattern)});
const core = bus.connect('bunny/core');
const wall = bus.connect('bunny/modules/nanoleaf');

await core.subscribe('bunny.state.session.*', message => show(message.data));
await core.publish('bunny.state.session.s1', {
  kind: 'state', type: 'org.bunny.session.updated', subject: 's1',
  dataschema: 'https://bunny.invalid/events/session/2.0', data: {id: 's1', revision: 7},
});

await wall.respond('bunny.cmd.mode.*', command =>
  wallIsOn() ? {status: 'accepted'} : errorBody('invalid-state', {detail: 'the wall is off'}));
const result = await core.request('bunny.cmd.mode.wall', {
  type: 'org.bunny.mode.set.requested', subject: 'wall',
  dataschema: 'https://bunny.invalid/events/mode/2.0', data: {mode: 'quiet'},
}, {timeoutMs: 5000});

await core.serveSync(['session'], () => ({revision: store.revision, states: store.sessionDrafts()}));
const synced = await wall.sync(['session'], change => show(change), {timeoutMs: 5000});
if (synced.status === 'synced') render(synced.copy.states());
```

## API

`new InProcessBus(options)` creates a bus. All options are optional:
- `now()`: the clock, in epoch milliseconds, for `time`, `expiresat` and expiry
  checks. Defaults to `Date.now()`.
- `maxQueued`: how many messages may wait in one subscription's or responder's
  queue. Defaults to 1024. A value that is not a positive integer throws
  `RangeError`.
- `onError(error, {source, pattern})`: receives handler errors and dropped
  deliveries. By default, each one becomes a `BunnySdkWarning` process warning
  whose message names the source and pattern, with the original error as its
  `cause`.

`bus.connect(source)` returns an `Sdk` for one participant. `source` is its
CloudEvents source, such as `bunny/core`; a malformed source throws `SdkError`
at once. Each message the participant sends gets that
source, a new `id`, the current `time`, the fixed profile attributes and a
`traceparent`. Callers supply only `kind`, `type`, `subject`, `dataschema` and
`data`.

The `Sdk` calls:

| Call | What it does |
| --- | --- |
| `publish(key, draft, {parent?})` | Queues a state, removal, occurrence or outcome message for every matching subscriber and resolves with the message. It never waits for a handler. |
| `subscribe(pattern, handler)` | Delivers matching messages to `handler`, one at a time and in publish order. |
| `request(key, draft, {timeoutMs, requestId?, parent?})` | Sends one command to the responder that owns `key` and resolves with its reply, a refusal or an uncertain result. The command's outcome is a separate message that the owner publishes. |
| `respond(pattern, responder)` | Answers commands whose keys match. `responder` returns `{status: 'accepted'}` or an error body from `errorBody`. |
| `sync(families, handler, {timeoutMs, maxBuffered?, parent?})` | Keeps a copy of one owner's families: its current state at a revision, then live messages. See [Sync](#sync). |
| `serveSync(families, provider)` | Answers sync requests for `families` from the owner's current state. `provider` returns a snapshot or an error body. |

`subscribe` also takes `{onOverflow}`; see [Delivery](#delivery).

`subscribe`, `respond` and `serveSync` resolve with a subscription. Its
`close()` stops delivery, drops queued messages and resolves when a running
handler finishes. Called from inside its own handler, `close()` resolves at once
instead of waiting for that handler, and a responder that closes itself still
sends its reply.

A malformed call, such as a bad routing key, rejects with `SdkError`. Its
`body` is the shared error body, here with code `invalid-request`.

## Routing keys

Keys follow ADR 0012: `bunny.<state|event|cmd>.<family>.<id>`. Each token is
lowercase letters and digits, with single hyphens inside it. A pattern is a key
in which `*` stands for any one of the last three tokens, for example
`bunny.state.session.*` or `bunny.*.session.s1`.

Each kind has its own key class:
- state and removal messages use `bunny.state` keys;
- occurrence and outcome messages use `bunny.event` keys;
- commands use `bunny.cmd` keys, through `request` and `respond` only.

Replies go straight back to their requester. Sync messages use no routing key:
a sync request goes to the one owner of its families, and the answer goes
straight back to the requester, never to subscribers.

## Requests

- `request` adds `requestId` to the command's payload, so command payload
  schemas include it. Pass `requestId` to choose it, for example after recording
  the request; otherwise one is generated.
- The command's `type` must end in `.requested`; `request` refuses any other
  with `invalid-request`. The reply's type ends in `.replied` instead.
- The command's `expiresat` is `timeoutMs` after its `time`. `timeoutMs` is an
  integer from 1 to 2147483647.
- One responder owns each command key. A `respond` whose pattern overlaps
  another responder's is refused with `invalid-state`.
- A responder handles one command at a time. If a command's expiry passes while
  it waits, the responder ignores it and nothing answers it.

`request` resolves with one of these results:

| Status | When | `error` code |
| --- | --- | --- |
| `accepted` | The responder accepted. `reply` is the reply message. | none |
| `rejected` | The responder refused, with its error body and the `reply`. | the responder's |
| `rejected` | The responder threw. The error also goes to `onError`. | `internal` |
| `rejected` | No responder owns the key, or it closed before the command reached it. | `unavailable` |
| `rejected` | The responder's queue is full. | `capacity` |
| `uncertain` | The deadline passed first. The command may have taken effect. | `uncertain-result` |

The SDK never sends a command twice, and a reply that arrives after the
deadline is ignored. Error bodies carry the `requestId` and the command's trace
ID.

## Delivery

Each subscription and each responder has its own queue. A slow handler delays
only its own queue, never the sender, other subscribers or requests. Handlers
never run inside the sender's call. A handler that throws is reported to
`onError` and keeps receiving.

A queue holds at most `maxQueued` waiting messages. When a subscription's queue
is full, a new message is dropped for that subscription only, and `onError`
receives an `SdkError` with code `capacity`. When a responder's queue is full,
the requester gets a `rejected` result with `capacity` instead.

A subscriber that passes `onOverflow` to `subscribe` is also told about the gap.
`onOverflow({dropped})` runs in the subscription's order, before the next message
is delivered, with the number of messages dropped since it was last told. It
says that messages were lost, not where: messages still waiting from before the
drop may follow it. A
subscriber that keeps a copy of state should sync again instead of continuing
with a gap; `sync` does this itself. An `onOverflow` that throws is reported to
`onError`, and delivery goes on.

Messages are shared, not copied. Treat a received message as read-only, and do
not change a message or its `data` after publishing it.

## Sync

Under ADR 0012, a consumer syncs from the owner when it connects or restarts.
`sync` does that for one owner's families, such as `['session']`, and then keeps
the copy current:

1. It subscribes to `bunny.state.<family>.*` for each family, then sends a sync
   request of kind `sync-request` with `expiresat` set `timeoutMs` after its
   `time`. No request goes out before every subscription exists, and a copy
   never has more than one request outstanding. Only the first request joins
   `parent`'s trace; a later one starts its own.
2. The owner's `provider` gets that request and returns `{revision, states}`:
   its current state at `revision`, as one state draft per entity, without
   `kind`. Each state carries `data.id` and a `data.revision` no greater than
   `revision`. The SDK sends those states, then `sync.completed` with the
   revision and the members. Past occurrences and removals are never sent.
3. Live messages that arrive meanwhile wait in a buffer of at most
   `maxBuffered` messages, 1024 by default.
4. The copy then takes the states and replaces its membership: an entity the
   owner no longer has disappears, unless it changed above the revision. Each
   buffered message above the revision then applies, in order.
5. After that, live messages apply as they arrive. A duplicate, a stale
   revision or anything at or below the last sync revision is dropped. A
   removal leaves a tombstone, so a late state below it cannot bring the
   entity back.

An entity is its schema family, from `dataschema`, and `data.id`; a removal
names it in `data.entity`. Both carry `data.revision`, which the owner raises
with every change.

`handler` hears of each change in order:

| Change | Meaning |
| --- | --- |
| `updated` | An entity's new current record, with its state `message`. |
| `removed` | An entity is gone, with its removal `message`, or with none when a sync dropped it. |
| `synced` | `message` is the `sync.completed`. The copy has applied the snapshot and every buffered change above its revision; the handler hears those buffered changes next. |
| `failed` | A later sync could not be served, with its `error` body. The copy stops following the owner but keeps its last records. |

`sync` resolves with `{status: 'synced', copy, message}` after the first sync,
or with `{status: 'rejected', requestId, error}` if that sync is refused or does
not complete within `timeoutMs` of its first request. A later request of the
first sync gets only the time left, and a first sync that runs out of time names
the last request it sent. The copy's `get(entity)`
and `states()` return current state messages, and `close()` stops it; a copy
closed while its handler runs hears no further change. A handler that throws is
reported to `onError`, and so is a live message that names no entity of the
synced families, which the copy ignores.

If the buffer overflows, or a subscription's queue drops a message, the copy
wants a new sync. It never combines partial state: a served answer to a request
sent before the overflow is not applied, though a refusal still ends the sync. The copy sends the next request only once
no other is outstanding and its handler has returned, so however often a busy
or stalled copy overflows, it asks the owner's shared queue for one sync at a
time. The buffer also holds live messages while the handler catches up, so a
handler that falls `maxBuffered` messages behind resyncs instead of hearing
each one.

One owner serves each family; a `serveSync` that names a served family is
refused with `invalid-state`. An owner may serve any number of families, but one
sync names at most 32 of them, in at most 256 characters joined by commas,
because the request's subject names them. A sync request is refused with the
shared error body, naming its `requestId` and trace ID, and no `sync.completed`
follows:

| Code | When |
| --- | --- |
| the provider's | The provider returned an error body from `errorBody`. |
| `internal` | The provider threw, or its snapshot does not fit the request. The error also goes to `onError`. |
| `unavailable` | No owner serves a family, the owner closed before serving it, no answer came by the deadline, the transport rejected or threw on it (also reported to `onError`), or the first sync ran out of time. |
| `capacity` | The owner's queue is full. |
| `invalid-request` | The families belong to more than one owner. |

An owner ignores a sync request past its expiry. A malformed call, such as an
empty or repeated family list, rejects with `SdkError` and `invalid-request`.

## Trace context

Every message carries W3C trace context. To continue the trace of the message
being handled, pass it as `parent`:

```ts
await core.subscribe('bunny.state.session.*', message =>
  core.publish('bunny.event.session.s1', turnEnded, {parent: message}));
```

The new message keeps the parent's trace ID, flags and `tracestate`, and gets a
new span ID. A reply continues its command's trace the same way. Without a
parent, or with a malformed or all-zero one, the message starts a new trace with
the sampled flag set.

## Checks

From the repository root, with Node 24, run `npm run test:sdk`. It builds and
runs the compiled tests in `dist/tests/`. See
[SDK checks](../../docs/development.md#sdk-checks).

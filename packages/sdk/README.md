# B.U.N.N.Y. SDK

Private workspace package `@jimmie-potts/sdk`. It is the one way B.U.N.N.Y. parts
talk, as [ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) decides.
This version holds the in-process bus: `publish`, `subscribe`, `request` and
`respond`. Nothing runs it yet. Later stories add sync (#881), the module host
(#880) and the SSE/HTTP remote transport (#883) without changing these calls, so
a module never sees which transport carries its messages.

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

`subscribe` and `respond` resolve with a subscription. Its `close()` stops
delivery, drops queued messages and resolves when a running handler finishes.
Called from inside its own handler, `close()` resolves at once instead of
waiting for that handler, and a responder that closes itself still sends its
reply.

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

Replies go straight back to their requester. Sync messages are left to sync
(#881).

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

Messages are shared, not copied. Treat a received message as read-only, and do
not change a message or its `data` after publishing it.

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

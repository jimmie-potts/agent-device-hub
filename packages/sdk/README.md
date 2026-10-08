# B.U.N.N.Y. SDK

Private workspace package `@jimmie-potts/sdk`. It is the one way B.U.N.N.Y. parts
talk, as [ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) decides.
It offers `publish`, `publishMessage`, `subscribe`, `request`, `respond`, `sync`
and its owner side, `serveSync`, over two transports: the in-process bus, and an
SSE/HTTP [remote transport](#remote-transport) for parts outside the runtime.
Both carry the same calls, so a module or remote part never sees which transport
carries its messages. It also holds the [module API](#modules) that the runtime
(`apps/runtime`) hosts, a module's [outbox](#outbox), the
[module test kit](#module-test-kit), and the [diagnostics and span
interface](#diagnostics-and-spans) that the runtime connects to its log and
tracing.

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
  whose message names the source, the pattern and the error's type, with an
  `SdkError`'s code, never the error's message; the original error is its
  `cause`, in memory.
- `onDiagnostic(diagnostic)`: hears each decision the bus makes about a command
  or a sync, once, at its level. A no-op by default. See
  [Diagnostics and spans](#diagnostics-and-spans).
- `spans`: a `SpanRecorder` for each command's request, queue and execute spans.
  By default nothing is recorded.
- `scheduler`: runs request and sync deadlines through
  `after(delayMs, callback)`, which returns a function that cancels the
  callback. Defaults to the global `setTimeout`. The runtime passes the
  scheduler and clock it gives its modules, so a module's deadlines follow the
  module's clock.
- `onSyncRestart({source, pattern})`: hears of each overflow that restarts a
  copy's sync, with the copy's source and `sync <families>` as its pattern. The
  runtime counts these per module in health, so a restart loop shows.

`bus.served(source)` lists the families a source serves through sync now, in the
order it registered them; the runtime's health shows it for each module.

`bus.connect(source)` returns a `Participant`: the `Sdk` calls for one
participant, plus [`close()`](#closing-a-participant). `source` is its
CloudEvents source, such as `bunny/core`; a malformed source throws `SdkError`
at once. Each message the participant sends gets that
source, a new `id`, the current `time`, the fixed profile attributes and a
`traceparent`. Callers supply only `kind`, `type`, `subject`, `dataschema` and
`data`.

The `Sdk` calls:

| Call | What it does |
| --- | --- |
| `publish(key, draft, {parent?})` | Queues a state, removal, occurrence or outcome message for every matching subscriber and resolves with the message. It never waits for a handler. |
| `publishMessage(key, message)` | Publishes a message built earlier, unchanged: its `id`, `time` and trace stay. An outbox resends a stored message this way. A message from another source is refused with `forbidden`, and one that is not published with `invalid-request`. |
| `subscribe(pattern, handler)` | Delivers matching messages to `handler`, one at a time and in publish order. |
| `request(key, draft, {timeoutMs, requestId?, parent?})` | Sends one command to the responder that owns `key` and resolves with its reply, a refusal or an uncertain result. The command's outcome is a separate message that the owner publishes. |
| `respond(pattern, responder)` | Answers commands whose keys match. `responder` returns `{status: 'accepted'}`, or refuses before it acts by returning an error body from `errorBody`. |
| `sync(families, handler, {timeoutMs, maxBuffered?, parent?, owner?})` | Keeps a copy of one owner's families: its current state at a revision, then live messages. `owner` names the owner by its source, as a family that several owners serve needs. See [Sync](#sync). |
| `serveSync(families, provider)` | Answers sync requests for `families` from this participant's current state. `provider` returns a snapshot or an error body. Only a shared family, `device`, may have other owners too. See [Owners](#owners). |

`subscribe` also takes `{onOverflow}`; see [Delivery](#delivery).

`subscribe`, `respond` and `serveSync` resolve with a subscription. Its
`close()` stops delivery, drops queued messages and resolves when a running
handler finishes. Called from inside its own handler, `close()` resolves at once
instead of waiting for that handler, and a responder that closes itself still
sends its reply.

Close detection follows the handler's async flow, not the call stack. A callback
that the handler awaits, but that an emitter created elsewhere invokes, runs
outside that flow, so its `close()` would wait for the very handler that waits
for it. Such a callback should call `void subscription.close()` instead of
awaiting it. Two handlers that await each other's close deadlock in the same
way.

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

ADR 0012's key shape ends each key in an entity's routing ID, and the profile makes that rule explicit
(`bunny-message-profile`, "A message's subject is its key's routing ID").
A command's `subject` is the entity it is for, so it must be its key's last
token: on every transport the bus refuses any other command with
`invalid-message` before a responder has it (Hub #835). The bus refuses a state
or removal whose subject is not its key's last token the same way, wherever it
is published, so a record never reaches a reader of another entity's key. A
responder that acts on the subject therefore acts on the key's entity, and a
grant of the key covers it. A remote edge checks the same of every message a remote part publishes.

Replies go straight back to their requester. Sync messages use no routing key:
a sync request goes to the owner it names, or to the one owner of its families,
and the answer goes straight back to the requester, never to subscribers.

## Requests

- `request` adds `requestId` to the command's payload, so command payload
  schemas include it. Pass `requestId` to choose it, for example after recording
  the request; otherwise one is generated.
- The command's `type` must end in `.requested`; `request` refuses any other
  with `invalid-request`. The reply's type ends in `.replied` instead.
- The command's `expiresat` is `timeoutMs` after its `time`. `timeoutMs` is an
  integer from 1 to `MAX_TIMEOUT_MS`, 86400000 (one day), on every transport.
- One responder owns each command key. A `respond` whose pattern overlaps
  another responder's is refused with `invalid-state`.
- A responder handles one command at a time. A command whose expiry passes
  before its handler starts never reaches the handler: at the deadline the bus
  takes it out of the responder's queue, and the requester gets `expired`. A
  command that reaches the responder at or after its expiry is skipped the same
  way.

`request` resolves with one of these results:

| Status | When | `error` code |
| --- | --- | --- |
| `accepted` | The responder accepted. `reply` is the reply message. | none |
| `rejected` | The responder refused, with its error body and the `reply`. | the responder's |
| `rejected` | No responder owns the key, or it closed before the command reached it. | `unavailable` |
| `rejected` | The responder's queue is full. | `capacity` |
| `rejected` | The deadline passed before the responder's handler started the command. | `expired` |
| `rejected` | The requester closed before the responder's handler started the command. | `cancelled` |
| `uncertain` | The handler threw, or answered with something other than a valid reply. The error also goes to `onError`. | `uncertain-result` |
| `uncertain` | The handler had the command when the deadline passed or the requester closed. | `uncertain-result` |

As ADR 0012's "Errors, effects and outcomes" says, `rejected` proves that the
command had no effect: it never reached the handler, or the handler refused it
with an error body before acting. Once the handler has started, an exception may
come after an effect, so the request is `uncertain`, never a refusal. This holds
for an `SdkError` from a call the handler makes, and for a throw before the
handler acted: the SDK cannot tell a throw before an effect from one after it.
A responder that can refuse should return its error body instead of throwing.

A refusal is valid only with a registered code and that code's `retryable`
flag, as `errorBody` builds it. The SDK rebuilds it with at most 1024
characters of detail and nothing else. An error body with an unregistered code,
the wrong flag or no code is not a reply, so its request is `uncertain`, on both
transports.

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
is delivered, with the number of messages dropped since it was last told. After
a remote reconnect the count is unknown, and `dropped` is absent. The notice says
that messages were lost, not where: messages still waiting from before the drop
may follow it. A subscriber that keeps a copy of state should sync again instead
of continuing with a gap; `sync` does this itself. An `onOverflow` that throws is
reported to `onError`, and delivery goes on.

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

`handler` hears of each change in order. Its `type` tells them apart:

| `type` | Meaning |
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
reported to `onError`, and so is a live message from the copy's owner that names
no entity of the synced families, which the copy ignores.

If the buffer overflows, or a subscription's queue drops a message, the copy
wants a new sync. It never combines partial state: a served answer to a request
sent before the overflow is not applied, though a refusal still ends the sync. The copy sends the next request only once
no other is outstanding and its handler has returned, so however often a busy
or stalled copy overflows, it asks the owner's shared queue for one sync at a
time. The buffer also holds live messages while the handler catches up, so a
handler that falls `maxBuffered` messages behind resyncs instead of hearing
each one.

### Owners

Sync ownership is keyed by source and family. Only a shared family may have
several owners, each for its own entities. Today that is `device`, which every
device module serves for its own devices; the SDK exports the list as
`SHARED_FAMILIES`. Every other family keeps one owner: a `serveSync` from
another source that names it is refused with `invalid-state`. A faulty
participant that serves the core's `session` is refused itself, so every
consumer that syncs `session` without an owner still reaches the core. A
participant serves each family once, shared or not. An owner may serve any
number of families, but one sync names at most 32 of them, in at most 256
characters joined by commas, because the request's subject names them.

A copy follows one owner:
- With `owner`, the owner's source such as `bunny/modules/lifx`, every request
  of the copy goes to that owner, and the copy follows only the live messages
  that owner publishes. Another owner's messages on the same family, its
  removals included, never enter the copy, its buffer or `onError`. An answer
  from another owner, as a transport that ignored `owner` could give, is no
  answer: it is refused as `unavailable`, which ends a first sync or the copy.
- Without `owner`, each request goes to the families' only owner, as before,
  and the copy follows the owner that first served it, the source of its
  `sync.completed`, as a named copy does. It never switches owners: a later
  answer from another owner, as when its owner stopped serving and another now
  serves the family alone, is refused as `unavailable` and ends the copy with
  `failed`, so one copy never holds two owners' records. While several owners
  serve one of the families, a request is refused with `invalid-request`,
  saying to name the owner, and it is never spread across them; a copy whose
  later request is refused so ends with `failed` too.

A consumer of a shared family always names its owner, even while only one owner
serves it: another may start at any time, and a sync that names none is then
refused. It syncs the family from each owner and keeps one copy per owner.
Nothing merges the owners' records, so each copy recovers on its own.

To learn the owners, a remote part, such as the dashboard, reads the runtime's
health: each module's entry lists the families it serves now in `serves`, and
a module's source is `bunny/modules/<name>`. It syncs only from those, so it
asks no module that serves nothing, which would only be refused as
`unavailable`. A module inside the runtime knows the device modules it shows,
from its code or its configuration. `bus.served(source)` gives the same list on
the bus.

```ts
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {SyncedCopy} from '@jimmie-potts/sdk';

type Health = {modules: {name: string; serves?: string[]}[]};
const {modules} = await (await fetch(new URL('/api/runtime/v1/health', runtimeUrl))).json() as Health;
const owners = modules.filter(module => module.serves?.includes('device') === true).map(module => `bunny/modules/${module.name}`);
const copies = new Map<string, SyncedCopy<DeviceRecord>>();
for (const owner of owners) {
  const synced = await sdk.sync<DeviceRecord>(['device'], change => show(owner, change), {timeoutMs: 5000, owner});
  if (synced.status === 'synced') copies.set(owner, synced.copy);
}
```

The owner travels beside the request, as a routing key travels beside a
command: the `sync-request` message itself is unchanged. A malformed `owner`
rejects the call with `SdkError` and `invalid-request` before anything is sent.

A sync request is refused with the shared error body, naming its `requestId`
and trace ID, and no `sync.completed` follows:

| Code | When |
| --- | --- |
| the provider's | The provider returned an error body from `errorBody`. |
| `internal` | The provider threw, or its snapshot does not fit the request. The error also goes to `onError`. |
| `unavailable` | No owner serves a family, or the named owner does not serve it or did not answer; the owner closed before serving it, no answer came by the deadline, the transport rejected or threw on it (also reported to `onError`), or the first sync ran out of time. |
| `cancelled` | The copy closed, or its participant closed, before the answer came. |
| `capacity` | The owner's queue is full. |
| `invalid-request` | Several owners serve a family and the sync names none, or the families do not all come from one `serveSync` of one owner. |

A request still waiting in the owner's queue at its deadline leaves the queue,
so the owner never serves it and its room is free for another. It is still
`unavailable`, never `expired`: a sync changes nothing, so asking again is safe.
An owner ignores a sync request past its expiry. A malformed call, such as an
empty or repeated family list, rejects with `SdkError` and `invalid-request`.

## Closing a participant

`participant.close()` closes everything the participant opened, so a stopped
module leaves nothing behind:
1. Later calls on the participant are refused with `invalid-state`.
2. Its requests still waiting for a result settle. A command still queued at its
   responder is taken out and the request is `rejected` with `cancelled`. One
   that the responder's handler has becomes `uncertain`. Their deadlines are
   cleared, so no timer keeps the process alive.
3. Its subscriptions, responders, sync copies and sync owners close as their
   own `close()` does. A copy withdraws its outstanding sync request, which
   leaves the owner's queue if it still waits there, and a first sync still
   under way resolves as `rejected` with `cancelled`. A copy closed while it
   is still subscribing to its families makes no further subscription, and the
   participant refuses any. An owner refuses its waiting requests as
   `unavailable`.

It resolves when the participant's running handlers have finished. Because its
own requests settle first, a handler that awaits another participant's reply can
finish, and the close never waits for another participant's handler. Calling it
again returns the same promise. The runtime closes a module's participant when
it stops the module.

## Modules

A module imports only this SDK and the contracts packages, so the module API
lives here; [`apps/runtime`](../../apps/runtime/README.md) implements it. A
module is an object with a `manifest`, `start(context)` and `stop()`:

```ts
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule} from '@jimmie-potts/sdk';

type SignConfig = {address: string};

export const sign: BunnyModule<SignConfig> = {
  manifest: {
    name: 'sign', apiVersion: '1.1',
    configure: section => {
      const {address} = section as {address?: unknown};
      if (typeof address !== 'string') return errorBody('invalid-request', {detail: 'the sign needs an address'});
      return {config: {address}, devices: ['sign-1']};
    },
  },
  async start({sdk, log, database, config, secrets, files, scheduler}) {
    // `configure` is optional in the type, so `config` may be undefined; the runtime starts this module only with it.
    if (config === undefined) throw new Error('the sign started without its configuration');
    database().exec('CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY)');
    const token = await secrets.read('token');
    const layouts = files();
    await sdk.respond('bunny.cmd.scene.sign-1', command => {
      log.info('command.executing', {'bunny.operation': 'mode'}, command);
      return {status: 'accepted'};
    });
    // Reach the device later, never in start (policy A).
    scheduler.after(0, () => reach(config.address, token, layouts));
  },
  stop() {},
};
```

- **Manifest.** `name` is lowercase letters and digits with single hyphens, at
  most 64 characters. It names the module's source (`bunny/modules/<name>`), its
  SQLite file, its private folder, its section of the runtime's configuration
  file and its log records. `apiVersion` is the module API version the module
  was written for, `<major>.<minor>`. `MODULE_API_VERSION` is the current one,
  `1.2`. The runtime refuses a module with another major version or a newer
  minor one. Write the version as a literal, so a later major version refuses
  the module until it is updated. `checkManifest(manifest)`,
  `checkModuleName(name)` and `checkApiVersion(declared)` return the runtime's
  own reason for refusing, as `{code, detail}`, or undefined.
- **Configuration (1.1, Hub #919).** The manifest may declare
  `configure(section)`. The runtime calls it before `start` with the module's
  own section of its [configuration file](../../apps/runtime/README.md#configuration),
  a JSON object, and never with another module's. It returns
  `{config, devices?}` or a refusal from `errorBody`. It must be synchronous,
  read no file and reach no device. A refusal's detail is fixed text that
  repeats no value from the section, since health shows it. `config` becomes the
  context's `config`, typed `Config | undefined` because `configure` is optional:
  a module that declares one checks for undefined once, in `start`.
  `devices` lists the routing IDs of the devices the module controls, and the
  runtime refuses a module that names a device another module already named. A
  module that declares `configure` needs a section; one without it takes no
  configuration, and its `config` is undefined. The section's `secrets` member
  maps at most `MAX_SECRETS` (16) names, each lowercase letters and digits with
  single hyphens, to the absolute paths of the module's secret files.
  `configure` sees those names and paths, never the files' contents. A refused
  module never starts, and health shows it `refused` with the refusal's code
  and detail. `checkConfiguration(manifest, section)` is the check the runtime
  and the module test kit share: it returns `{status: 'accepted', config,
  devices, secrets}` or `{status: 'refused', problem}`.
- **Pages, content, tools and settings (1.2, Hub #835).** A module written for
  1.2 or later may contribute to the runtime's gateway; one written for 1.0 or
  1.1 that declares any of them is refused with `invalid-request`, and still
  runs without them.
  - `pages`: at most `MAX_PAGES` (16), each `{id, title, render}`. The gateway
    serves `render()`'s HTML at `/modules/<name>/<id>`, in a document whose
    policy allows no script, frame, form or base, to a browser session or a
    credential with `read`. An ID is lowercase letters and digits with single
    hyphens, at most 64 characters, distinct, and never `content`
    (`CONTENT_PATH`).
  - `content(ref)`: content by reference, `{type, bytes}` or undefined, served
    at `/modules/<name>/content/<ref>`, such as the preview a page shows with
    `<img src="content/preview.png">`. The gateway serves images, plain text and
    JSON of at most 16 MiB.
  - `tools`: at most `MAX_TOOLS` (16) read tools, each `{name, description,
    input, output, read}`, which MCP publishes as `<module>_<name>` to a
    credential with `read`. `input` is an object schema that allows no other
    member, and `output` an object schema; the runtime refuses a module whose
    schemas do not compile as strict JSON Schema 2020-12 or whose arguments take
    a name the gateway keeps (`deviceId`, `controllerId`, `url`, `ip`, `path`,
    `credential`, `authorization`). `read(args)` returns the result or a refusal
    from `errorBody`, and changes nothing. A device's command goes through the
    core's dispatcher, as MCP's `core_send_command` (#782), so it is tracked.
  - `settings`: `{schema, show}`. A module has one configuration path: its
    settings are what `configure` accepted from its section, so a module that
    declares settings declares `configure`. The gateway shows
    `show(config)` at `/api/v2/modules/<name>/settings`; a change is made in the
    configuration file and takes effect when the runtime restarts. `show` never
    returns a secret.

  Each runs only while the module runs, in the module's own flow: an exception
  that escapes one fails the module, as one from a handler does. A page,
  settings or tool answer that holds a secret the module read is never served.
  `checkContributions(manifest)`, within `checkManifest`, returns the runtime's
  own reason for refusing them.
- **`start(context)`** subscribes, responds and opens local resources: its
  database, its private folder and its secrets. A throw, a rejection or a start
  that outlasts the runtime's start deadline fails the module.
- **Device failures (policy A).** A device's errors and timeouts are not
  module failures ([ADR 0012](../../docs/decisions/0012-bunny-event-platform.md),
  "Failure isolation"). A module never waits on its device in `start`: it
  reaches the device later and turns its errors and timeouts into outcomes and
  an `unavailable` device state. Only an error that escapes the module stops
  it: a throw or rejection from its start, a handler, a responder, a timer or a
  worker, or a start that outlasts its deadline. The module then stays stopped
  until the runtime restarts. The [module test kit](#module-test-kit) checks
  this: a module whose start waits on a device that never answers fails it.
- **`stop()`** releases what the module holds. The runtime calls it once for
  every module whose start it called, even when start failed or has not
  finished. It runs after the module's participant has closed, which waits for
  the module's running handlers up to the stop deadline; a handler that outlasts
  that deadline may still be running.
- **Factory.** A module that reaches a device is created by a factory that
  takes the device's transport, `create<Name>Module({transport})`. Tests and
  disposable runs pass a simulated transport, so no hardware is touched; there
  is no manifest slot or registry for transports. The device's settings and
  credentials reach the module through its context, after `configure` accepted
  its section, so a factory takes neither; a real transport uses
  `context.config` and `context.secrets` when the module reaches its device.
  The runtime's fixture lamp, `createLampModule({transport})`, shows the
  convention (#846), and the fixture sign, `createSignModule({transport})`,
  shows a configured module (#919).

The context:

| Member | What it gives |
| --- | --- |
| `sdk` | The module's own participant on the runtime's bus. |
| `log` | `debug`, `info`, `warn` and `error(event, fields?, trace?)`. The runtime writes each as a diagnostic-contract record with scope `bunny.module` and the module's name in `bunny.module`, and `trace` adds its trace and span IDs. `event` must be one the catalog registers for modules, and `fields` registered attributes; the runtime drops a record with another event or an invalid value and leaves out unregistered fields. Never put a secret, message or personal content in a field. |
| `trace.span(parent?)` | A new span context: in the parent's trace when one is given, otherwise a new trace. Use it as the `parent` of messages the work sends and the `trace` of its log records. It is not recorded. |
| `trace.start(name, {parent?, links?, kind?, attributes?})` | A recorded span with a start, an end and a status, under `bunny.module` with the module's name, such as `bunny.device.call` around a call to the module's device. Pass its `context` on as a parent, and `end()` it, or `end('error')` when the work failed. Its context never goes to the device. See [Diagnostics and spans](#diagnostics-and-spans). |
| `clock.now()` | The runtime's clock, which the bus also uses for `time` and `expiresat`. |
| `scheduler.after(delayMs, callback)` | A timer on the runtime's scheduler, which also runs the module's request deadlines. `delayMs` is an integer from 0 to 2147483647. It returns a cancel function. A callback that throws or rejects fails the module. |
| `workers.start(file, options?)` | A worker thread. The runtime terminates it when the module stops, and an error it does not catch fails the module. A worker given its own `env` keeps the process's `NODE_OPTIONS`, before the module's own, so a verification run's network guard still loads in it. |
| `workers.call(file, request, {timeoutMs, signal?, transferList?})` | One bounded request in a new worker thread, such as rendering a frame. See [Worker calls](#worker-calls). |
| `database()` | The module's own SQLite database (`node:sqlite`), opened on first use and closed when the module stops. The runtime and the kit open it with `openModuleDatabaseFile` (Hub #972): exclusive locking, WAL at `synchronous = FULL` and foreign keys on. Each commit is durable when it returns, and the module keeps the file to itself while it runs, so another connection to it is refused with `SQLITE_BUSY`. |
| `config` | What the manifest's `configure` returned from the module's own section, or undefined for a module without `configure`. |
| `secrets.read(name)` | The text of the secret file the module's section names `name`. See [Secrets](#secrets). |
| `files()` | The absolute path of the module's own private folder, `modules/<name>/` in the runtime's state directory beside its SQLite file, for media, layouts and scenes. It is created with mode 700 on first use and kept across restarts. |
| `signal` | Aborted when the module stops, so device calls given it end. |

Once the module's stop begins, its `sdk`, `scheduler`, `workers`,
`database()`, `files()` and `secrets` refuse use with an `SdkError` carrying
`invalid-state`. Its `config`, `log`, `trace`, `clock` and `signal` keep
working, so `stop()` can still log.

### Secrets

`secrets.read(name)` reads the file that the module's section names `name` in
its `secrets` member, anew on each call, and resolves with its UTF-8 text
without trailing line breaks. A secret file holds one token, which the module
uses whole. A module never reads a file its section does not name, so it never
reads another module's secret. The file must be private, as the configuration
file is: a regular file with one link and no permissions for group or others,
owned and readable by the runtime's user, at most 64 KiB, reached through no
link and outside every Git checkout and Windows mount. The runtime checks each
named file before it starts the module, and refuses the module when one fails.
`read` rejects with an `SdkError`:

| Code | When |
| --- | --- |
| `not-found` | The section names no such secret, or the file is missing. |
| `forbidden` | The file is not private: a link in its path, a permission for group or others, a second link, another owner, no read permission for the runtime's user, not a regular file, inside a Git checkout or on a Windows mount. |
| `invalid-request` | The file is larger than 64 KiB or is not UTF-8 text. |
| `invalid-state` | The module's stop has begun. |

No detail quotes the file. A secret never goes into a message, a log field, an
error body or health. The runtime drops, and counts, any log record whose
attribute holds a secret a module read, as text or as a number's digits; its
`runtime.failed` record and a module's spans leave such an attribute out. The
module test kit fails a module whose message, command, sync request, log record,
span, reply or synced state holds one of its secrets. A very short secret makes the runtime drop every
record that contains it.

These are boundaries of the module API, not a sandbox. A module's code runs in
the runtime's process, as the runtime's user, so the context never hands it
another module's section or secret, but nothing stops its own code from opening
a file directly. The operator chooses where the configuration and secret files
live; the runtime checks the files and the links along their paths, not the
modes of their directories, and it confirms the opened file through
`/proc/self/fd`.

### Worker calls

`workers.call(file, request, {timeoutMs, signal?, transferList?})` runs one
request in a new worker thread from a module file. The worker gets `request` as
its `workerData` and answers with one `parentPort.postMessage(reply)`; the call
resolves with that reply, and the worker is terminated. Tidbyt and Pixoo render
their frames this way, off the event loop. The deadline, an integer from 1 to
`MAX_TIMEOUT_MS`, runs on the runtime's scheduler. A module has at most
`MAX_WORKER_CALLS` (4) calls running. A failed call rejects with an `SdkError`
and terminates its worker. A call refused before its worker starts had no
effect. Once the worker has the request, every ending but its reply is
`uncertain-result`, because the worker may have done part of its work: in
ADR 0012, a rejection proves no effect, and cancellation is not undo.

| Code | When |
| --- | --- |
| `invalid-state` | Before the worker starts: the module's stop has begun. |
| `invalid-request` | Before the worker starts: the deadline is not an integer from 1 to `MAX_TIMEOUT_MS`. |
| `cancelled` | Before the worker starts: `signal` had already aborted. |
| `capacity` | Before the worker starts: the module already has `MAX_WORKER_CALLS` calls running. |
| `internal` | Before the worker starts: it could not start, as for a file that is not a `file:` URL. |
| `uncertain-result` | After the worker started: the deadline passed, the module stopped, `signal` aborted, the worker threw, its reply could not be read, or it ended without a reply. What it threw stays in memory as the error's cause. |

A failed call never fails the module; the module turns it into an outcome.
`WorkerCalls` is the implementation the runtime and the kit's harness share.

## Outbox

ADR 0012 has each module report outcomes through its own outbox, so a crash
never loses one and no command is ever sent again. `Outbox` keeps a module's
messages in its own SQLite file, in the table `bunny_outbox`:

```ts
import {Outbox} from '@jimmie-potts/sdk';

async start({sdk, database, clock, log, trace}) {
  const outbox = new Outbox({sdk, database: database(), clock, log, trace});
  // Follows the core's acknowledgments first (Hub #782), then sends what is still stored.
  await outbox.republish();
  await sdk.respond('bunny.cmd.lamp-switch.*', async command => {
    await outbox.transaction(add => {
      lamps.switch(command.subject, command.data.power);
      add(`bunny.event.lamp.${command.subject}`, outcomeOf(command), {parent: command});
    });
    return {status: 'accepted'};
  });
}
```

- `transaction(work)` runs `work` in one SQLite transaction. Each message that
  `add(key, draft, {parent?})` stores commits with the work's own changes, and
  goes out only after the commit, in order, through `publishMessage`, with the
  `id`, `time` and trace context it was stored with. A throw rolls back the work
  and its messages, nothing goes out, and the promise rejects with that error.
  `work` must be synchronous: its type refuses a promise, and one returned anyway
  rolls the work back with a `TypeError`. The outbox opens the transaction
  itself.
- A commit stands even when its publish fails. Once the work commits, the
  promise resolves with `work`'s result after the publish ends, and never
  rejects, so no caller takes a failed publish for a rollback and does the work
  again. If publishing is refused, for example because the module is stopping,
  the messages stay stored, unpublished, and the next transaction or start
  sends them unchanged. Nothing sends them again on its own.
- A refused publish is reported once per run of refusals, and again only after
  a send goes through or the code changes, in one place. With the module's
  `log`, it is one `outbox.deferred` record (see below). Otherwise it goes to
  the `onError` option, with the bus's signature: an `SdkError` with the
  refusal's registry code (`internal` for an error without one) and the fixed
  detail `committed, awaiting publication`, with the refusal as its `cause`,
  and the scope `{source, pattern: 'outbox'}`. Without an `onError`, it becomes
  a `BunnySdkWarning` process warning that names the code and that fixed
  detail, never the refusal's message. A refusal that `republish()` passes on
  to its caller is not reported.
- The `validator` option checks each message as `add` stores it, so a message
  it refuses throws `SdkError` with the validator's code and rolls the
  transaction back. A remote part passes the validator its edge uses,
  `edgeValidator(schemas)` (profile 2.0, the core and device families and the
  modules' schemas), so a message the edge would refuse never waits in the
  outbox and never holds back the outcomes behind it (#782).
- Only state, removal, occurrence and outcome messages, on their own key class,
  go in. A command never does, so nothing ever sends a command again.
- A state, removal or occurrence message is deleted once it has gone out. One
  that a crash kept from going out goes out at the next start. That is not
  replay: nothing received it before.
- Each commit is a sync to disk on the event loop. Once a send's messages
  settle, the outbox forgets the states, removals and occurrences that went out
  and marks the outcomes in one commit, not one per message (Hub #972). That
  commit follows the sends, even when a refusal stopped them partway. It runs
  at the connection's own `synchronous` level, as every commit does, so a power
  loss never undoes it. A send takes the rows waiting when it starts:
  transactions that commit before a queued send starts share its commit, and
  one that commits while a send is under way waits for the next. Republishing
  outcomes that already went out writes nothing.
- That commit is the one point at which a state, removal or occurrence that
  went out can go out again. A crash after the sends and before it sends the
  batch again at the next start, and a failure of it sends the batch again with
  the next send, each with the same `id`s. The core drops such a copy by
  `(source, id)`, but the in-process bus does not, so another subscriber may
  hear it twice. In process, the sends and the commit run in one turn of the
  event loop; through a remote edge, the window spans the sends' HTTP calls.
- A failed bookkeeping commit is reported as a refused publish is, with
  `internal`: as `outbox.deferred` with every row still waiting, or to
  `onError` with the fixed detail `committed, awaiting publication`. Here the
  messages went out and wait to be marked, and the next send sends them again.
- An outcome is kept until the core acknowledges it, and goes out again at
  every start until then. The core drops the duplicates by `(source, id)`.
  `acknowledge(id)` forgets it; it returns false when the outbox no longer
  holds that outcome.
- The outbox follows the core's acknowledgments itself (#782): when its
  participant can `subscribe`, as a module's own can, `republish()` first
  subscribes to `bunny.event.outcome-recorded.<module>`, and each
  `outcome-recorded` occurrence that names one of the participant's outcomes
  forgets it, but only when its sender, the envelope's `source` that the bus or
  edge sets from the authenticated participant, is the core (`bunny/core`). One
  from any other sender is ignored, recorded as `message.received` at WARN with
  `forbidden`, and the outcome kept, so a lost or forged acknowledgment never
  discards an outcome. A participant without `subscribe`, such as a wrapper
  that passes `publishMessage` alone, never hears one: pass `subscribe` through.
  The acknowledgments one turn of the event loop brings are forgotten together
  at its end, in one commit, so a burst costs one sync to disk rather than one
  each, and each is then recorded. One that arrives as the module stops, before
  its turn ends, forgets nothing: the outcome goes out again at the next start
  and is acknowledged again. `acknowledgmentOf(outcome)` builds the core's
  acknowledgment, for a core and for tests.
- `republish()` follows the acknowledgments, then sends again, in order,
  everything still stored, and resolves with how many messages went out, or
  rejects with a refusal. Call it once in the module's start, so that it hears
  an acknowledgment of a resent outcome.
- With the module's `log` and `trace` (#949), the outbox records an outcome's
  first publication at most once, as `outcome.published`: INFO for a succeeded
  outcome and WARN for a failed or uncertain one, in the outcome's own trace.
  The record follows the commit that marks the outcome published, so after a
  crash between the send and that commit, the run that sends the outcome again
  makes it. A kill right after that commit, before the record, leaves it out.
  An acknowledgment that lands after the outcome went out and before its
  batch's commit makes the record itself, since no later send will. A replay
  records nothing more, so a replayed outcome never makes a second record. A
  run of refused publishes after their commits makes one `outbox.deferred`
  warning, in place of the `onError` report, with the refusal's code and
  `bunny.outbox.waiting_count`, the messages still waiting to go out, so one
  deferral is one record in the runtime. Each outcome sent gets a
  `bunny.outcome.publish` span: the stored context's child when the same
  transaction stored it, and otherwise, after a restart or a deferral, a new
  root linked to that context, never its child. The kit fails a module whose
  outbox records nothing. Each outcome the core's acknowledgment forgets is
  recorded as `outbox.acknowledged` (INFO), in the acknowledgment's trace.

One outbox serves one database connection, and a module keeps one: two
outboxes on one database would send each other's rows.

Known limits:
- A consumer whose full queue drops a state or occurrence never gets it again;
  it should sync. A dropped outcome goes out again at the module's next start.
- An outcome waits for the module's next start to go out again. A core that
  fails and recovers while the module keeps running gets it at that start.
- A refusal that lasts, such as a schema the edge does not accept from an
  outbox without a validator, holds back every later message, which waits
  behind the refused one in commit order. Each send tries the oldest first, and
  the report names the code. Hub #949 owns the diagnostic record for it.
- The [outbox decisions](../../openspec/changes/archive/2026-10-06-gh-882-module-kit/design.md)
  record the reasons and what the core must do.

## Module test kit

`@jimmie-potts/sdk/testing` holds one conformance suite that every module runs,
so all modules behave the same. Its tests import it; the runtime never does.

```ts
import {moduleConformance} from '@jimmie-potts/sdk/testing';

moduleConformance({
  create: () => createLampModule({transport: new SimulatedLamps()}),
  schemas: lampSchemas,
  serves: ['lamp'],
  copies: {families: ['mode', 'session'], snapshot: {revision: 1, states: [modeState('work')]}},
  accepted: switchLamp('lamp-1', 'on'),
  refused: {...switchLamp('lamp-9', 'on'), code: 'not-found'},
});
```

A configured module that reaches a device also gives its section, its secrets'
synthetic text and an instance whose device never answers:

```ts
moduleConformance({
  create: () => createSignModule({transport: new SimulatedSigns({online: true})}),
  schemas: signSchemas,
  serves: ['sign'],
  config: {greeting: 'hello', signs: [{id: 'sign-1', address: '192.0.2.10'}], secrets: {token: '/nowhere/sign-token'}},
  secrets: {token: 'tok_SYNTHETIC919'},
  offline: {create: () => createSignModule({transport: new SimulatedSigns()}), unavailable: reportsUnavailable},
});
```

`moduleConformance(spec)` registers a node:test suite named for the module, and
is the only part of the kit that loads `node:test`. `conformanceChecks(spec)`
returns the same checks as `{name, run}` for another runner, such as Vitest.
Each check hosts a fresh instance of the module on its own bus and state
directory, with a stand-in owner serving the families it copies, and the spec's
`config` as the module's section and `secrets` as its secret files' text. The
stand-in is `bunny/core`, or `copies.owner` for a module that copies a family
that several modules serve, such as one device module's `device` records:
`copies: {families: ['device'], owner: 'bunny/modules/lifx', snapshot}`. The kit
syncs a module's own families from the module by name, as a consumer of a shared
family does. Under ADR 0012's failure isolation (policy A), a device's errors
and timeouts become outcomes and an `unavailable` device state, never a module
failure, and only an error that escapes the module stops it. The kit fails a
module whose handler, timer or worker fails. With `spec.offline`, it also starts
an instance whose simulated device never answers, and fails the module when that
start does not finish within `offline.startWithinMs` (1000 ms by default),
because start opens only local resources and the module reaches its device
later, or when the module never publishes a state that `offline.unavailable`
recognizes as the device's `unavailable` report. Every message the check sees
must follow profile 2.0, with the core families, the core's acknowledgment among
them, and `spec.schemas` registered. Every record the module logs must be one the runtime
writes whole as a [diagnostic-contract](../../docs/observability-contract.md)
record (#903): an event the catalog registers for the `bunny.module` scope, and
only registered attributes with values of their registered types. No message,
command or sync request the module sends, log record, span, reply or synced
state may carry one of `spec.secrets`, and a failure names where one appeared,
never the secret. No handler, timer or worker of the module may fail, and its
stop may not throw or outlast its deadline.

`checkModuleRecord(name, record)` is that record check on its own. It returns
why the runtime would not write one of the module's records whole, naming the
event and attribute keys but never a value, or undefined. A module that needs
another event or attribute asks for a catalog change in
`@jimmie-potts/bunny-observability`; it never logs one the catalog lacks.

`config`, `secrets`, `offline`, `serves`, `copies`, `accepted` and `refused`
are optional, so a module that only consumes runs the checks that apply to it.
A module that reaches a device gives `offline`. The checks:

| Check | Runs | What passes |
| --- | --- | --- |
| `declares a manifest the runtime accepts` | always | `checkManifest` finds nothing to refuse, and `checkConfiguration` accepts `spec.config`. |
| `starts, and stops leaving nothing behind` | always | Start and stop each finish within `timeoutMs` (5 s by default). Afterwards the accepted command, if any, is refused as `unavailable`, a sync of the served families from the module, if any, is refused as `unavailable`, and no timer, worker or open database is left. |
| `starts while its device never answers, and reports it unavailable` | with `offline` | Policy A: `offline.create()`'s start finishes within `offline.startWithinMs`, and the module then publishes a state that `offline.unavailable` accepts within `timeoutMs`. |
| `serves its families through sync` | with `serves` | A sync of `serves` that names the module as its owner completes, and every state belongs to a served family and comes from the module. |
| `copies the families it follows` | with `copies` | The module's start syncs them, asking for nothing else. With `copies.owner`, each sync of them names that owner, because in the runtime another owner may serve them too, and a sync that names none would then be refused. |
| `accepts a command and replies` | with `accepted` | The accepted command comes back `accepted`. The bus records one `command.admitted` and one `command.replied` in the command's trace, and its request span has one queue and one execute span as children, all ended without an error; the reply carries the execute span's context. |
| `refuses a command with the shared error body` | with `refused` | The refused command comes back `rejected` in the module's own reply, with `refused.code`, with the same records and spans. |
| `keeps the outcome in its outbox and sends it again after a restart` | with `accepted` | The accepted command's outcome is published, and after a restart on the same database, with no acknowledgment, it is published again, unchanged. Its publication is recorded once, in the command's trace, and the replay's publish span links to the stored context without being its child. |
| `forgets the outcome on the core's acknowledgment, and only the core's` | with `accepted` | An acknowledgment of the outcome from another participant than the core changes nothing: a restart sends the outcome again. Once `bunny/core` acknowledges it, the module records `outbox.acknowledged`, and the next restart sends it no more (#782). |

Every check also fails when a span the bus or the module recorded has a lost
parent: one that is neither a recorded span nor the span of a message the check
saw or the module received. A span that starts a new trace is a root, never
lost.

The lifecycle check sees only what the harness tracks: the module's responders
and sync owners on the bus, the timers and workers it started through its
context, and its database. A timer, socket or handle the module opened another
way is beyond it.

`ModuleHarness` is what the checks host a module with, as the runtime would:
- its own participant on a given bus, which the module gets without `close`,
  and whose commands and syncs it keeps in `sent`, a sync with the owner it
  names, since no subscriber sees them;
- its `section`, checked with `checkConfiguration` before start, which throws
  the refusal's `SdkError` and never starts a module the runtime would refuse;
- a context whose SQLite file and private folder, `<name>/`, live in a given
  directory, whose `secrets.read` serves the `secrets` option's text from
  memory for the names the section gives, and whose worker calls are the
  runtime's. The file is opened as the runtime opens it, with
  `openModuleDatabaseFile`, so the module keeps it to itself while it runs:
  a test reads or changes its rows through `moduleDatabase()`, the module's own
  connection, and opens the file itself only once the module stops;
- a `stop` that aborts the signal, cancels timers, closes the participant,
  runs `stop()`, ends workers and closes the database, in the runtime's order;
- with `spans`, the module's `trace.start` spans, its name in `bunny.module`,
  and in `received` the trace context of each message the module received.

`RecordedSpans` is a span recorder for tests that keeps each span as plain data,
and `lostParents(spans, contexts)` returns the spans whose parent is lost.
`countCommits()` stands in front of a connection and records each commit it
makes, as the connection's `synchronous` level, for tests that count the syncs
to disk a change costs (Hub #972).

The participant close and `stop()` each have a deadline, `stopTimeoutMs`, 5 s
by default as in the runtime. A step that throws or outlasts it is recorded in
`failures`, and the stop goes on.

The core's acknowledgment of an outcome is the `outcome-recorded` core family
(#782), which the kit's checks validate with the other core families; a test's
stand-in core publishes `acknowledgmentOf(outcome)` as `bunny/core`.

## Trace context

Every message carries W3C trace context. To continue the trace of the message
being handled, pass it as `parent`:

```ts
await core.subscribe('bunny.state.session.*', message =>
  core.publish('bunny.event.session.s1', turnEnded, {parent: message}));
```

The new message keeps the parent's trace ID and flags, and gets a new span ID.
A reply continues its command's trace the same way. Without a parent, or with a
malformed or all-zero one, the message starts a new trace with the sampled flag
set. Only `traceparent` travels: profile 2.0 has no `tracestate` or baggage, so
a `tracestate` that a parent carries is never passed on. With a span recorder,
a command's new span is its recorded request span and a reply's its execute
span; every other message's span is its own and is not recorded.

## Diagnostics and spans

ADR 0012's "Observability" section has the boundary that makes a decision
record it, once, at a fixed level (#949). The bus, the edge and the remote
client take an optional `onDiagnostic(diagnostic)`, a no-op by default, that
the runtime connects to its log. A `Diagnostic` is a closed record: `event`,
`level` and the values the SDK has already checked, namely the participant's
`source`, the routing `key` or `pattern` (`sync <families>`), `requestId`,
`messageId`, `outcome`, a registry `code`, the edge's `route`, an exception's
`errorType` and an `attempts` count, with the work's `trace`. It never holds a
payload, an error object, an exception's message or a credential. A callback
that throws loses its record and changes nothing.

A decision that ends with a registry code takes that code's level from one
table, the same for the bus, its owners, sync and the edge: INFO for
validation and domain refusals (`invalid-request`, `invalid-message`,
`unsupported-version`, `unknown-schema`, `unsupported-capability`,
`not-found`, `invalid-state`, `revision-conflict`) and `cancelled`; WARN for
refusals a correct caller should never receive (`unauthenticated`,
`forbidden`, `too-large`, `duplicate-conflict`), lost capacity (`capacity`,
`unavailable`), `expired` and `uncertain-result`; ERROR for `internal`.

| Event | Level | Made by |
| --- | --- | --- |
| `command.admitted` | INFO | The bus, when it puts a command in its owner's queue. |
| `command.refused` | The code's level, WARN for each code the bus refuses with | The bus, when a command never reached a handler: no responder, a full queue, its expiry, a closed responder, or a frame the edge could not deliver. |
| `command.cancelled` | INFO | The bus, when the requester closed or stopped waiting before a handler started the command. |
| `command.replied` | INFO; the code's level for a typed refusal | The bus, at the owner's reply: `accepted`, or its typed refusal with its code. |
| `command.uncertain` | WARN | The bus, when a handler had the command and the request ended `uncertain-result`. |
| `sync.served`, `sync.refused` | INFO; the code's level for a refusal | The bus, at a sync request's answer, refused by the bus or its owner. |
| `sync.restarted` | DEBUG | The copy's transport, when an overflow restarted its sync. |
| `edge.connected`, `edge.disconnected` | INFO; WARN with `capacity` for a stream the edge ended because its reader stopped | The edge, for a remote part's stream. |
| `edge.refused` | The code's level | The edge, for a call it refused, a call outside its grant (`forbidden`) and a command sent again (`duplicate-conflict`) included. Before authentication it carries only the route and the code. A call its caller drops while the edge reads it is `cancelled`. A repeat with the same route, code and source is counted, and each minute that counted any ends with one summary whose `attempts` is that count; a quiet minute ends the run (`REFUSAL_WINDOW_MS`). The window runs on the edge's scheduler, so with the default `setTimeout` a host that never calls `edge.close()` stays alive up to a minute after a refusal; the runtime closes its edge. |
| `edge.failed` | ERROR, an internal fault | The edge, for an exception it did not expect, with the code it answered (`internal`, or `uncertain-result` once it had handed a command to its bus) and the exception's type, never its message. After dispatch it also carries the command's key, request ID, message ID and trace. |
| `remote.disconnected`, `remote.reconnected` | WARN, INFO | The remote client, once for a lost stream and once for its recovery, with the count of failed attempts. |
| `remote.command.uncertain` | WARN | The remote client, when it settles a request `uncertain-result` itself: the edge answered `internal` or `uncertain-result`, could not be heard by the deadline and its grace, or the requester closed first. A refusal it passes on is the edge's record. |

Each request makes one admission record when it reaches the queue and one
ending record, made inside its single settlement, so a late reply or a second
deadline adds nothing. A call the SDK refuses with `SdkError` is the caller's
error, and the bus records nothing for it. A catch that only passes an error to
`onError` records nothing.

`SpanRecorder.start(name, {parent?, links?, kind?, attributes?})` returns a
span with its own `context` and `end(status?)`. Names are the diagnostic
contract's registered ones, and attributes are registered attributes fixed at
the start. `noSpans`, the default, records nothing and gives `childOf(parent)`.
`startSpan(recorder, name, options)` never throws into the work: a recorder
that fails gives way to `noSpans`. With a recorder, the bus records each
command's `bunny.command.request` span, a client span when a participant sends
it and a server span when the edge hands the bus a remote command, whose context
it authenticated and validated. Its `bunny.command.queue` span (admission to
dequeue or removal) and `bunny.command.execute` span (the handler's run) are the
request span's children, so concurrent requests never share a parent. A span
ends with `error` for an uncertain result, a bus refusal other than a
cancellation, and a handler that throws; a typed refusal is no failure.

`DeviceAvailability({log, clock})` keeps a polled device from logging a warning
per poll. `unreachable(device, code, trace?)` logs the first failure as one
`device.unavailable` warning, and counts later failures, logged as one
`device.unavailable` summary at DEBUG at most once a minute. `reached(device,
trace?)` after failures logs one `device.available` record with
`bunny.attempt_count` and `bunny.duration_ms`; while the device is available it
logs nothing. A device ID that the contract's `bunny.device.id` pattern refuses,
such as an address with a path, is left out of its records, which are kept.

## Remote transport

Remote parts, such as the CHOMPI bridge, the Wispr collector, agent hooks, the
dashboard and MCP clients, make the same calls over SSE and HTTP (#883). The
runtime mounts a `RemoteEdge` on its bus, and a remote part connects with
`connectRemote`:

```ts
import {createServer} from 'node:http';
import {InProcessBus, RemoteEdge, connectRemote} from '@jimmie-potts/sdk';

const bus = new InProcessBus();
const edge = new RemoteEdge({bus, validator, grants: [{source: 'bunny/bridge', token}], onDiagnostic: diagnostic => record(diagnostic)});
createServer(edge.handle).listen(port, '127.0.0.1');

const bridge = await connectRemote({url: `http://127.0.0.1:${port}`, source: 'bunny/bridge', token});
await bridge.subscribe('bunny.state.session.*', message => show(message.data));
```

The edge serves `GET /api/sdk/v1/stream`, one `text/event-stream` per
connection, and one `POST /api/sdk/v1/<call>` per call. Every frame carries
`schema: "sdk-remote/1.0"`, and every refusal is the shared error body, with the
HTTP status that fits its code.

- **Credentials.** Each source has a bearer token. The edge compares tokens in
  constant time, and refuses at start a grant with a malformed source or a token
  that two grants share. A call without a granted token is refused with
  `unauthenticated`, and a message or connection of another source with
  `forbidden`. Tokens appear only in the `authorization` header, never in a
  message, diagnostic, log record or error body. A host may authenticate calls
  itself instead, with `authenticate(request)`, which returns the principal a
  call acts as, `{source, id?, calls?, keys?, publishes?}`, or undefined for
  `unauthenticated`; the runtime's gateway does, for its credentials and
  browser sessions (Hub #835). `disconnectPrincipal(id)` ends the streams a
  principal opened, as when the host revokes it.
- **Permissions (Hub #835).** A grant may list the `calls` it may make and the
  routing-key patterns, `keys`, it may use; either left out allows all. A key it
  publishes or requests must match a pattern; a pattern it subscribes or
  responds to, and the state keys `bunny.state.<family>.*` of each family it
  syncs or serves, must lie within one. `reply` comes with `respond`, `answer`
  with `serve`, and every part may hold its stream and close what it opened on
  it. Anything else is refused with `forbidden` before it reaches the bus, and
  the edge refuses at start a grant whose calls or patterns it cannot read.
  `publishes` names the payload families, by the family of a message's
  `dataschema`, it may publish, so a hook's grant can carry lifecycle
  observations only.
- **Declared source.** The client names the source it acts as in every call's
  `bunny-source` header (`SOURCE_HEADER`), and the edge refuses a token used
  under another source with `forbidden` at once, before the stream opens.
- **Commands are never sent twice.** The edge remembers each command it hands
  its bus, by source and message ID, and refuses the same message again with
  `duplicate-conflict` before anything happens, even after the first one
  settled. A raw HTTP client that repeats a command therefore cannot make a
  responder run it twice. It remembers a command while its bus has it, and once
  settled until its `expiresat`, at most `REMEMBER_MS` (10 minutes). A command
  refused before it reached the bus, or one the bus refused before any responder
  had it, is forgotten, since sending it again is safe. A command counts against
  its principal's quota: the credential or session the host's `authenticate`
  names by `id`, or else its source. One principal may have
  `MAX_REMEMBERED_PER_PRINCIPAL` (1,024) remembered at once, one source's
  principals together `MAX_REMEMBERED_PER_SOURCE` (4,096), and all of them
  `MAX_REMEMBERED_COMMANDS` (135,168, which 33 sources at their bound fit);
  past any, that principal's next command is refused with the retryable
  `capacity`, while another principal's still goes through, of the same source
  until that source's bound and of another source always. A repeat is a duplicate whichever principal of the
  source sends it. A new edge, as after a restart, remembers none.
- **Liveness.** The edge writes a heartbeat comment line on each stream every
  `heartbeatMs` (`HEARTBEAT_MS`, 15 s). A stream whose socket stays full for
  `stallMs` (`STALL_MS`, 30 s), its reader having stopped, is ended: its
  subscriptions close and free their queued messages, and the edge reports
  `edge.disconnected` as a warning with `capacity`. The client takes a stream
  that delivers nothing, heartbeats included, for `idleMs` (`IDLE_MS`, 45 s) as
  lost, reconnects and tells its subscriptions of the gap, so its copies sync
  again. These timers run on `liveness`, which defaults to real timers that keep
  no process alive, whatever `scheduler` is.
- **Validation.** The client builds every message, so it keeps its own `id` and
  `time`. The edge checks each one against profile 2.0, its registered payload
  schema and the 256 KiB cap before it reaches the bus. A refused message gets
  `invalid-message`, `too-large`, `unknown-schema` or `unsupported-version`. A
  command or sync request already past its expiry gets `expired`, and a sync
  request whose subject is not its families joined by commas gets
  `invalid-message`. A call body over its limit is refused with `too-large`
  without reading the rest.
- **Remote refusals.** A remote responder's or owner's refusal is rebuilt at the
  edge as the shared error body: its registered code, and at most 1024
  characters of detail. Anything else it carried is dropped.
- **A remote responder that fails.** When a remote handler throws, or answers
  with something other than a valid reply, the client reports the error to its
  `onError` and answers the `reply` call with `{"status": "uncertain"}`. The edge
  settles the request `uncertain` with `uncertain-result`, as the bus does in
  process, and sends no reply message.
- **Safe errors.** An exception that the edge did not expect is answered with
  `internal` and the fixed detail `the edge failed`. Once the edge has handed a
  command to its bus, it answers one with `uncertain-result` and the fixed
  detail `the edge failed after it sent the command` instead, because a handler
  may have run it. Either is reported once as an `edge.failed` diagnostic with
  the code it answered and the exception's type, and after dispatch with the
  command's key, request ID, message ID and trace. The exception's message, stack
  and cause stay in memory. The edge's and the SDK's own refusals keep their
  text, which may quote what the caller sent, such as a path, a claimed source,
  an id or an attribute the validator refused; their `edge.refused` diagnostic
  carries only the code.
- **Edge answers at the client.** The client takes an edge refusal only with a
  registered code and that code's flag, and reports any other body as
  `internal`. A command whose request call the edge answers with `internal` or
  `uncertain-result` is `uncertain`, because the edge may have failed after the
  command reached a handler, and the client reports that decision as
  `remote.command.uncertain`. Any other refusal of the call stays `rejected`,
  and the edge records it.
- **Subscriptions.** `subscribe` resolves once the edge has registered the
  subscription, so nothing published after it is missed. Messages come down the
  stream in order.
- **A slow consumer.** The edge waits for the socket to drain before it writes
  the next message of a subscription. A remote part that stops reading fills
  only its own subscriptions' bounded bus queues. Their drops go to `onError` as
  `capacity`, and the remote part receives `onOverflow` with the count.
- **Reconnects.** When the stream is lost, the client reconnects. It queues
  `onOverflow({})`, with no count, for every subscription before any message of
  the new stream. It registers its subscriptions, responders and sync owners
  again, and only then delivers those notices, so a sync copy that syncs again
  never asks before its subscriptions exist. Nothing missed in the gap is
  replayed. A call that needs the stream and meets a lost one is refused with
  the retryable `unavailable`. The client reports the lost stream once, as
  `remote.disconnected`, and its recovery as `remote.reconnected` with the count
  of failed attempts; it does not report each failed attempt to `onError`.
- **A dropped stream and forwarded calls.** A command already written to a
  remote responder's stream is never answered as a refusal: its handler may be
  running it. Its reply still counts when it comes on the reconnected stream,
  matched by the command's own message id, so a retry that reuses a `requestId`
  keeps its own reply. Otherwise its deadline, or the edge closing, makes it
  `uncertain` with `uncertain-result`, and no reply message. A command whose
  frame never reached the socket is refused as `unavailable`, and so is a
  forwarded sync request, since a sync only reads.
- **Sync owners.** A remote part's `sync` call carries the `owner` it names
  beside the request message, and the edge passes it to its bus, which routes
  the request as it does in process. An `owner` that is not a participant
  source is refused with `invalid-request`.
- **Sync answers.** A sync answer whose `sync.completed` or a state is over
  256 KiB is refused at the edge with `too-large` and reported. A first sync
  resolves `rejected` with that code, and a later one ends the copy with
  `failed`. Paging waits for any family's snapshot nearing the cap (#923's
  deferral).

The deadline answers are the same on both transports, as ADR 0012 states:

| Case | Answer |
| --- | --- |
| A command its handler holds at the deadline | `uncertain-result` |
| A command still queued at the deadline | `expired`: it never reached the handler |
| A sync request with no answer by the deadline | `unavailable`, since a sync only reads |
| A command or sync request that reaches the edge past its expiry | `expired`; through the client, a remote part's own sync request gets the retryable `unavailable` instead |

Remotely, the edge answers as soon as its bus settles, at the deadline. The
requester waits `REQUESTER_GRACE_MS` (1 s) longer on its own scheduler. If the
edge cannot be heard by then, the requester settles a command as
`uncertain-result`, because its fate is unknown, and a sync as `unavailable`. An
edge `expired` refusal of a remote part's own sync request, as when its clock is
behind the edge's, reaches it as the retryable `unavailable`. Every `timeoutMs`
is at most `MAX_TIMEOUT_MS`, one day, on both transports, so no timer outgrows
`setTimeout`. Both sides run their waits on a `scheduler` option, which defaults
to `setTimeout`.

A remote participant is a `Participant`, and closing it again returns the same
promise. Its `close` first settles each request still waiting for the edge as
`uncertain-result`, because the requester cannot know whether a handler already
has it. It drops their calls, so the edge takes a still-queued command out, and
cancels their deadlines and the reconnect backoff. It then closes its sync
copies: a first sync still under way resolves `cancelled`, and its request is
withdrawn from the owner's queue. Last it ends the stream, and every later call
is refused with `invalid-state`.

## Checks

From the repository root, with Node 24, run `npm run test:sdk`. It builds and
runs the compiled tests in `dist/tests/`. `conformance.test.ts` runs one suite
against both transports, `owners.test.ts` runs several owners of one family on
both, and `remote.test.ts` covers what only the remote transport has. Remote
tests bind 127.0.0.1 on a free port. See [SDK
checks](../../docs/development.md#sdk-checks).

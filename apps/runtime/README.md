# B.U.N.N.Y. runtime

Private workspace package `@jimmie-potts/runtime`. It is the one runtime process
that [ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) describes. It
hosts a fixed list of modules on the SDK's in-process bus and serves health,
and with `--edge` the SDK edge for remote parts, on a loopback port. The
shipped list in `src/modules.ts` holds the [agent-session core](#agent-session-core)
and, after it, the device modules: the
[playback module](../../modules/playback/README.md) (#929), the
[LIFX module](../../modules/lifx/README.md) (#928) and the
[Tidbyt module](../../modules/tidbyt/README.md) (#930) so far. Module stories
add theirs after the core, and the runtime also runs with no module at all.
Without a [configuration file](#configuration), the runtime refuses each module
that takes one, with `not-found`, shows it in health and runs on, so the shipped
runtime then runs the core alone, with the device modules `refused`. Nothing
installs it yet; the cutover (#840) does.

Modules are written against the [module API](../../packages/sdk/README.md#modules)
in `@jimmie-potts/sdk`. There is no dynamic loading, middleware or durable
subscription: adding or removing a module is a code change in `src/modules.ts`.
Each entry there is the module's factory, which creates it with its real device
transport, or with its simulated one under `--simulate`. Each module's settings
and secrets come from one private [configuration file](#configuration).

A factory whose module takes a configuration also gives a `simulatedSection`:
`{config, secrets?}`, the module's section for simulated runs without its
`secrets` member, and the names of the secrets that section needs. A module that
reads no secret, such as the playback and LIFX modules, omits `secrets`; the Tidbyt module names `token`, its API
key's file. One helper,
`tests/fixtures/simulated.ts`, builds each section as `{...config, secrets: {<name>:
<file>}}`, with one private file holding the synthetic token for each declared
name, and writes the configuration file. The `shipped` disposable run, the
runtime's process tests and the maintenance journal test configure the shipped
modules with it.

## Agent-session core

`src/core` is the one owner of agent sessions
([Hub #831](https://github.com/jimmie-potts/agent-device-hub/issues/831)). It is
the module named `core`, and the runtime hosts it with the source `bunny/core`;
every other module is `bunny/modules/<name>`. It comes first in the shipped list.
It reaches no device, so its real and simulated builds are the same.

Its start registers its sync owner, its lifecycle subscription and its
responder before its first await. A device module that syncs from it or
republishes to it in its own start therefore finds it listening. If the core
fails, the runtime ends: the process writes `runtime.failed` with `core-failed`
and exits 1, and the service manager restarts it whole.

- **Owner and store.** It runs `@jimmie-potts/agent-state`'s owner on the core
  store in its own SQLite file, `modules/core.sqlite`. The store adapter
  (`src/core/store.ts`) is copied from the old Hub's `apps/hub/src/storage.ts`
  and keeps its format: the durable 2.1 state as one JSON row in `state`. Its
  lease is an exclusive transaction on the lock database `core.sqlite-owner`
  beside it, which has no rollback journal, so taking it writes nothing. The
  core holds it from its start until it stops, including while it opens
  agent-state's owner again after a failed commit. A second runtime on the same
  state directory waits for it until agent-state's three-second deadline, and
  its core then fails. A file that holds another owner's state is refused
  before anything is written to it.
- **Intake.** It subscribes to `bunny.event.lifecycle.*`, checks each message
  against profile 2.0, drops a duplicate by `(source, id)` and refuses the same
  `(source, id)` with other content as `duplicate-conflict`, then reduces the
  observation as the lifecycle 1.2 envelope that
  [MAPPING.md](../../packages/event-contracts/MAPPING.md) describes. It keeps
  each observation's `(source, id)` in the same store for 24 hours past the
  later of the commit and the observation's own `observedAtMs`, as long as
  agent-state still admits it, so a duplicate after a restart, or from a hook
  whose clock runs ahead, is still dropped. A duplicate is logged at DEBUG.
- **Publication.** Each change derives its `session` state, removal and
  occurrence messages. One SQLite transaction commits the change with those
  messages (through the SDK's outbox), the published records, a history row for
  each occurrence and removal, and the intake's `(source, id)`. The messages go
  out after the commit, in order: a session's end, then its removals, then
  states, then the other occurrences. A record carries the core's revision of
  its last change; the core keeps one revision counter for every family it
  serves.
- **Failures.** A full disk refuses the change before anything reports it
  accepted: nothing commits, nothing is published, and the intake is logged
  `rejected` with `capacity` (an acknowledgment is refused with `capacity`).
  The core then opens agent-state's faulted owner again on what committed,
  keeping its lease. The core never fails on a full disk:
  - if opening the owner fails, as when maintenance falls due, the core refuses
    durable work with `capacity` or `unavailable` and tries again on demand
    after a backoff that doubles from 1 s to 60 s;
  - at the start, a full disk leaves the core running in that state, and a
    failed refresh of the restart's uncertainty makes syncs answer `unavailable`
    until a later attempt, on the same backoff, succeeds.

  While the store refuses durable work, the core logs one `operation.failed`
  record (`bunny.operation` `storage`, WARN, or ERROR for `internal`), then a
  summary at most once a minute with the refusals since (`bunny.attempt_count`),
  and one `operation.completed` once a change commits again; each attempt is
  DEBUG. A publication refused after a commit is recorded as `outbox.deferred`:
  the change stands, and its messages go out at the next commit or start, with
  their stored `id`, `time` and trace context. A crash between a commit and its
  publication sends them at the next start, once.
- **Freshness.** Each record's `freshness` holds at the `time` of the message
  that carries it. A timer publishes a record again, at a new revision, when it
  turns uncertain five minutes after its last evidence, and a sync brings
  freshness up to date first. After a restart every stored session is
  `restartUncertain` until fresh lifecycle evidence. One limit: a sync provider
  cannot name the time the SDK stamps on its answer, a microtask after the core
  computed the records, so a record that turns uncertain within that
  millisecond can disagree with its envelope by one millisecond. The core's
  timer usually publishes the change first.
- **Sync and acknowledgment.** It serves `session` through sync, and answers
  `notice-acknowledge` through agent-state's `acknowledge` with `accepted`,
  `not-found` for an unknown session or notice, `invalid-request` for an unknown
  consumer, and `forbidden` when the sender's source does not end in that
  consumer ID: a consumer acknowledges for itself only. The acknowledgment
  commits before the reply, and the session's state at its new revision, in the
  command's trace, is its evidence; no outcome follows. The consumers are
  `DEFAULT_CONSUMERS` (`dashboard`, `nanoleaf` and `pixoo`). agent-state keeps that list with the
  store and refuses a store whose list differs, so changing it needs a
  migration.
- **Extension point.** A `CorePart` (Hub #782's tracker and history, #923's
  inbox) creates its own tables in the core store, serves its families through
  the core's sync at the core's revision, derives rows from each committed core
  change in that change's transaction, and runs its own intake through the
  core's transactions and outbox.

## Run

From the repository root, with Node 24, after `npm run build`:

```sh
node apps/runtime/dist/src/main.js --port 0 --state-dir ~/.local/state/agent-device-hub/runtime
```

| Argument | Meaning |
| --- | --- |
| `--port` | Required. The loopback port for health; 0 picks a free one. |
| `--state-dir` | The private state directory. Defaults to `~/.local/state/agent-device-hub/runtime`. |
| `--config` | The private [configuration file](#configuration), with each module's own section. Without it, a module that takes a configuration is refused. |
| `--lag-limit-ms` | How long the event loop may stay stuck before the process is killed. Defaults to 10000. |
| `--log-level` | `debug`, `info`, `warn` or `error`. Defaults to `info`. |
| `--environment` | `development`, `test` or `production`: every log record's `deployment.environment.name`. Defaults to `development`; disposable verification runs use `test`, and the installed runtime `production`. |
| `--simulate` | Build every module with its simulated transport, so the runtime reaches no device. Disposable verification runs use it. |
| `--edge` | Serve the [SDK edge](#sdk-edge) on the health listener, with the grants in the state directory. |
| `--record-spans` | Write each finished span to a [bounded, private span file](#the-span-file) in the state directory. Disposable verification runs use it; the installed runtime does not, and keeps its spans in memory. |

Malformed arguments exit with status 2 and a usage line. Once the modules have
started, the process writes one line to stdout, `{"event":"runtime.ready","url":...}`.
SIGTERM or SIGINT stops every module and exits 0. The entry point imports only
a small launcher that catches both signals before the rest of the runtime
loads. A signal that arrives while it loads exits 0 before anything is created.
One that arrives while the modules start is remembered: once their starts
settle, the runtime stops them all and exits 0, without a ready line. Only a
signal in Node's own startup, before the entry point runs (about the first
20 ms), takes Node's default action.

## Health

`GET /api/runtime/v1/health` answers 200 with a `runtime-health/1.0` document
while the process serves. Its `status` is `ok` when every module runs and the
lag check, if any, is active, and `degraded` otherwise. Each module has a
`state` (`refused`, `starting`, `running`, `stopping`, `stopped` or `failed`),
`healthy`, `syncRestarts` (how often an overflow restarted one of its sync
copies, so a restart loop shows), `serves` (the families it serves through sync
now, when it serves any) and, when refused or failed, a `reason` with a code
from the 2.0 error registry. A module's `name` gives its source on the bus,
`bunny/modules/<name>`, or `bunny/core` for the core. A consumer of a family
that several modules serve, such as `device`, syncs it from each module whose
`serves` lists it, by that source (#967). `lagCheck` is `off`, or `active` or
`stopped` with its `limitMs`. `memory` reports the whole process from
`process.memoryUsage()`.

A request must name the listener as its host (`127.0.0.1:<port>` or
`localhost:<port>`, in any letter case, with the exact port) and carry no
`Origin` and no `Sec-Fetch-Site` other than `none`, as the Hub and local controllers require, so a page on a rebinding name
cannot read module state. Any other request answers 403 with the shared error
body and `forbidden`. Every other route answers 404 with `not-found`, except the
[SDK edge](#sdk-edge)'s routes when the edge is configured.

## SDK edge

With `--edge`, remote parts make the SDK calls over SSE and HTTP under
`/api/sdk/v1/` on the health listener, through #883's `RemoteEdge` on the
modules' bus. The listener's local-request rules apply to these routes too. The
edge serves once every module has started; until then its routes answer 503
with `unavailable`, so a remote part that reconnects never syncs from a module
still starting. `runtime.started` says whether the edge is configured
(`bunny.edge`); `runtime.edge.serving` follows once it serves. From the start
of a stop until the listener closes, the routes answer 503 with `unavailable`
again, not 404.

Each remote part has a grant: a source and a bearer token, in
`edge-grants.json` in the state directory:

```json
{"schema": "edge-grants/1.0", "grants": [{"source": "bunny/parts/reader", "token": "<at least 32 characters>"}]}
```

The file must be private: mode 600, one link, owned by the runtime's user and
never reached through a link. A grant may not act as the core (`bunny/core`) or
a module (`bunny/modules/<name>`), so a remote part can never publish as either.
The runtime refuses to start otherwise, with `edge-grants-missing`,
`edge-grants-not-private`, `edge-grants-invalid` or `edge-grant-source` in
`runtime.failed`. No refusal or log record quotes a token. The edge checks every
remote message against profile 2.0, the core families, the device families that
every device module answers (#918) and the modules' own schemas (each factory's
`schemas`), and logs `runtime.edge.connected`,
`runtime.edge.disconnected`, `runtime.edge.refused` and `runtime.edge.failed`.
A refusal's record holds `bunny.route` (one of the edge's routes, or `other`),
`bunny.participant` when the caller had a grant, `bunny.code` from the error
registry and `bunny.reason`, the diagnostic contract's registered reason for
that code. `internal` and `uncertain-result`, whose effect may have happened,
have none. A refusal takes its code's level from the SDK's one table, the
same as the bus's and its owners': a refusal a correct caller should never
receive (`unauthenticated`, `forbidden`, `too-large`, `duplicate-conflict`) or
lost capacity (`capacity`, `unavailable`) is a warning, `internal` is an
error, and a validation refusal is INFO. A refusal that repeats with the same
route, code and source, such as a part whose token was revoked reconnecting
every few seconds, is logged once, then once a minute with
`bunny.attempt_count` counting the repeats, until a quiet minute. A refusal never holds the edge's detail, which may
quote what the caller sent. The edge answers an exception it did not expect
with fixed text, never its message: `internal`, or `uncertain-result` once it
has handed a command to the bus. It logs one `runtime.edge.failed` record at
ERROR with only its route, its granted source, that code and `error.type`,
and after dispatch the command's routing key, request and message IDs and
trace, so the failure sits in the request's trace beside the bus's records.
Token rotation and grant permissions belong to #835.

`runMain`'s `onEdge` option hands the caller the edge once it serves. A
verification run's child uses it to end a part's stream, as a lost connection
would; the shipped entry point does not pass it.

## Configuration

With `--config <file>`, the runtime reads one configuration file before it
serves (Hub #919). It holds each module's own section, by module name:

```json
{
  "schema": "runtime-config/1.0",
  "modules": {
    "sign": {
      "greeting": "hello",
      "signs": [{"id": "sign-1", "address": "192.0.2.10"}],
      "secrets": {"token": "/home/owner/.config/agent-device-hub/secrets/sign-token"}
    }
  }
}
```

The file follows the [state](#state) rules: an absolute path off `/mnt`, no
link anywhere along it, outside every Git checkout, and a regular file with one
link and no permissions for group or others, owned and readable by the
runtime's user, of at most 1 MiB. The runtime opens the file's last part without
following a link, then refuses it unless the file it opened, as `/proc/self/fd`
shows, is the one at the path, so a directory swapped for a link after the
checks is refused too. The operator chooses the paths of this file and the
secret files; the runtime does not check the modes of their directories. It has only
`schema` and `modules`; #835 adds the edge's section. Otherwise the runtime
refuses to start, before it serves, with one of these codes in `runtime.failed`:
`config-relative`, `config-mount`, `config-missing`, `config-link`,
`config-checkout`, `config-not-file`, `config-not-private` (a file the runtime's
user may not read, or one under a directory it may not search, included),
`config-too-large` or `config-invalid`. No refusal quotes the file. The cutover's installer (#935)
writes the file from today's files. There is no reload: a change takes effect
when the runtime restarts.

Before it starts the modules, the runtime admits each one in list order with
the SDK's `checkConfiguration`, against its own section only. A section for a
module the runtime does not host is ignored. A module is refused, never
started, and shown in health as `refused` with a registry code and a fixed
detail, while the others start, when:
- it declares `configure` and the file has no section for it (`not-found`), or
  there is no file;
- its section is not a JSON object, or its `secrets` member does not map at most
  16 names to absolute paths (`invalid-request`);
- its `configure` refuses the section, with the refusal's code and detail, or
  throws (`internal`);
- it names a device that is not a routing ID, or one that a module before it
  already named (`invalid-request`);
- a secret file its section names is missing (`not-found`), is not private by
  the rules above, not readable by the runtime's user or under a directory it
  may not search (`forbidden`), or is larger than 64 KiB or not UTF-8 text
  (`invalid-request`).

The core (#831) declares no `configure`, so it needs no section. A malformed
`core` section refuses the core, and the runtime then ends as it does when the
core fails.

Its `runtime.module.refused` record carries `bunny.code` and the `manifest`
phase, and, for a `configure` that threw, the error's type. A module then gets
its configuration as `config`, reads only the secret files its section names
with `secrets.read(name)`, which checks the file again on every read, and keeps
its own files in `files()`. A module never sees another module's section or
secrets through its context; a module's own code is not sandboxed, as the
[module API](../../packages/sdk/README.md#secrets) explains, which also says
what each read refuses.

No secret reaches a log record, health or an error body. The runtime logs no
part of the file and no secret, and refusals carry fixed text. One registry of
the secrets modules read serves every writer in the process: the runtime's
writer drops, and counts in `runtime.stopped`, any record whose attribute holds
one, as text or as a number's digits. The process's `runtime.failed` record and
the runtime's records of a module's refusal, failure or stop problem leave such
an error attribute out instead, so the record is still written without it, and a
module's span leaves it out too, keeping the span for its children. Its tests and every disposable run
scan records, health, error bodies and proof for the synthetic token
`tok_SYNTHETIC919`.

## State

The state directory is created owner-only (mode 700) when it is missing. The
runtime refuses a relative path, a path under `/mnt`, a path inside a Git
checkout, a path with a link anywhere along it (including a dangling one), a
file, and a directory that others can open. It checks the whole path before it
creates anything, so a refused path creates nothing, and it never creates
through a link. Each module's SQLite file is `modules/<name>.sqlite` in it, mode
600, created when the module first calls `database()`. Beside it, the module's
private folder `modules/<name>/` is created with mode 700 when the module first
calls `files()`; a `modules` directory or folder that is a link, belongs to
another user or that others can open is refused with
`module-folder-not-private`.

## Failure isolation

A device's errors and timeouts are not module failures. Under policy A in
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md), a module opens
only local resources in `start`, reaches its device lazily and turns those
errors into outcomes and an `unavailable` device state. The
[module test kit](../../packages/sdk/README.md#module-test-kit) fails a module
whose start waits on a device that never answers, and the fixture sign shows
the pattern. A failed worker call is the module's to handle, too: it never
fails the module. An error that escapes a module stops only that module, and health
shows it `failed` until the runtime restarts; nothing restarts it
automatically. That covers:
- a start that throws, rejects or outlasts the start deadline (10 s);
- a subscription handler or responder that throws;
- a `scheduler.after` callback that throws or rejects;
- an uncaught error in a module's worker thread;
- an error that escapes to the process from the module's own async flow.

To stop a module, the runtime aborts its `signal`, cancels its timers and
closes its participant. That settles the module's own pending requests, closes
its sync copies and owners, and waits only for its own running handlers, so it
never waits on another module's handler. Then it calls `stop()`, terminates its
workers and closes its database. The close and `stop()` each have a 5 s
deadline; after the first, `stop()` runs even if a hung handler is still
running. A failed module stays stopped until the runtime restarts.

The whole stop runs in the module's own async flow, wherever the failure was
noticed. An error that the module's abort listeners or cleanup throw or reject
therefore stays with that module; it never fails the module that published the
message, nor the runtime's stop.

An error that escapes to the process from code outside every module is the
runtime's own failure: it writes a `runtime.failed` record and exits 1. So does
a failed start. A refusal the runtime makes itself names its reason in
`error.code`, so the journal says why a restart keeps failing:

| `error.code` | Refusal |
| --- | --- |
| `state-dir-relative` | The state directory is not an absolute path. |
| `state-dir-mount` | It is `/mnt` or under it. |
| `state-dir-checkout` | It is inside a Git checkout. |
| `state-dir-link` | A link, even a dangling one, is anywhere along it. |
| `state-dir-not-directory` | It, or a part of it, is a file. |
| `state-dir-not-private` | Others can open it. |
| `posix-host-required` | The host has no POSIX user IDs. |
| `module-db-not-private` | A module's SQLite file is not a private file with one link. |
| `config-relative`, `config-mount`, `config-missing`, `config-link`, `config-checkout`, `config-not-file`, `config-not-private`, `config-too-large`, `config-invalid` | The configuration file; see [Configuration](#configuration). |
| `port-invalid` | The port is not an integer from 0 to 65535. |
| `edge-grants-missing`, `edge-grants-not-private`, `edge-grants-invalid`, `edge-grant-source` | The edge's grants file; see [SDK edge](#sdk-edge). |
| `core-failed` | The [agent-session core](#agent-session-core) failed, such as on a store it cannot read or a lease another runtime holds. |

A Node error keeps its own code, such as `EADDRINUSE` for a health port in use.

## Event-loop lag check

A blocked event loop or memory exhaustion affects every module, so the process
cannot contain it. The service manager restarts the whole runtime instead. The
main thread counts a beat on a timer, and a watchdog worker thread checks the
count. A worker keeps running while the main thread is stuck, which a timer on
the main thread cannot do. When the beats stop for the lag limit, the worker
writes a `runtime.stuck` record to stderr and kills the process with SIGKILL.
Exiting suits systemd better than refusing health, because systemd does not
poll HTTP. The unit needs `Restart=on-failure`, which restarts after a failure
exit and after an unclean signal such as SIGKILL.

Time in which the watchdog itself did not run, because its wait overran, is
not counted. That covers a pause of the whole process, such as SIGSTOP or a VM
paused while its host sleeps: the main thread could not beat either. A stuck
main thread is still caught once the watchdog has been awake for the limit. A
watchdog thread that ends without being asked logs `runtime.watchdog.stopped`,
and health shows `lagCheck.status` `stopped` and `degraded`.

The worker costs about 14 MiB of resident memory: the runtime's VmRSS with and
without it, from `scripts/measure-memory.mjs`, measured before the core shipped.

## Logs

Each record is one JSON line on stderr and a
[diagnostic-contract](../../docs/observability-contract.md#the-runtimes-records-profile-12)
record of profile 1.3, built by the contract's `createRecord`: `schema_version`,
`timestamp`, the severity pair, a registered `event_name` with its static
`body`, the resource, the scope and its version (`1.0.0`), and registered
`attributes` with `bunny.provenance` `source`, plus `trace_id`, `span_id` and
`trace_flags` when the record has a trace. The resource is service `runtime`
in namespace `bunny`, `service.version` (the package's version), a
`service.instance.id` that each process draws once and shares with its
watchdog thread, and `deployment.environment.name` from `--environment`.
Maintenance intake reads these lines with the contract's validator. Beside the
stdout ready line, which keeps its own contract, the process writes a
`runtime.ready` record. `runtime.started` and `runtime.edge.serving` carry the
listener's port (`server.port`), never its URL, and `runtime.stopped` counts the
records the writer dropped (`bunny.telemetry.dropped_count`) and the sink lost
(`bunny.telemetry.failure_count`), with the spans lost.

The runtime's own records have scope `bunny.runtime`. A module's records have
the one scope `bunny.module` and the attribute `bunny.module`, which names the
module and which the module's own fields cannot replace. A module may log only
the events the catalog registers for modules, with registered attributes: the
runtime drops a record with another event or a value outside its registered
type, and leaves out fields the catalog does not register. The
[module test kit](../../packages/sdk/README.md#module-test-kit) fails a module
that logs either, and a new event goes through a catalog change. A dropped
record is counted, never truncated.

A failure record names the error's type (`error.type`) and, when it is an
identifier, its code (`error.code`). As the contract requires, it never holds
the raw message or stack, which may quote a URL with a token in it. A module's
refusal or failure carries its 2.0 registry code in `bunny.code` and where it
arose in `bunny.phase`: `manifest`, `start`, `handler`, `timer`, `worker` or
`async` (its own async flow). A problem in its stop carries `bunny.phase` and no
code: `handlers` (its participant's close) or `stop`, or, for an error after it
stopped, where that error arose. A refusal of a malformed name leaves the name
out.

A sink that fails never changes what the runtime does: a sink that throws loses
the record, and a closed stderr, which reports EPIPE, is ignored. The watchdog
thread writes its `runtime.stuck` record with the runtime's resource, and still
kills the process when stderr is closed.

A subscription whose full queue drops deliveries gets one
`runtime.delivery.dropped` warning at once. While drops go on, one more
warning a minute carries their count, so a storm cannot flood the journal. A
minute without drops ends that, and the next drop is logged at once again.

## Decision records and spans

The bus records each decision once, where it is made (ADR 0012's
"Observability", #949). The runtime connects the SDK's `onDiagnostic` on its
bus and its edge to its log, as records under `bunny.runtime` at the level the
SDK set:

| Record | Level | When |
| --- | --- | --- |
| `runtime.command.admitted` | INFO | The bus put a command in its owner's queue. |
| `runtime.command.refused` | WARN, its code's level | No responder, a full queue, an expiry in the queue or a closed responder. |
| `runtime.command.cancelled` | INFO | Its requester closed or stopped waiting before a handler started it. |
| `runtime.command.replied` | INFO; its code's level for a typed refusal, so ERROR for `internal` | The owner replied, `accepted` or with its typed refusal. |
| `runtime.command.uncertain` | WARN | A handler had it and the request ended `uncertain-result`. |
| `runtime.sync.served`, `runtime.sync.refused` | INFO; its code's level for a refusal | A sync request's answer. |
| `runtime.sync.restarted` | DEBUG | An overflow restarted a copy's sync. |

A command's records carry its requester (`bunny.participant`), its routing key
(`bunny.routing.key`), its request and message IDs, the outcome, any registry
code with its reason, and the command's own trace, from a module or a remote
part alike. A request ID that `bunny.request.id`'s 1.x pattern refuses is left
out of a record or span, which keeps the rest. A module's records come from its
own code and SDK helpers under `bunny.module`: its outbox's `outcome.published`
and `outbox.deferred`, and `device.unavailable` and `device.available` from
`DeviceAvailability`, which logs one degradation and one recovery for a polled
device that stays offline.

The runtime records spans through the observability package's
`createHostDiagnostics`, with tracing on, 100% head sampling that honors a
parent's sampled flag, no exporter and the adapter's bounded local span sink;
it installs no process context manager. The bus records each command's
`bunny.command.request`, `.queue` and `.execute` spans under `bunny.runtime`, and
`trace.start` records a module's own spans under `bunny.module` with its name.
Each finished span goes to `RuntimeOptions.spans` as one projected OTLP JSON
document; without that option the runtime keeps the latest 1,024 for
`runtime.spans()`, which returns them oldest first with the count of older
spans it evicted, so a span missing from memory was evicted only while that
count is above zero. Nothing exports them yet (#813). `runtime.stopped` counts spans
lost as invalid, dropped, unfinished at shutdown or failed in the sink, with the
records. If the adapter cannot start, the runtime runs without recorded spans
and logs one `runtime.tracing.failed` record at ERROR with `error.type`.

### The span file

With `--record-spans`, or `spans: 'state-file'` in `RuntimeOptions`, each finished
span goes to a file pair in the state directory instead of memory, so a process
outside the runtime can read the spans, and a crash keeps those it had finished
(#950; a disposable run's supervisor reads them for its
[follow query](verify/README.md#follow-one-request)).

- `spans.ndjson` is the segment being written and `spans.previous.ndjson` the one
  before it. Each segment holds at most 512 spans or 2 MiB, so the pair holds the
  latest spans, up to 1,024 (at least 512 unless spans are large, since each segment also rotates at 2 MiB),
  within the contract's 4 MiB queue bound. The next
  segment replaces the segment before it.
- A segment starts with one header line, `{"schema":"runtime-spans/1.0","evicted":N}`,
  that counts the spans let go before it. A reader can tell a span that was let go
  from one that never arrived, as `runtime.spans()` does for memory. A runtime
  that restarts on the same state directory continues the same files. If a kill
  came between starting a segment and writing its header, so that the current
  segment is missing or empty beside a previous one, the next header says
  `"evicted":null`: the count is unknown, never 0, and it stays unknown for the
  files' life.
- Both files are owner-only (mode 600), opened without following a link, and must
  be regular files with one link; any other file, the previous segment included, is
  refused with `span-file-not-private`, and the runtime does not start.
- A span that cannot start a segment, because the rename or the open fails, is lost
  and counted. The next span tries again, so recording resumes once the cause has
  gone.
- A span the file cannot take, because it is closed or the disk refuses it, is
  lost and counted in `runtime.stopped` like any other span the sink fails to
  take. A reader returns each complete line that is a span and counts a complete
  line that is not. A last line with no newline is a write in flight, or one that a
  kill cut short; it is never returned, a runtime that continues the file ends it
  first, and the reader then counts it as not a span.

## Memory

`node apps/runtime/scripts/measure-memory.mjs` measures the shipped runtime with
no configuration file, so the core alone, with each device module refused, for [#123](https://github.com/jimmie-potts/agent-device-hub/issues/123): three
runs, sampled at 5, 15, 30 and 60 s after the ready line. Add
`--variant no-lag-check` to measure it without the watchdog thread. It needs a
build and a TMPDIR outside every Git checkout.

## Fixture modules

A module is created by a factory that takes its device transport,
`create<Name>Module({transport})`, so a test or a disposable run passes a
simulated device and no hardware is touched (#846). The fixture modules show
the convention. There is no manifest slot or registry for transports, because
ADR 0012 rules out a plug-in framework.

`tests/fixtures/lamp.ts` holds the lamp, the stand-in device module that later
stories build on. `createLampModule({transport})` takes a `LampTransport`.
`SimulatedLamps` is the simulated one: it keeps its state across runtime
restarts, as a real lamp would, and a test can hold its switches or make the
next one fail. The lamp passes the
[module test kit](../../packages/sdk/README.md#module-test-kit):
- it serves its lamps (family `lamp`) through sync, and their `device/2.0`
  records, which say only that each is a lamp, as every device module serves
  `device` for its own devices (#918, #967);
- it copies the core's `mode` and `session`, keeps the lamps off in quiet mode,
  and shows on its indicator whether a session waits for a person;
- it switches a lamp on `bunny.cmd.lamp.<id>`, refusing an unknown lamp with
  `not-found`;
- it accepts a command whose `requestId` it already handled from the same
  source, a duplicate, and changes nothing;
- it switches the device in a `bunny.device.call` span, the command's child,
  and gives the device no trace context;
- it reports each switch through its [outbox](../../packages/sdk/README.md#outbox),
  which records the outcome's publication: the lamp's new state, the
  `org.bunny.lamp.switched` occurrence and the outcome. When the lamp cannot be
  reached, the outcome is `failed`, with evidence `none` and the `unavailable`
  error.

`lampSchemas` holds its payload schemas, and `lampSpec()` its kit description.
`tests/fixtures/chime.ts` holds a consume-only module,
`createChimeModule({transport})` with `SimulatedChime`. It follows the core's
sessions and rings once for each approval prompt. It records what it rang in
its own SQLite file, so a restart with the prompt still waiting does not ring
again. It passes the kit as a module that only copies.

`tests/fixtures/sign.ts` holds the sign, the configured stand-in for a device
module with settings, a secret and private files (#919).
`createSignModule({transport})` takes a `SignTransport`; `SimulatedSigns` starts
offline, never answering, and accepts only the synthetic token. Its
`configureSign` takes a greeting, the signs' IDs and addresses, and its token's
file as `secrets.token`. Its start reads the token, keeps its layout in its
private folder, serves its signs (family `sign`) and their `device/2.0` records,
and returns without reaching a sign. It then reaches each sign on the runtime's
scheduler with a 1 s deadline, to show the greeting it rendered with a worker
call: a sign that does not answer is `unavailable` and is tried again with
capped backoff, and one that shows the greeting is `available`. It publishes
each change of a sign's availability as the sign's state and its device record.
A render that fails, past its deadline included, is no evidence about the sign:
its availability stays as it was, the failure is logged against the sign with
the call's code, and the attempt is tried again. It logs each change and each
run of failed renders once, not each attempt. `signSpec()` runs it through the
kit, policy A's check included.

`tests/fixtures/core.ts` hosts the real core, as `createCoreModule()`, with
stand-in parts through its extension point. Each part goes when its owner
lands:
- as history, until Hub #782, it records each outcome as a `stand-in-history`
  entry, then acknowledges the outcome with the kit's stand-in acknowledgment,
  which the lamp follows;
- as the inbox, until Hub #923 turns failed and uncertain results into inbox
  items, it records each failed or uncertain outcome as an `inbox-item`
  operation;
- it owns the mode, until #695.

The parts take every occurrence and outcome other than a hook's lifecycle
observation once by `(source, id)`, keeping what they took in the core store
across restarts. Their changes go out through the core's outbox after they
commit, and the core serves their families through its sync with `session`. The
fixture core's consumers add the catalog's panel to the shipped ones.

A process test kills the runtime between the lamp's commit and its publish,
then restarts it twice. At the first restart the lamp sends its state,
occurrence and outcome, the core takes the outcome once and acknowledges it,
and the lamp forgets it. The second restart sends nothing, and nothing ever
sends the command again.

## Scenario catalog

`tests/scenarios/catalog.ts` is the runtime's one scenario catalog (#846). Each
scenario says what a person or a device should see, as a seed and named steps.
The seed names the modules to start and the families the reader copies, one copy
per owner. A copy of a family that several modules serve, such as `device`,
names its owner, `{owner: 'bunny/modules/lamp', families: ['device']}`, and
`reader.states(family, owner)` reads that owner's copy alone (#967). A step acts
through the harness, expects an observation within a time bound, or expects one
to hold. A failed step names what it observed and stops the scenario. Each run
type has one execution adapter that runs the same definitions unchanged:
`tests/scenarios/memory.ts`, the in-memory harness (tier 1, in CI), and the
[disposable runs](verify/README.md) of #920 (tier 2), whose run adapter is
`verify/adapter.ts`. Every runtime story adds its scenarios to the catalog.

The in-memory harness hosts the seed's modules in the runtime's module host,
each built by its factory with its simulated transport, on a manual clock and
scheduler. Each scenario runs twice. Its parts (a hook, an operator, a panel
and a reader) first join the host's bus, then reach it through a `RemoteEdge`
on 127.0.0.1 with a run-generated token each. A crash between the lamp's commit
and its publish abandons the runtime and starts a new one on the same state
directory behind the same port, as the service manager would restart it.
Simulated devices keep their state across the crash. The harness can also lose
the core's next acknowledgment to the lamp on its way, so the lamp reports that
outcome again at its next start.

The catalog holds:
- an approval prompt reaching every module;
- a command with a tracked outcome, and a failed one in the inbox;
- a module failing while the others continue;
- a part reconnecting and syncing, with nothing replayed;
- the runtime starting with zero modules;
- the agent-session core alone: sessions from hook observations, an approval
  prompt raised and cleared, a finished turn kept on its session record with no
  inbox item, a notice acknowledged by a consumer for itself only, a runtime
  end, and a restart that leaves the sessions uncertain until fresh evidence;
- the early end-to-end path: a hook observation, the committed session, the
  simulated device's update, a command, its outcome, history and inbox rows,
  then sync and read. It adds a duplicate command, a failed command whose inbox
  row the reader reads, the deadline answers, a disconnect, a crash-restart and
  a lost acknowledgment, which the core takes as a duplicate and acknowledges
  again;
- a configured module, the sign, starting while its sign is offline, reporting
  it unavailable and showing its greeting once it is online;
- a module whose configuration is invalid refused while the core runs on;
- the [playback module](../../modules/playback/README.md) (#929) following the
  speaker the phone plays to: the HT-A9 alone, then the Move; a pause that
  reaches the presented speaker only; a Move that goes silent mid-song, so the
  record turns stale with its song kept and a command is refused `unavailable`,
  with one degradation and one recovery logged; and a command the Move never
  answers, `uncertain` in history and the inbox and never sent again. Time is
  real in a disposable run, so the step to `unavailable` at 30 s is left to the
  module's own tests.
- the LIFX module (#928) with a simulated pendant and Beam: the pendant follows the
  core's sessions in Work, painting once per change, a restart writes nothing to
  it, Free never paints it, a color command reaches it, and once it is switched
  off at the wall it shows unavailable and a command to it ends uncertain in the
  inbox; the Beam has no controls and gets no packet, and no address leaves the
  module.
- the [Tidbyt module](../../modules/tidbyt/README.md) (#930) on a simulated
  cloud: an idle start writes nothing; the status tile follows the core's
  sessions, and a burst of changes inside the 15-second gate makes one later
  push of the latest state; the now-playing tile follows the playback module's
  record through play and pause, behind its own gate, and leaves the rotation
  when the music stops; the reader holds the Tidbyt's device record with no
  control; and neither the API key nor the cloud device appears anywhere. The
  simulated cloud shows each tile as text rows, and the scenario compares them
  with the frames the reader's own copies call for.

A seed's `config` gives configured modules their sections. Each harness writes
them, as the installer would, into a private configuration file with a token
file per module that holds the synthetic token, and starts the runtime with it.
Both configured scenarios check that the token appears in no log record,
message, health entry or reader copy.

The deadline answers per transport:

| Case | In process | Remote |
| --- | --- | --- |
| A command its handler holds at the deadline | `uncertain-result` | `uncertain-result` |
| A command still queued at the deadline | `expired` | `expired` |
| A requester that closes while its command is queued | `cancelled` | `uncertain-result` |
| A requester whose command is in flight when the runtime crashes | dies with the runtime | `uncertain-result` |

Rows 1 and 2 follow the SDK's "Request and respond with expiry" requirement,
which the [remote transport](../../packages/sdk/README.md#remote-transport)
keeps. The SDK's "One conformance suite for every transport" requirement fixes
rows 2 and 3 per transport. Row 4's remote answer comes from the remote client:
a call whose connection drops settles as `uncertain-result`, because the
command's fate is unknown, by the command's deadline plus `REQUESTER_GRACE_MS`
at the latest. Its in-process cell only describes what happens: the requester dies
with the runtime, and the harness labels its request `lost`. That label is the
harness's own, not an answer the SDK gives.

The scenarios assert the runtime's records on both transports: each deadline
answer's admission and ending at its level, the refusal of a command with no
responder, and each outcome's publication recorded once across the crash, the
lost acknowledgment and the restarts. The in-memory harness also records the
bus's and the modules' spans, and its tests check that the end-to-end path has
no lost parent and that work published after a restart links to its stored
context.

The harness never listens on an installed service's port (8765, 8787, 8788,
8791 or 41231). It keeps its state in a private directory under the system
temporary directory, which must be outside every Git checkout, and removes it
afterwards. Its tokens appear in no log record or message. It checks every
message it sees against profile 2.0.

## Checks

See [Runtime checks](../../docs/development.md#runtime-checks).

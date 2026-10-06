# B.U.N.N.Y. runtime

Private workspace package `@jimmie-potts/runtime`. It is the one runtime process
that [ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) describes. It
hosts a fixed list of modules on the SDK's in-process bus and serves health on
a loopback port. It runs with zero modules; the shipped list in
`src/modules.ts` is empty until module stories add to it. Nothing installs it
yet; the cutover (#840) does.

Modules are written against the [module API](../../packages/sdk/README.md#modules)
in `@jimmie-potts/sdk`. There is no dynamic loading, middleware or durable
subscription: adding or removing a module is a code change in `src/modules.ts`.

## Run

From the repository root, with Node 24, after `npm run build`:

```sh
node apps/runtime/dist/src/main.js --port 0 --state-dir ~/.local/state/agent-device-hub/runtime
```

| Argument | Meaning |
| --- | --- |
| `--port` | Required. The loopback port for health; 0 picks a free one. |
| `--state-dir` | The private state directory. Defaults to `~/.local/state/agent-device-hub/runtime`. |
| `--lag-limit-ms` | How long the event loop may stay stuck before the process is killed. Defaults to 10000. |
| `--log-level` | `debug`, `info`, `warn` or `error`. Defaults to `info`. |

Malformed arguments exit with status 2 and a usage line. Once the modules have
started, the process writes one line to stdout, `{"event":"runtime.ready","url":...}`.
SIGTERM or SIGINT stops every module and exits 0. A signal that arrives while
the modules start is remembered: once their starts settle, the runtime stops
them all and exits 0, without a ready line.

## Health

`GET /api/runtime/v1/health` answers 200 with a `runtime-health/1.0` document
while the process serves. Its `status` is `ok` when every module runs and the
lag check, if any, is active, and `degraded` otherwise. Each module has a
`state` (`refused`, `starting`, `running`, `stopping`, `stopped` or `failed`),
`healthy`, `syncRestarts` (how often an overflow restarted one of its sync
copies, so a restart loop shows) and, when refused or failed, a `reason` with a
code from the 2.0 error registry. `lagCheck` is `off`, or `active` or `stopped`
with its `limitMs`. `memory` reports the whole process from
`process.memoryUsage()`.

A request must name the listener as its host (`127.0.0.1:<port>` or
`localhost:<port>`) and carry no `Origin` and no `Sec-Fetch-Site` other than
`none`, as the Hub and local controllers require, so a page on a rebinding name
cannot read module state. Any other request answers 403 with the shared error
body and `forbidden`. Every other route answers 404 with `not-found`.

## State

The state directory is created owner-only (mode 700) when it is missing. The
runtime refuses a relative path, a path under `/mnt`, a path inside a Git
checkout, a path with a link anywhere along it (including a dangling one), a
file, and a directory that others can open. It checks the whole path before it
creates anything, so a refused path creates nothing, and it never creates
through a link. Each module's SQLite file is `modules/<name>.sqlite` in it, mode
600, created when the module first calls `database()`.

## Failure isolation

A module's thrown error, rejected promise or device timeout stops only that
module, and health shows it `failed`. That covers:
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
runtime's own failure: it writes a `runtime.failed` record and exits 1.

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

The worker costs about 13 MiB of resident memory: the zero-module runtime's
VmRSS with and without it, from `scripts/measure-memory.mjs`.

## Logs

Each record is one JSON line on stderr with OpenTelemetry field names:
`timestamp`, `severity_text`, `severity_number`, `event_name`, `resource`,
`scope` and `attributes`, plus `trace_id`, `span_id` and `trace_flags` when the
record has a trace. A module's records have scope `bunny.modules.<name>` and the
attribute `bunny.module`. A failure record names the error's type
(`error.type`) and, when it has one, its code (`error.code`). As the
[diagnostic contract](../../docs/observability-contract.md) requires, it never
holds the raw message or stack, which may quote a URL with a token in it.

These are not yet diagnostic-contract records. They lack `schema_version`,
`body`, a scope version and the resource's `service.version`,
`service.instance.id` and `deployment.environment.name`, and the contract's
catalog does not register the runtime's service, scopes, events or attributes.

A subscription whose full queue drops deliveries gets one
`runtime.delivery.dropped` warning at once, then at most one more per minute
with the count of later drops, so a burst cannot flood the journal.

## Memory

`node apps/runtime/scripts/measure-memory.mjs` measures the zero-module runtime
for [#123](https://github.com/jimmie-potts/agent-device-hub/issues/123): three
runs, sampled at 5, 15, 30 and 60 s after the ready line. Add
`--variant no-lag-check` to measure it without the watchdog thread. It needs a
build and a TMPDIR outside every Git checkout.

## Checks

See [Runtime checks](../../docs/development.md#runtime-checks).

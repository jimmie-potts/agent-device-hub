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
SIGTERM or SIGINT stops every module and exits 0.

## Health

`GET /api/runtime/v1/health` answers 200 with a `runtime-health/1.0` document
while the process serves. Its `status` is `ok` when every module runs and
`degraded` otherwise. Each module has a `state` (`refused`, `starting`,
`running`, `stopping`, `stopped` or `failed`), `healthy` and, when refused or
failed, a `reason` with a code from the 2.0 error registry. `memory` reports the
whole process from `process.memoryUsage()`. Every other route answers 404 with
the shared error body.

## State

The state directory is created owner-only (mode 700) when it is missing. The
runtime refuses a relative path, a path under `/mnt`, a path inside a Git
checkout or reached through a link, and a directory that others can open. Each
module's SQLite file is `modules/<name>.sqlite` in it, mode 600, created when the
module first calls `database()`.

## Failure isolation

A module's thrown error, rejected promise or device timeout stops only that
module, and health shows it `failed`. That covers:
- a start that throws, rejects or outlasts the start deadline (10 s);
- a subscription handler or responder that throws;
- a `scheduler.after` callback that throws or rejects;
- an uncaught error in a module's worker thread;
- an error that escapes to the process from the module's own async flow.

To stop a module, the runtime aborts its `signal`, cancels its timers and
closes its participant. That settles the module's own pending requests and
waits only for its own running handlers, so it never waits on another module's
handler. Then it calls `stop()`, terminates its workers and closes its database.
The close and `stop()` each have a 5 s deadline. A failed module stays stopped
until the runtime restarts.

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
exit and after an unclean signal such as SIGKILL. The worker costs about 15 MiB
of resident memory.

## Logs

Each record is one JSON line on stderr with OpenTelemetry field names:
`timestamp`, `severity_text`, `severity_number`, `event_name`, `resource`,
`scope` and `attributes`, plus `trace_id`, `span_id` and `trace_flags` when the
record has a trace. A module's records have scope `bunny.modules.<name>` and the
attribute `bunny.module`. A failure record names the error's type and its
message, cut to 512 characters, never its stack.

## Checks

See [Runtime checks](../../docs/development.md#runtime-checks).

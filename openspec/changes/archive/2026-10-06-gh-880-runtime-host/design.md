## Context

See proposal.md for why. ADR 0012 fixes the shape: one TypeScript process, a fixed module list, the SDK's in-process bus, per-module SQLite files, and failure isolation that contains a module's errors while the service manager restarts a stuck or exhausted process. The SDK bus from #879 had no participant close, used the global `setTimeout` for deadlines and reported a command still queued at its deadline as uncertain. The strict profile's module boundary rule lets a file under `modules/` import only the SDK, the contracts packages, Node built-ins and third-party packages.

## Goals / Non-Goals

**Goals:**
- A module's failure is contained without the module's cooperation, and its stop leaves no subscription, responder, request, timer, worker or open database behind.
- A stopping module never waits on another module's handler.
- Every behavior is testable in process, except the process-wide paths, which are tested in child processes as the service manager runs them.

**Non-Goals:**
- Restarting a failed module. It stays stopped until the runtime restarts.
- Registering the runtime in the diagnostic contract's catalog. Records use the contract's field names only.
- A single-instance lock on the state directory. Installation (#840) runs one unit.

## Decisions

**The module API lives in the SDK.** The module boundary rule refuses an import of `@jimmie-potts/runtime` from `modules/`, so the manifest, module and context types must come from the SDK. `apps/runtime` implements them. Alternative: a separate `module-api` package. That would need a boundary rule change and adds a package for a few types.

**`connect` returns a `Participant`; modules get only the `Sdk`.** `Participant` adds `close()` to the `Sdk` calls. The runtime gives each module a wrapper without `close`, so only supervision closes a module's participant. Alternative: `close()` on `Sdk`. A module could then detach itself while health still says it runs.

**Participant close settles pending requests before it closes anything.** A request whose command is still queued is taken out and refused as `cancelled`, because nothing reached the owner. A request whose command a handler has becomes `uncertain`, because it may have taken effect. Settling first lets the closing participant's own handlers, which may await those requests, finish. That is what keeps a module's stop from waiting on another module's handler. Alternative: leaving abandoned requests pending. Their awaiting handlers would then block the close until the other module answered or the deadline passed.

**A command that never reached its handler expires.** At the deadline, the bus removes a still-queued command and answers `expired`; a command the responder skips because it arrived at or after its expiry gets `expired` at once. This follows the #880 scope decision: the bus knows nothing happened, so no inbox item needs a person. A handled command keeps `uncertain-result`.

**Escaped errors are attributed by AsyncLocalStorage.** Every callback the runtime runs for a module runs inside a per-module async context: `start`, `stop`, handlers, responders, timers and workers. The process's `uncaughtException` and `unhandledRejection` handlers read the context and stop that module. On Node 24, AsyncLocalStorage follows promise continuations and timers, so a rejection raised in the module's own flow names the module. Alternative: only wrapping calls the runtime makes. An error from a module's own client library callback would then crash the process. Errors the SDK catches from handlers come through the bus's `onError`, which names the source.

**Stop order: signal, timers, participant, `stop()`, workers, database.** The participant closes before `stop()` runs, so no handler of the module runs during or after `stop()`. The close and `stop()` each have the stop deadline, so a handler that never finishes delays the stop but cannot block it. `stop()` is always called once start was called, even after a failed or timed-out start, so the module can release what a partial start opened. Alternative: calling `stop()` first. Handlers could then still run while the module releases its resources.

**The lag check is a watchdog thread that kills the process.** The main thread counts a beat in shared memory, and a worker thread sleeping with `Atomics.wait` checks it. When beats stop for the lag limit, the worker writes a fatal record and sends SIGKILL to the process; systemd's `Restart=on-failure` restarts the runtime. A timer on the main thread cannot detect a loop that never yields. SIGTERM would wait for the runtime's own handler, which cannot run on a stuck loop. Alternatives: systemd's `WatchdogSec` with `sd_notify`, which Node cannot send without a native module or a child process per ping; and refusing health, which systemd does not poll. The cost is one worker isolate, about 15 MiB of resident memory. A heap limit on the worker was dropped: below what V8 needs to start an isolate, it aborts the whole process.

**API versions match on the major and a minor that is not newer.** `<major>.<minor>` follows the repository's schema identifiers, where a minor version is additive. A module written for `1.0` runs on a `1.2` runtime; one written for `1.3` or `2.0` does not.

**Health answers 200 while the process serves.** A refused or failed module makes `status` `degraded` but not the HTTP status, because a failed module must not make anything restart the runtime and stop the healthy modules.

## Risks / Trade-offs

- [Containing an uncaught exception leaves the process running after the error] → Only errors attributed to a module are contained, and that module is stopped at once. Anything else exits 1.
- [Attribution follows the async flow that raised the error] → An error raised in another module's flow, such as a listener on another module's emitter, names that module. Module code talks only through the bus, which runs each module's handlers in its own context.
- [A module's stop can take twice the stop deadline] → The close and `stop()` are bounded separately, so `stop()` still runs after a close that timed out.
- [The watchdog costs about 15 MiB] → It is recorded for #123 with the zero-module baseline.
- [A full subscription queue drops messages and only logs them] → Sync (#881) restarts a consumer that missed messages.

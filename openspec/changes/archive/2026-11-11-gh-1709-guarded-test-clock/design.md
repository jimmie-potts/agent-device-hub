## Context

`startRuntime` already takes `clock` and `scheduler` and passes them to the module host, the core, log records and the gateway. `runProcess`, the service process around it, never passes one. The verification supervisor forks `verify/child.js`, which calls `runMain`. The installed image copies the whole build, so `dist/verify/child.js` is present in an installed runtime too. See proposal.md for why the seam is needed.

## Goals / Non-Goals

**Goals:**

- A clock input that only code can pass, refused by the process itself unless it is a disposable verification run's child.
- A refusal that uses the runtime's existing failure path and record, before anything starts.

**Non-Goals:**

- Selecting, advancing or settling a virtual clock in a run, and the harness API's clock routes (#1705 story 6).
- Catalog captures on virtual time (#1705 story 7).

## Decisions

- **A programmatic input, not a flag or environment variable.** `testClock` sits beside the child's other inputs (`schemas`, `onEdge`) in a `ChildInputs` type that `runMain` takes as its third argument. The launcher's `Loaded.runMain` type and `main.ts` pass two arguments only. An environment variable or flag would be reachable from a service unit or a container's arguments; a value constructed in code is not. Alternative considered: a `--clock` flag refused in production. Rejected: any flag is one configuration edit away from an installed runtime.
- **The process checks its own conditions.** The guard reads the parsed options (`simulate`, `environment`, `edge`) and the presence of `process.send`, which Node defines only when the parent opened an IPC channel. The verification supervisor forks its child with one; systemd and the container entrypoint start the runtime without one. Each condition alone is enough to refuse, so an installed runtime fails on several at once (production environment, no `--simulate`, no IPC). Alternative considered: checking for the child file or the supervisor's process. Rejected: the file ships in the image, and a parent check depends on process names.
- **Refuse through `fail`, before anything else.** The check runs right after `runProcess` builds its log writer and `fail`, before signal handlers, `startRuntime`, the state directory or any module. It writes one `runtime.failed` record through `faultFields`, as every other start failure does, with `RuntimeError` and the registry's `invalid-state`; the text is fixed per condition. No new event, attribute, code or error shape (ADR 0012).
- **The monotonic clock goes through the core's options, not the runtime.** The core's music capture takes `CoreOptions.monotonic` (#1695). The runtime does not construct the core's options; the module factories do. So `TestClock` carries `monotonic`, and the fixture core's options accept it for the child to pass. The source check covers `monotonic` in the installed entry points and `modules.ts`, whose core factory takes no options.

## Risks / Trade-offs

- [The source check is a word match on four files, so a future comment that mentions a clock fails it.] → Its message names the file; the wording can change in that file, and the check keeps the clock out of the installed path.
- [The child passes no test clock yet, so the positive path is proven by a test fixture process, not by `verify/child.ts`.] → The fixture goes through the same `runMain`; story 6 adds the child's own clock and its run-level tests.
- [The guard trusts `process.send` as the supervisor's channel.] → An IPC channel is one of four conditions, and a clock still needs code that constructs it; nothing in the installed entry points does.

## Migration Plan

None. No stored data or configuration changes. Without a test clock the runtime behaves as before, so a routine upgrade carries it with no installed behavior change.

## Context

See proposal.md for why. The app-verify core runs one process per run under a transient user unit, records a ready line's URL and extra endpoints, and judges capture steps (ADR 0009). The CHOMPI bridge adapter (#853) set the pattern of a run that serves the real application with simulated parts and runs a shared catalog. #846's catalog talks to the runtime only through its `Harness` contract, whose reads are synchronous and whose end-to-end scenario needs a crash between the lamp's commit and its publish, restarts on the same state directory, and simulated devices that keep their state. ADR 0012 puts remote parts behind the SDK's remote transport and forbids a plug-in framework.

## Goals / Non-Goals

**Goals:**
- Every catalog scenario runs in a run unchanged, end-to-end included, with a real crash.
- The runtime runs through its own entry point and launch options, not a test double.
- A run never reaches an installed service, a port of one, personal state or a device, and each boundary has a check with a negative control.
- Grants are run-generated, owner-only and never printed; no grant acts as the core or a module.

**Non-Goals:**
- A browser page: #922 brings the dashboard, and a step's page shows the health document until then.
- Lifecycle runs in CI: #873.
- Grant permissions, rotation and browser sessions: #835.

## Decisions

**A supervisor holds the devices; the runtime is its child.** An armed crash kills the runtime process with SIGKILL between the lamp's commit and its publish, as #882's kill test does. The devices must outlive it, so they live in the supervisor, and the fixture modules reach them over the child's IPC channel: a device transport like any other. The supervisor restarts a child that dies on its own on the same port and state directory, as the service manager would. Rejected: running the runtime in the supervisor's own process, which cannot crash for real without ending the run; and keeping device state in a file the runtime reloads, which would make the devices part of the runtime's state.

**The runtime runs through `runMain`.** The child is the runtime's own entry with `--simulate`, `--edge` and the run's state directory, so the launch options are what a run exercises. The `shipped` scenario and one negative control run the shipped entry point itself.

**One ordered channel, and a flush.** The catalog reads devices, log records and published messages synchronously, so the run adapter keeps a copy and refreshes it on every wait and after every action. Device calls, published messages and control acknowledgments share the child's one IPC channel, in order. Before the harness API answers a state read, it sends the child a flush and waits for the answer, which comes after every delivery already queued, so whatever the runtime published before a reply is in the copy before the scenario reads it. Log records come from the child's stderr and are only polled for. Refreshes run one at a time, so two never append the same records; a test found that bug.

**Time is real, and a reconnect waits for the next wait.** The adapter's `wait` sleeps. A part that `disconnect` dropped connects again at the next wait, as the in-memory harness's does when virtual time moves, so the gap a scenario measures is deterministic.

**The edge serves once the modules have started.** Until then its routes answer 503 `unavailable`, so a remote part that reconnects after a crash retries its stream instead of syncing from a module still starting, which would end its copy.

**Families the edge accepts.** The edge checks remote messages against the core families and each factory's `schemas`. A zero-module run of the fixture runtime has no factory, yet its parts still send the fixture lamp's commands, as they do through the in-memory harness's edge. So `runMain` takes extra families, which the run's child passes, and the catalog's zero-module scenario gets `unavailable` in both adapters. The shipped entry point passes none.

**Grants.** One file in the state directory, owner-only, never through a link, read before the runtime serves. The run seeds one grant per part, `bunny/parts/<role>`; a grant for `bunny/core` or `bunny/modules/<name>` is refused, because the edge would otherwise let a remote part publish as that source.

**Boundaries.** `simulated-transports` reads the runtime's own `runtime.started` record. `no-outbound-connections` reads a guard loaded with `--import` before the runtime that refuses every outbound TCP connection before it is made: the runtime only listens, and its devices are reached over IPC. `private-state` checks the runtime was given the run's state directory, its home is the run's, and the grants file is owner-only. The supervisor always gives the child a home inside the run, so even the control that leaves out `--state-dir` touches nothing personal.

## Risks / Trade-offs

- [Real time.] Scenario bounds are real milliseconds in a run. A restart takes about half a second here; the catalog's default bound is 3 s. The capture steps were stress-run before merge.
- [The guard patches `net.Socket.prototype.connect`.] A connection made another way, such as a native addon, would pass it. The runtime has none, and a module story that adds a device transport adds its own simulated one.
- [A stopped supervisor's child.] It stops itself on the IPC channel's disconnect and ignores the closed pipes; systemd's control-group kill covers a unit, and the guard covers a supervisor started directly.

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

**A supervisor holds the devices; the runtime is its child.** An armed crash kills the runtime process with SIGKILL between the lamp's commit and its publish, as #882's kill test does. The devices must outlive it, so they live in the supervisor, and the fixture modules reach them over the child's IPC channel: a device transport like any other. The supervisor restarts a child that dies on its own on the same port and state directory, as the service manager would, at most five times within any minute, as systemd's start limit would. Starts and restarts run one after another, so overlapping restart requests never race for the port, and only the current runtime's own exit counts as a crash (PR #942 review). Rejected: running the runtime in the supervisor's own process, which cannot crash for real without ending the run; and keeping device state in a file the runtime reloads, which would make the devices part of the runtime's state.

**The runtime runs through `runMain`.** The child is the runtime's own entry with `--simulate`, `--edge` and the run's state directory, so the launch options are what a run exercises. The `shipped` scenario and one negative control run the shipped entry point itself.

**One ordered channel, and a flush.** The catalog reads devices, log records and published messages synchronously, so the run adapter keeps a copy and refreshes it on every wait and after every action. Device calls, published messages and control acknowledgments share the child's one IPC channel, in order. Before the harness API answers a state read, it sends the child a flush and waits for the answer, which comes after every delivery already queued, so whatever the runtime published before a reply is in the copy before the scenario reads it. Log records come from the child's stderr and are only polled for. Refreshes run one at a time, so two never append the same records; a test found that bug.

**Time is real, and a reconnect waits for the next wait.** The adapter's `wait` sleeps. `disconnect` keeps the Harness contract: the runtime's edge ends the part's stream, and the same remote part reconnects on its own and tells its subscriptions of the gap. `runMain`'s `onEdge` hook hands the run's child the edge, and the harness API's disconnect control reaches it over IPC. The part's scheduler holds its timers until the next wait, as the in-memory harness's wait until virtual time moves, so the part stays away for the steps between and the gap a scenario measures is deterministic. The catalog counts the reader's gap notices, so a fresh connection in place of the reconnect fails `reconnect-and-sync` and `end-to-end`. Rejected: closing the part and connecting a new one, which was the first version and did not match the contract (PR #942 review).

**The edge serves once the modules have started.** Until then its routes answer 503 `unavailable`, so a remote part that reconnects after a crash retries its stream instead of syncing from a module still starting, which would end its copy. `runtime.started` says the edge is configured, and `runtime.edge.serving` says when it serves. From the start of a stop until the listener closes, the routes answer 503 again, not 404, so a reconnecting part sees an edge that is going away rather than one that never existed. The edge's refusal records keep only the route, the registry code and that code's fixed meaning: the edge's detail can quote what a caller sent or an exception's message.

**Families the edge accepts.** The edge checks remote messages against the core families and each factory's `schemas`. A zero-module run of the fixture runtime has no factory, yet its parts still send the fixture lamp's commands, as they do through the in-memory harness's edge. So `runMain` takes extra families, which the run's child passes, and the catalog's zero-module scenario gets `unavailable` in both adapters. The shipped entry point passes none.

**Grants.** One file in the state directory, owner-only, never through a link, read before the runtime serves. The run seeds one grant per part, `bunny/parts/<role>`; a grant for `bunny/core` or `bunny/modules/<name>` is refused, because the edge would otherwise let a remote part publish as that source.

**Boundaries.** `simulated-transports` reads the runtime's own `runtime.started` record. `no-outbound-connections` reads the report file of a guard loaded through `NODE_OPTIONS`, so the worker threads and Node processes that inherit the runtime's environment load it too. The guard refuses every outbound TCP connection and every UDP send or connect before anything leaves: the runtime only listens, and its devices are reached over IPC. `net`, `tls`, `http`, `https` and `fetch` all connect through `net.Socket#connect`. A call there is a pipe only when its path is a non-empty string, as `net` decides; `http` and `https` pass `path: null`, which the first version let through (PR #942 review). `private-state` judges the outcome, not the arguments, as the CHOMPI bridge's `lockInRun` does: the runtime's home, read from its environment, is the run's; nothing exists under `<home>/.local/state`; every SQLite file the runtime has open is under the run's state directory; and the grants file is owner-only. The supervisor always gives the child a home inside the run, so even the control that leaves out `--state-dir` touches nothing personal. `build-current` watches every workspace package the run loads, `packages/event-contracts` included, and a test derives that list from the run's import graph.

## Risks / Trade-offs

- [Real time.] Scenario bounds are real milliseconds in a run. A restart takes about half a second here; the catalog's default bound is 3 s. The capture steps were stress-run before merge.
- [The guard patches `net.Socket#connect` and `dgram.Socket#send` and `#connect`.] Traffic that bypasses them would pass it: a native addon, a non-Node binary, a Node process or worker thread started with `NODE_OPTIONS` cleared or replaced (a worker given its own `env`, or an `eval` worker), or a name lookup through `node:dns`. The runtime uses none of these, and a module story that adds a device transport adds its own simulated one.
- [A stopped supervisor's child.] It stops itself on the IPC channel's disconnect and ignores the closed pipes; systemd's control-group kill covers a unit, and the guard covers a supervisor started directly.

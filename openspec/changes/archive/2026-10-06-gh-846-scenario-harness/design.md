## Context

See proposal.md for why. The runtime (#880) hosts modules on one in-process bus, and the SDK (#883) carries the same calls to remote parts through a `RemoteEdge` over SSE and HTTP. The module test kit (#882) checks one module at a time; nothing yet runs several modules and remote parts together. The SDK's conformance requirement fixes the deadline answers per transport. ADR 0012 forbids replay, never sends a command twice, and has each module's outbox report an outcome again after a restart until the core has it. #853's CHOMPI bridge harness set the pattern: one catalog of seeds and named steps, run by an in-memory runner in CI and by disposable runs.

## Goals / Non-Goals

**Goals:**
- One catalog whose definitions every execution adapter runs unchanged.
- The early end-to-end path over both transports, with a duplicate command, a disconnect and a crash-restart, each checked against what a person or device would see.
- Deterministic deadlines: no scenario depends on how fast the machine is.
- Modules that take their device transport as an input.

**Non-Goals:**
- Disposable runs, their edge mount and the `--simulate` launch option: #920.
- The real session owner (#831), history and the tracker (#782), and the inbox items (#923). The stand-ins show only what the catalog needs. When #782's history read API lands, the `Harness` contract needs a history-read observation in place of the reader's `stand-in-history` sync copy.
- Work mode scenarios: #924.

## Decisions

**One harness contract, implemented per run type.** A scenario touches the runtime only through `Harness`: the parts' participants, a request log by label, the reader's copies, the simulated devices' state as plain data, health, log records, published messages, `wait`, `disconnect`, `closePart`, `armCrash` and `restart`. A disposable run can implement each one through its edge and loopback endpoints, so #920 adds an adapter, not a second catalog. A per-transport expectation is data in the scenario, as the SDK's conformance suite does it.

**The runtime's own module host, not the kit's harness.** The catalog checks the runtime's failure isolation and restart, which only `ModuleHost` has. A remote edge needs the host's bus, so `ModuleHost` exposes it read-only. Rejected: hosting modules with the kit's `ModuleHarness` on a harness-owned bus, which would test the harness's isolation instead of the runtime's; and reaching the bus through a patched prototype.

**Timing: a manual clock and scheduler, with real I/O between steps.** The bus, the host, the edge and every remote client run on one manual clock and scheduler, so a deadline fires only when the harness moves virtual time. `wait` moves it 10 ms at a time and lets real I/O, the loopback HTTP, run in between. A restart or reconnect under way finishes before time moves again, so a remote part never reconnects into a runtime that is still starting. The held and queued commands come from the simulated lamp holding its switches, not from timing. Each deadline is far longer than a loopback round trip in virtual steps, and a late edge answer ends the same way as the requester's own deadline would, except for a queued command, whose `expired` answer must arrive within the requester's 1 s grace: 100 steps.

**Crash and restart.** A crash is armed, then fires in the lamp's outbox right after its commit and before its first publish, as #882's process test does with a real kill. At that point:
- every connection to the edge ends at once, with the calls in flight. The remote client settles a call whose connection drops as `uncertain-result`, so a remote requester's command ends that way; the scenario allows it up to the command's deadline plus `REQUESTER_GRACE_MS`, the latest the client would settle;
- in-process parts die with the runtime. The harness labels their requests `lost`, whatever the abandoned bus answers; that label describes the case and is not an SDK answer;
- the lamp's work ends with a throw, and the old host is stopped only to release its files;
- a new host starts on the same state directory, and a new edge takes the same port, behind one listener that holds requests until the new edge is ready.

Simulated devices keep their state, as real ones would. Rejected: a child process per run, which #882 already covers for the kill itself, and which would make every scenario slow and the remote edge's port change.

**A lost acknowledgment.** To show the core taking a duplicate outcome, the harness loses the core's next acknowledgment to the lamp on its way, as a dropped message would be, through the lamp's `onAcknowledgment` hook. The lamp keeps the outcome, reports it again at the next clean restart, and the core logs it as a duplicate, acknowledges it again and keeps one history entry. Rejected: a crash between the core's commit and its acknowledgment. The restarted core would then republish its stored acknowledgment while the restarted lamp republished its outcome, and which came first would decide whether the core saw a duplicate at all.

**Disconnects.** Remotely the edge ends the part's stream, and the SDK client reconnects after its backoff, tells its copies of the gap and syncs them. In process the part's participant closes and connects again after the same delay, and its copies sync on connect. Either way, the scenario records the messages published while the part was away and checks that none reached it.

**Duplicate commands.** A duplicate is a command with a `requestId` its responder already handled from the same source, such as a retry. The lamp records each handled `(source, requestId)` in the transaction that commits the outcome, and accepts a duplicate without acting or reporting again. The stand-in core records history by outcome message, so a second execution would show as a second row.

**Boundaries.** The edge listens on 127.0.0.1 on a free port that is never an installed service's (8765, 8787, 8788, 8791, 41231). State lives in a private directory under the system temporary directory, which the runtime itself refuses inside a Git checkout. Each part's token is generated per harness and never logged. Every message the harness sees is checked against profile 2.0.

## Risks / Trade-offs

- [The in-memory crash is not a real process kill.] The old runtime's code is abandoned, not ended, so work it had already scheduled could still run on its own bus. Its bus and edge are cut off, and its host is stopped at once; #882's process test keeps covering the real kill.
- [Virtual time races real I/O.] A remote answer that took longer than 100 virtual steps would end differently. The suite runs 20 times in sequence and 8 times at once without a failure before merge.
- [Stand-ins drift from the real core.] The stand-in core keeps to the families and rows the catalog reads, and #831, #782 and #923 replace its parts, keeping the scenarios.

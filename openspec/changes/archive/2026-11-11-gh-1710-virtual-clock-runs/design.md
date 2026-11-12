## Context

A disposable run has three processes: the test process with the run adapter and its remote parts, the supervisor with the simulated devices and the harness API, and the runtime child. Story 5 (#1709) let the child pass `runMain` a test clock. The in-memory harness already runs every catalog scenario on virtual time, with code that steps a manual clock, gives real work a turn and holds virtual time while a worker call runs. See proposal.md for why.

## Goals / Non-Goals

**Goals:**

- A run on virtual time, opt-in per run, with one authority for the time across the three processes.
- An advance that is settled when it answers: timers due by then have fired in the devices and the runtime, real work had its turn, and the journal has read what the runtime wrote.
- Measured cost on two converted cases, and an answer to whether event delivery needs a flush and what an idle-poll fast path saves.

**Non-Goals:**

- Running more catalog captures, release qualification or any default on virtual time (#1705 story 7).
- The browser's own clock in a capture (Playwright's page clock), and stopped-runtime hooks on virtual time.

## Decisions

- **The supervisor owns virtual time.** It already outlives every runtime child and holds the devices. Its clock starts at the real time when the run starts, so an outside process that stamps real time, such as the hook script, stays close to it. A restarted child starts at the supervisor's current time, so time never runs backwards. Alternative considered: the child owns time and the supervisor follows. Rejected: a crash would lose it.
- **One advance is the in-memory harness's stepping across two processes.** `POST /clock/advance {ms}` runs `stepThrough` over a clock whose next due time is the earlier of the devices' clock and the child's last `nextDueMs`. Each step moves the devices' clock (their timers fire, and what they push to the child goes out on the IPC channel first), then sends the child `advance {toMs}` and awaits `advanced`. The child waits for held worker calls, moves its manual clock, runs `settle` with a busy check that adds its outstanding device calls, and answers with its next due time, whether work is in flight, and how many stderr lines it has written. After the last step the supervisor waits until its journal has read those lines, since stderr and IPC are separate pipes. Advances run on the supervisor's lifecycle queue, one after another and never during a start or restart. A child that ends during an advance ends it early, so the run's next runtime starts before time moves on, and the adapter sends the rest.
- **The IPC pair is harness protocol, not bus traffic.** `advance` and `advanced` extend the supervisor and child messages in `verify/protocol.ts`. Nothing new goes on the bus, the routes use the shared error body with fixed text, and no record is written per advance (ADR 0012).
- **The adapter owes time instead of asking for it.** Most of a capture's polls are idle: no timer is due and nothing is in flight. The adapter adds such a poll's time to what it owes the run, and sends it with the next advance or before any call reaches the run: an action, a gateway call, a hook, health, or any call on a part's participant. A poll is idle only when the last advance said nothing was busy and the refresh after it changed nothing the scenario can read, no adapter call waits for an answer, no part is reconnecting, and no timer of the run or the parts is due before the poll ends. Waiting for a reader's resync after a restart never passes time this way.
- **Real I/O timers stay real.** Socket liveness (the edge's heartbeat and stall, the remote client's idle limit), the lag watchdog, launcher probes, device and media I/O deadlines, the supervisor's own answer bounds and the worker hold's 10 s bound are unchanged. So are process starts and the browser.
- **Shared code moves, not copies.** The manual clock and the worker hold move from `tests/support.ts` and `memory.ts` to `tests/scenarios/virtual-time.ts`, which the child can import: it imports nothing of the test runner's. `tests/support.ts` re-exports the clock for its many users.
- **The guard also refuses the default state directory.** Node opens an IPC channel for any process whose environment names an open descriptor (`NODE_CHANNEL_FD`), so the IPC condition does not prove the supervisor. A test clock with the default state directory is refused through the same `fail` path and `invalid-state`.

## Risks / Trade-offs

- [The idle-poll fast path could let a delivery arrive while time passes without the run.] → The prototype measured none: with no event-loop turns at all after an advance, no reader copy changed during owed time in either case across repeated runs. The refresh's own round trip and the rule that a changed refresh makes the next poll an advance are enough here; the adapter keeps four turns as margin.
- [A simulated device that reads the real clock changes its state on every refresh.] → The MicroDuck simulation reports a real sensor time. The adapter compares only the devices of the scenario's own modules when it decides whether a refresh changed anything.
- [Playback's monotonic clock in a run stays `performance.now()`.] → `run.remote` takes no options. Neither converted case reads Playback freshness; story 7 needs it for the cases that do.
- [A converted case no longer proves its product timer in real time.] → Listed per case in the PR. The default-wiring test and the remaining real-clock captures keep real-time evidence until story 7 decides which stay.

## Migration Plan

None. No stored data, configuration or installed behavior changes.

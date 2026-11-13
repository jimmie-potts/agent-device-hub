## Context

A run adapter on virtual time moves the run's time through the harness API, and between advances gives real I/O four turns of the event loop. Once the run reports nothing in flight and nothing changed, the rest of a wait passes without a call to the run, in microtasks. Real work that is still on its way, such as a frame on the reader's stream, then gets no time at all, and an expectation's bound, counted in 10 ms steps of the run's time, can pass in a few milliseconds of real time. The rule for this change: wherever the harness moves the run's time and then reads what real work must have finished, it waits on that work's condition, with a 15 s real-time bound whose failure names what is missing, and the run's time does not move while it waits.

## Goals / Non-Goals

**Goals:**
- Deliveries to the reader, an expectation's bound and a restart's resync no longer depend on host speed on virtual time.
- A passing path waits only while the named work is actually in flight; no fixed sleep, no longer timeout and no change to a product duration or an assertion.
- The real clock behaves as before.

**Non-Goals:**
- Pacing the run's time to real time (rejected by the owner on #1711, question B).
- A part's own request deadline for a request the scenario does not await. No catalog scenario sends one: every `send` is awaited, so no wait moves time while it is in flight. Holding the parts' clock for it would change what a timed-out request means; this stays a residual risk.
- The child's own real work within a bound: the child answers each advance after four turns and a 1 ms pause while busy, as the in-memory harness does (#1685). Only an expectation past its bound now also waits on it.

## Decisions

- **Delivery eligibility comes from the fixture bus.** The fixture installs an SDK test observer on the edge to record whether a matching subscription was registered when a publication went out. The existing private publication journal carries the local stream ordinal. The adapter uses the current generation and stream to exclude the lost interval, including messages published while subscriptions were absent. A delayed refresh can include live frames still on their way. Resync refreshes that metadata before the delivery check. A counted overflow carries no message IDs, so a still-open stream retains its live obligations. A new snapshot may account for missed state or removal. An occurrence that never arrives stays missing. A fence message would change what scenarios observe on the bus.
- **Copies provide their own revision evidence.** Occurrences and outcomes use their source and ID. A synced copy accounts for live state and removal by the SDK's existing snapshot floor, held revision and removal tombstone. The read-only SDK testing accessor shares the SDK's live revision test. Every missing publication appears in the failure.
- **Overtime is in the framework, its condition in the harness.** At the virtual bound, the adapter settles any already owed time, sends a zero advance and refreshes. An observable change during the settle also lets the expectation look again. An awaited read made by the check itself does not extend overtime merely by settling. One monotonic 15 s deadline covers those operations and any later waits. The in-memory harness has no overtime, and the adapter returns none on the real clock.
- **Resync holds the parts' clock.** A reconnect needs virtual time for backoff. After the reader returns, an ordinary wait and a restart hold time while its copies resync, since the copies' 5 s deadlines use the parts' clock. An ordinary wait then advances the rest of its requested interval.
- **Waits wake on change.** One `#until` helper serves the resync and delivery waits. It wakes when the reader hears or syncs anything, a call settles, an answer is recorded or a part's stream changes, and otherwise looks again every 25 ms.

## Risks / Trade-offs

- The owner accepted up to 15 s of overtime on failing paths and retaining existing deadlines for unawaited part requests.
- If an owner drops an entity without publishing a removal and without a reconnect, the delivery wait would fail after 15 s and name that entity. No catalog scenario does this, and the failure names it.

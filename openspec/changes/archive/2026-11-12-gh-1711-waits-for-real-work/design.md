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

- **Deliveries are known from what the run published.** The harness module in the child already reports every message the bus published. The reader subscribes to every event key and syncs a copy per owner, so the adapter can name what it must have received: each occurrence and outcome by its ID, and for each copy, each entity's latest state or removal from its owner, by revision. A revision rather than a message ID is compared because a resync's snapshot replaces live messages. Alternative considered: a fence message through the bus. Rejected, because it would add a message the scenarios observe.
- **An epoch keeps lost deliveries out.** A lost stream replays nothing, so a message published around a loss may never arrive. The reader's stream epoch changes when the adapter opens, loses or restores the stream, closes the reader, or the reader hears a gap notice. The first refresh that starts in a new epoch fixes from where messages are waited for. Messages before that point are not waited for, and nothing is waited for while the stream is away or held.
- **Overtime is in the framework, its condition in the harness.** `poll` asks an optional `Harness.overtime()` once the bound has passed. The in-memory harness does not implement it, so tier 1 is unchanged, and on the real clock the adapter returns none. Overtime first settles the run with an advance of 0, which moves nothing, then waits for a change in the real work it names and lets the check look again.
- **A restart's resync stops moving time once the stream is back.** Before the stream returns, the reconnect's backoff runs on the parts' clock, so the run must advance. After it returns, only real I/O remains, and advancing would let the copies' 5 s sync deadlines pass under it.
- **Waits wake on change.** One `#until` helper serves the resync and delivery waits. It wakes when the reader hears or syncs anything, a call settles, an answer is recorded or a part's stream changes, and otherwise looks again every 25 ms.

## Risks / Trade-offs

- A failing expectation on virtual time can take up to 15 s longer, if real work or work the run reports busy is in flight when it fails. This affects failing paths only.
- If an owner drops an entity without publishing a removal and without a reconnect, the delivery wait would fail after 15 s and name that entity. No catalog scenario does this, and the failure names it.
- Messages published between a stream's return and the next refresh are not waited for. The resync wait covers the copies, and an event in that gap may arrive late, as on the real clock.

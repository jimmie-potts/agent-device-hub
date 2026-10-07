## Context

`TileWriter` set a tile's `lastWriteAtMs` when a request went out, after its render and any wait in the queue, and stored it before the send so a stop or a crash kept it. The next write of the tile waited until that time plus the gate. The simulated cloud, like the real one, stamps a push when it arrives. A request's way to the cloud (encoding, the runtime's edge or the supervisor's IPC in a disposable run, the network for the real cloud) varies from one request to the next.

## Goals / Non-Goals

**Goals:** two writes of a tile reach the cloud at least 15 s apart, however long each request takes to arrive; nothing else about the gate changes.

**Non-Goals:** a different interval, a gate shared by the two tiles, or changes to the queue's holds.

## Decisions

- **Time the gate from the end of the call.** A request can reach the cloud only before its call ends, so a gate that starts when the call ends keeps the next request's arrival at least 15 s after the previous one's. The alternative, measuring at the cloud, is not possible: the cloud's answer carries no arrival time.
- **A call with no answer ends at its 10-second deadline.** The request may have arrived at any time before then, so the gate runs from the deadline and the next write goes out at least 25 s after the unanswered one went out. The uncertain write already counts as not confirmed sent, so its backoff applies too. Timing it from the send instead would let a request that arrived late be followed within less than 15 s.
- **The refresh runs from the same moment.** `sent.atMs` is the end of the push, so the refresh comes 10 minutes after the frame was confirmed. The refresh had no spacing problem of its own, because every push passes the gate; one moment for both keeps the writer simple.
- **Stops and crashes keep the send time.** The writer still stores the uncertain write, with the send time, before the request goes out, and the module stores nothing once it stops. A start after a stop or a crash during a write runs its gate from that send time. The cloud can then see two pushes less than 15 s apart by the stopped request's travel time, but only if the restart and a change both come within 15 s of that send.

## Risks / Trade-offs

- A slow answer now delays the tile's next write by the answer's travel time too. That is at most the 10-second call deadline, and usually milliseconds.

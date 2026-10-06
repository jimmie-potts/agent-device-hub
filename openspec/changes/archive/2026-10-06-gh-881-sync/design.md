## Context

ADR 0012 ("Consumers and recovery") states the sync rules, and profile 2.0 fixes the sync-request and `sync.completed` shapes. The #879 bus gives each subscription a bounded queue that drops on overflow and reports only to `onError`. Hub #842's reference consumer (`packages/event-contracts/tests/consumer.mjs`) models the copy rules in tests. Sync has timing (deadlines), concurrency (live messages during a sync) and recovery (overflow restarts), so this records the choices the ADR leaves open. See proposal.md for why.

## Goals / Non-Goals

**Goals:**
- A consumer copy that agrees with the reference consumer on every scenario it models.
- A sync implementation in which the remote transport (#883) supplies only a subscription and one request call.
- The smallest overflow signal that sync can use.

**Non-Goals:**
- Sync over SSE/HTTP (#883), the module host's scheduler (#880), paging snapshots above 4096 members, and automatic retry after a refused later sync.

## Decisions

1. **The consumer is transport-neutral.** `src/sync.ts` holds the copy and needs only a `SyncTransport`: `subscribe` with `onOverflow`, one `request` that never rejects, and `report`. `src/in-process-sync.ts` holds the in-process owner side. *Alternative:* the copy inside the bus, which #883 would have to rewrite.
2. **Sync messages use no routing key.** A request goes to the one owner of its families, and the states and `sync.completed` go straight back to the requester. *Alternative:* publishing the snapshot on state keys would show old states to every subscriber, which is close to replay, and would cross their revision floors.
3. **An entity is its schema family and `data.id`.** A removal names it in `data.entity`, and both carry `data.revision`, as the reference consumer reads them. *Alternatives:* the routing key never reaches the handler, and the profile does not define `subject` as the entity ID.
4. **One owner per family, and one owner per sync.** A copy has one revision sequence, so a sync whose families span owners is refused with `invalid-request`. A family with no owner is `unavailable`, which is retryable. The request's subject names its families, joined by commas, which caps their total length at 256 characters. *Alternative:* using the owner's name as the subject, which a remote client may not know.
5. **One worker per copy applies an answer in one step.** On the answer, the copy takes the snapshot, replaces its membership and applies the buffered messages above the revision without awaiting anything, so no reader sees it half-synced. Only then does it tell the handler. A change applied to the copy is always told, even when a restart starts meanwhile. *Alternative:* telling the handler after each step and stopping on restart, which would leave the handler without changes the copy already holds.
6. **The buffer is bounded in both phases.** Live messages wait in the copy's buffer both during a sync and while the handler catches up, so the bus subscription handlers never wait for the user's handler. An overflow in either phase restarts the sync. *Alternative:* using the bus queue as the buffer. The overflow signal would then wait behind the blocked handler, and an answer could be applied over a gap before the restart.
7. **The overflow signal runs in the subscription's queue.** `onOverflow({dropped})` runs before the next delivered message; a drop always leaves one waiting. `onError` keeps its report. *Alternatives:* a callback inside `publish`, which would run subscriber code in the sender's call, and a marker message, which is not a profile message.
8. **A deadline gives `unavailable`.** A sync changes nothing, so asking again is safe, and the requester never got an answer. *Alternatives:* `uncertain-result`, which implies a possible effect, and `expired`, which the owner reports when a request arrives late.
9. **A later failure ends the copy.** When a restarted sync is refused, the handler gets `failed`, and the copy stops but keeps its last records. *Alternatives:* automatic retry, which needs a backoff policy the ADR does not set, and staying open, which would follow live messages with a gap.
10. **A misfit snapshot is the owner's bug.** If the provider's states fall outside the requested families, lack an ID, or carry a revision above the snapshot's, the request is refused with `internal` and the problem is reported to `onError`.
11. **Only the first request joins `parent`.** A restart caused by an overflow starts a new trace.

## Risks / Trade-offs

- [A sustained publish rate that fills `maxBuffered` before each answer arrives restarts sync again and again.] → `maxBuffered` is per call, and the owner's queue bounds the waiting requests. The module host (#880) can watch for it.
- [The sync deadline uses `setTimeout`, as `request` does.] → When #880's injectable scheduler lands, both deadlines move to it.
- [A copy that failed keeps its last records.] → The `failed` change tells the consumer, which syncs again or stops showing them.
- [More than 4096 members cannot fit one `sync.completed`.] → The owner side refuses such a snapshot as `internal`; paging is not needed yet.
- [A late, lower removal could lower a tombstone in the reference consumer.] → The SDK keeps the higher tombstone and drops that removal as a duplicate. The resulting copy is the same in every #842 scenario.

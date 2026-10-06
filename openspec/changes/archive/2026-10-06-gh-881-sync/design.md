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

1. **The consumer is transport-neutral.** `src/sync.ts` holds the copy and needs only a `SyncTransport`: a clock, `subscribe` with `onOverflow`, one `request` call that the copy guards against rejection, and `report`. `src/in-process-sync.ts` holds the in-process owner side. *Alternative:* the copy inside the bus, which #883 would have to rewrite.
2. **Sync messages use no routing key.** A request goes to the one owner of its families, and the states and `sync.completed` go straight back to the requester. *Alternative:* publishing the snapshot on state keys would show old states to every subscriber, which is close to replay, and would cross their revision floors.
3. **An entity is its schema family and `data.id`.** A removal names it in `data.entity`, and both carry `data.revision`, as the reference consumer reads them. *Alternatives:* the routing key never reaches the handler, and the profile does not define `subject` as the entity ID.
4. **One owner per family, and one owner per sync.** A copy has one revision sequence, so a sync whose families span owners is refused with `invalid-request`. A family with no owner is `unavailable`, which is retryable. The request's subject names its families, joined by commas, which caps one request at 32 families and 256 characters; an owner may serve more. *Alternative:* using the owner's name as the subject, which a remote client may not know.
5. **One worker per copy applies an answer in one step.** On the answer, the copy takes the snapshot, replaces its membership and applies the buffered messages above the revision without awaiting anything, so no reader sees it half-synced. Only then does it tell the handler. A change applied to the copy is always told, even when a restart starts meanwhile. *Alternative:* telling the handler after each step and stopping on restart, which would leave the handler without changes the copy already holds.
6. **One request outstanding per copy (review of PR #894).** An overflow only marks the copy as wanting a sync and raises its generation. The copy's worker sends the request once no other is outstanding and the handler has returned, and an answer from an older generation is not applied. A busy or stalled copy therefore puts at most one request in the owner's shared queue, so one slow consumer lags only itself. The first sync is bounded: its first request gets the whole `timeoutMs`, later ones only the time left, and past it `sync` resolves as refused with the retryable `unavailable`. *Alternative:* sending on every overflow, which in review produced 13 provider calls for one stalled handler, kept a second consumer waiting 23 seconds and refused the busy copy with its own `capacity`.
7. **The buffer is bounded in both phases.** Live messages wait in the copy's buffer both during a sync and while the handler catches up, so the bus subscription handlers never wait for the user's handler. An overflow in either phase restarts the sync. *Alternative:* using the bus queue as the buffer. The overflow signal would then wait behind the blocked handler, and an answer could be applied over a gap before the restart.
8. **The overflow signal runs in the subscription's queue.** `onOverflow({dropped})` runs before the next delivered message; a drop always leaves one waiting. `onError` keeps its report. *Alternatives:* a callback inside `publish`, which would run subscriber code in the sender's call, and a marker message, which is not a profile message.
9. **A deadline gives `unavailable`.** A sync changes nothing, so asking again is safe, and the requester never got an answer. *Alternatives:* `uncertain-result`, which implies a possible effect, and `expired`, which the owner reports when a request arrives late.
10. **A later failure ends the copy.** When a restarted sync is refused, the handler gets `failed`, and the copy stops but keeps its last records. *Alternatives:* automatic retry, which needs a backoff policy the ADR does not set, and staying open, which would follow live messages with a gap.
11. **A misfit snapshot is the owner's bug.** If the provider's states fall outside the requested families, lack an ID, or carry a revision above the snapshot's, the request is refused with `internal` and the problem is reported to `onError`.
12. **Only the first request joins `parent`.** A restart caused by an overflow starts a new trace.

## Risks / Trade-offs

- [A sustained publish rate that fills `maxBuffered` before each answer arrives keeps a live copy resyncing.] → Each copy has one request outstanding, so it costs the owner one request at a time, and a first sync ends at its deadline. Restart health belongs to the module host (#880).
- [Tombstones are pruned only at the next sync.] → A long-lived copy with heavy churn keeps one revision per removed entity until its next sync. That is bounded by the entities removed since then.
- [The sync deadline uses `setTimeout`, as `request` does, and a request still queued at its deadline stays in the owner's queue until the owner ignores it as expired.] → #880 records moving both deadlines to its injectable scheduler, removing queued sync requests at their deadline, sync teardown when a module stops, and restart health.
- [A copy that failed keeps its last records.] → The `failed` change tells the consumer, which syncs again or stops showing them.
- [More than 4096 members cannot fit one `sync.completed`.] → The owner side refuses such a snapshot as `internal`; paging is not needed yet.
- [The remote transport must carry the same rules.] → #883 records the remote snapshot size and the 256 KiB cap, the deadline code across transports, the subject rule that names the families, and the precondition that live subscriptions exist before the request is sent.
- [A late, lower removal could lower a tombstone in the reference consumer.] → The SDK keeps the higher tombstone and drops that removal as a duplicate. `tests/scenarios.test.ts` runs all eight #842 scenarios through SDK copies, and each ends with the entities the reference consumer holds.

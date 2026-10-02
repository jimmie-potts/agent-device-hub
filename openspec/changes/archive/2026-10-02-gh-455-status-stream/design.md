## Context

The Hub already publishes authenticated state/resync notices and comment heartbeats. Tidbyt consumes optional subscriptions; LIFX currently polls. See proposal.md for the outcome. Design is required for shared concurrency, timing and cancellation.

## Goals / Non-Goals

Measure notice receipt to evaluation start, separate from writes. Preserve server wire, snapshots, controller queues and all modes/cadence. No history service, runtime CloudEvents adapter, framework dependency or installation.

## Decisions

Use native fetch/AbortController and a small incremental SSE reader. Bound frames at 8 KiB, chunks at 64 KiB and each connection at 1 MiB; rotate to a fresh resync when its budget ends. Use 2.5-second header and 10-second idle deadlines, and exponential reconnect delays from one to 30 seconds. A subscription has one latest pending notice and one consumer. Validate the existing projection and discard any cursor on reconnect so the server sends authoritative resync. Heartbeats do not trigger evaluations. Polling remains the fallback for every stream failure.

Keep a fixed recovery timer independent of the evaluator's write-cadence timer. Both request the same one-running/one-pending loop. Resetting recovery after each notice was rejected because a storm can postpone it indefinitely. Existing cadence timers remain controller-owned.

Pass cancellation through snapshot reads, and let the bounded reader retire its wait immediately on stop. A noncooperative feed may retain its own pending operation, but the publisher launches no replacement or submission. Check stop after every pre-submission await, including Tidbyt installation lookup. Already admitted writes retain their own terminal receipt.

Share optional subscription consumption between both publishers. It requests evaluation without awaiting each snapshot, allowing bounded coalescing, closes the iterable on stop, and retries a ended third-party subscription only at later evaluation. The concrete Hub iterable owns its bounded reconnect timer.

## Risks / Trade-offs

Brief states may coalesce; Tidbyt's 15-second gate remains authoritative. Stream notices are hints, never freshness or physical success evidence. Native fetch/stream cancellation bounds owned resources; arbitrary third-party feeds must honor their own resource contract. No secrets or event bodies enter diagnostics.

## Migration Plan

Source only. Existing zero-argument feeds still work; cancellation and subscriptions are optional. Owning installation work may later select this revision. No live settings or services change here.

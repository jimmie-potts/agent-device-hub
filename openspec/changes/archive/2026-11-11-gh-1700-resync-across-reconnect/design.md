## Context

A remote copy resyncs when its subscription hears a gap notice, which the client gives every subscription after a reconnect once all are registered again. A resync refused at that point ended the copy (`sync.ts`, `#complete`). In #1697 the runtime restarted twice within a second; the reconnect reached the first new runtime, its re-registration and resyncs met the second restart, and the reader's copies stopped.

## Goals / Non-Goals

**Goals:** a resync refused `unavailable` while the stream is lost does not end the copy; the reconnect paces the next try; a copy never presents state it cannot vouch for beyond what it does during any reconnect.

**Non-Goals:** retrying a first sync, retrying any other refusal, retrying while the stream stays up, faster reconnects, a new message format or error shape.

## Decisions

- **The transport decides, the copy waits.** Only the remote client knows its stream. It compares the stream at send time with the current one when the answer comes: a lost or replaced stream, or no stream at send, marks an `unavailable` refusal `interrupted`. The copy treats a later `interrupted` answer like a superseded served answer: it applies nothing and ends nothing. Every lost stream is followed by a gap notice on each subscription once the stream is back, and that notice is what wants the next request, so the repeat is bounded by reconnects and ends when the participant closes.
- **A refusal before the lost stream is heard.** When a runtime stops, the call and the stream fail at about the same moment, in either order. A resync call that could not reach the edge while its stream still looks open waits for that stream's loss, bounded by the request's own deadline on the client's scheduler. If the stream stays open, the refusal the client first heard ends the copy as before, with its own detail, now at the deadline. A first sync does not wait, because a first sync answered `interrupted` is refused anyway; the copy marks each request as a first sync or a resync on the internal `OutgoingSync` seam. An edge's own `unavailable` answer heard before the stream's loss is not waited for and still ends the copy. No new timer is added; the idle limit from #1690 still bounds a silent stream and a stream open that gets no answer.
- **`interrupted` is not on the wire.** It is a value on the internal `SyncTransport` seam, which the SDK does not export. The edge's answer shape, error codes and details are unchanged.
- **ADR 0012.** A sync only reads. The retry rule lets reconnection and sync repeat on their own, each loop with one owner and capped backoff, and each sync attempt with a deadline. Here the reconnect loop is the one owner, its backoff is the pace, and each resync keeps its deadline. No command is resent, and no past fact triggers one.

## Risks / Trade-offs

- A copy whose stream keeps dropping stays syncing for as long as reconnects keep failing, instead of telling its holder `failed`. Holders already hear `onRestarted` when the gap notice restarts the copy, and `remote.disconnected` reports the loss.
- A resync call that cannot reach the edge while its stream stays open now ends the copy at the request's deadline rather than at once, with the same refusal.
- The in-memory scenario harness's restart calls `closeAllConnections`, which resets an in-flight resync and the stream together. Both orders are covered by the remote tests. A re-registration that the reset refuses is reported as before; the next reconnect registers it again.

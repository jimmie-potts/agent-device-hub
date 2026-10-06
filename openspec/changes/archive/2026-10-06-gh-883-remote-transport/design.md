## Context

ADR 0012 ("Runtime and transport", "Portability") puts every module on one in-process bus, with remote parts using the same SDK calls over SSE and HTTP and no broker. The bus (#879) and sync (#881) exist; sync's transport interface (`SyncTransport`) was shaped for this story. The issue's hand-off comments raised design questions, and the coordinator decided them on 2026-10-06; this records each as implemented. See proposal.md for why.

## Goals / Non-Goals

**Goals:**
- The full `Sdk` for a remote part, with the edge validating everything inbound.
- One conformance suite for both transports.
- The protections: no replay, expired requests ignored, credentials never exposed.

**Non-Goals:**
- WebSocket, TLS and non-loopback hosting.
- Paging a large sync snapshot.
- Automatic token rotation.
- #880's module host wiring (the runtime mounts the edge later).

## Decisions

1. **Remote messages keep their own `id` and `time` (coordinator decision 1).** The client builds every message it sends: published messages, commands and sync requests. The edge injects them unchanged through prepared entry points:
   - `Sdk.publishMessage`, which is general, so #882's outbox resends a stored outcome the same way;
   - `InProcessBus.requestMessage` and `syncMessage`, which only an edge uses.

   Replies and snapshots stay values, as in process, and the bus builds their messages with the responder's or owner's source. *Alternative:* sending drafts and building envelopes at the edge, which would give remote messages new identities.
2. **Subscribe resolves once live (decision 2).** The client registers its local handler, then POSTs `subscribe`. The edge answers only after the bus registered the subscription, and the client resolves on that answer. A stream event that races ahead of the answer still finds its handler.
3. **A reconnect is an overflow (decision 3).** `onOverflow`'s `dropped` is optional; absent means unknown. After a lost stream the client:
   - reconnects with backoff (100 ms by default, doubling to 5 s);
   - registers its subscriptions, responders and sync owners again;
   - only then tells each subscription `onOverflow({})`.

   A sync copy restarts on any notice, so `SyncTransport` needed no other change. Nothing missed is replayed.
4. **Snapshot size at the edge (decision 4).** If any message of a sync answer is over 256 KiB, the edge refuses it with `too-large` and logs `edge.refused`. Its `sync.completed` with long IDs reaches the cap long before the profile's 4096 members. A first sync then resolves `rejected` with that code, and a later one ends the copy with `failed`. Paging is #782, needed once any family's snapshot nears the cap; inbox items have no expiry, so that family can grow.
5. **Deadlines match in process (decision 5, revised in review of PR #909).** ADR 0012 answers a command still queued at its deadline `expired`, and only an unknown fate `uncertain-result`; the remote transport now gives the same answers.
   - The edge answers when its bus settles, with no grace of its own. It waits exactly until the command's or sync request's expiry, so a command still queued is `expired`, one a handler had is `uncertain-result`, and a sync is `unavailable`.
   - The remote requester waits `REQUESTER_GRACE_MS`, a fixed 1 s, past its deadline on its scheduler. Only an edge it cannot hear by then leaves it to decide: `uncertain-result` for a command, whose fate is unknown, and `unavailable` for a sync. The edge answers at the deadline plus its event-loop and network delay, which on one host is far below 1 s.
   - Refusals name the request's own timeout, `expiresat` minus `time`, not what was left of it at the edge.
   - An edge that receives an already-expired command or sync request refuses it with `expired`. For a remote part's own sync request, the client turns that into the retryable `unavailable`, since a sync only reads and the cause is clock skew (#837).
   - *Alternative:* the first version's 1 s edge grace, which made a remote queued command `uncertain-result` and needed an exception to the ADR.
6. **The sync subject (decision 6).** A sync request's `subject` is the comma-joined family list, as #881 implemented, capped at 256 characters by the request rule. `sync.completed` carries the same subject. The profile docs and spec record it, and the fixtures follow it. The validator does not check it, because `sync.completed` does not carry the families.
7. **Authentication (decision 7).** Each grant stores a SHA-256 digest of its token. A presented token is hashed and compared with every grant through `timingSafeEqual`, with no early exit, so timing reveals neither which grant matched nor the token's length.
   - `unauthenticated` (401): a call without a bearer token or with an ungranted one.
   - `forbidden` (403): a message or connection of another source, including a close, reply or sync answer on another source's connection.
   - The edge refuses at start a grant with a malformed source or a token two grants share, without naming the token.
   - Tokens appear only in the `authorization` header. Log records carry the route, code, source and detail.
8. **A slow consumer (decision 8).** Each remote subscription is an ordinary bus subscription whose handler writes one frame and, if the socket's buffer is full, waits for `drain` or the connection's close. A stalled reader holds only that subscription's bounded bus queue. Its drops reach `onError` as `capacity`, and the in-band `overflow` frame carries the count. The connection's memory is bounded by its subscriptions' queues plus one socket buffer.
   - This is per-subscription bounding on the connection, not one shared per-connection queue. It reuses the bus's queue and overflow signal and needs no second queue.
   - *Alternative:* closing the stream on overflow, which would turn every burst into a reconnect.
9. **Edge validation (decision 9).** Every inbound message passes `MessageValidator.validate` with the edge's clock, including the 256 KiB cap and expiry. A call body over its limit is refused with `too-large` before parsing, and a body that is not JSON with `invalid-request`:
   - one message's call: 320 KiB;
   - a snapshot answer: 16 MiB.

   A remote owner's snapshot drafts are validated as the state messages they become. A body over its limit is not read further; the refusal closes the connection. A sync request whose subject is not its families, joined by commas, is refused with `invalid-message`. A remote responder's or owner's refusal is rebuilt with `errorBody`, keeping only its registered code and a detail cut to 1024 characters, and the reply is validated before it settles the request.
10. **A dropped stream never answers a written command (review of PR #909).** A forwarded command whose frame reached the socket may be running in the remote handler, so a dropped stream does not answer it; answering `unavailable`, which is retryable, could run it twice.
    - Forwarded calls wait in an edge-level map keyed by source, responder or owner id and request id, not on the connection. A reply that comes on the reconnected stream, from the same responder id, still settles the request.
    - Otherwise the bus's deadline makes the command `uncertain-result`. A frame that never reached the socket is `unavailable`, and so is a forwarded sync request, which only reads.
11. **Close settles remote requests (review of PR #909).** A remote participant's `close` returns one promise. It settles each request still waiting for the edge as `uncertain-result`, drops its call and cancels its timers and the reconnect backoff. The edge sees the dropped call and takes a still-queued command out through a signal on the bus's dispatch, so it never runs. The requester cannot tell queued from handled, so the conformance suite expects `cancelled` in process and `uncertain-result` remotely.
12. **Reconnect order (review of PR #909).** Gap notices are queued before any message of the new stream, and held until every subscription is registered again, so a sync copy resyncs only once its subscriptions exist. A connection-scoped call that meets a lost stream gets the retryable `unavailable` instead of `not-found`, and a registration that failed is closed at the edge in case a reconnect registered it meanwhile.
13. **One deadline maximum (review of PR #909).** `MAX_TIMEOUT_MS` is one day on both transports. With the requester's grace, no timer comes near `setTimeout`'s limit of about 24.8 days. The edge refuses an inbound deadline further away with `invalid-request`.

## Risks / Trade-offs

- **[#880 (PR #899) changed the same files.]**
  - This branch rebased onto it.
  - A remote participant is a `Participant`, whose close closes its sync copies.
  - `OutgoingSync.signal` drops the HTTP sync call, and the edge withdraws the request from the owner's queue through #880's sync dispatch.
  - The client's and the edge's waits run on an injectable scheduler.
  - The bus's prepared entry points sit on #880's dispatch.
  - The suite covers a closed participant and a closing participant's withdrawn sync request.
  - Requests the edge sends for a remote part have no participant; they settle by their wait, or by the remote part dropping its call.
- **[#882's outbox needs the same entry point.]** → `publishMessage` is the branch's first commit, self-contained, so #882 can cherry-pick it and the second PR to merge drops the identical patch.
- **[A sync answer is one HTTP response.]**
  - Each message is capped, but the whole answer is not.
  - Paging (#782) bounds it.
- **[Clock skew between hosts.]**
  - Expiry compares the remote part's `expiresat` with the edge's clock.
  - Remote parts on this host share its clock.
  - Another host needs NTP, which ADR 0012's envelope rule already assumes. A sync refused as expired reaches its requester as `unavailable`; #837 records the behavior.
- **[An idle stream has no heartbeat.]** → A silently dead connection is found only when a write fails. #835 tracks a heartbeat.
- **[A remote requester's withdrawal races a freed responder.]** → Between the requester's close and the edge seeing the dropped call, a freed responder may start the queued command. That is why the remote answer is `uncertain-result`.
- **[A burst during a reconnect is lost.]** → By design: there is no replay, and the gap notice makes sync copies resync.
- **[Tokens are configured, not rotated.]** → Rotation and storage belong to the 2.0 edge (#835).

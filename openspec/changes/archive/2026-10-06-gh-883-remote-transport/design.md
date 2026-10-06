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
4. **Snapshot size at the edge (decision 4).** If any message of a sync answer is over 256 KiB, the edge refuses it with `too-large` and logs `edge.refused`. Its `sync.completed` with long IDs reaches the cap long before the profile's 4096 members. A first sync then resolves `rejected` with that code, and a later one ends the copy with `failed`. Paging is deferred until any family's snapshot nears the cap; inbox items have no expiry, so that family can grow.
5. **Deadlines per transport (decision 5).** The remote requester's own timer decides. A command still unanswered at its deadline is `uncertain-result`, whether queued or held, because a remote requester cannot know whether the handler started. A sync is `unavailable` on both transports. An edge that receives an already-expired command or sync request refuses it with `expired`, which a requester that already gave up ignores. The edge itself waits 1 s past the expiry, for both its bus request and the commands and sync requests it forwards, so its late answer never races the requester's deadline. The first version waited exactly to the expiry, and a forwarded command's late refusal sometimes beat the requester's own timer.
6. **The sync subject (decision 6).** A sync request's `subject` is the comma-joined family list, as #881 implemented, capped at 256 characters by the request rule. `sync.completed` carries the same subject. The profile docs and spec record it, and the fixtures follow it. The validator does not check it, because `sync.completed` does not carry the families.
7. **Authentication (decision 7).** Each grant stores a SHA-256 digest of its token. A presented token is hashed and compared with every grant through `timingSafeEqual`, with no early exit, so timing reveals neither which grant matched nor the token's length.
   - `unauthenticated` (401): a call without a bearer token or with an ungranted one.
   - `forbidden` (403): a message or connection of another source.
   - Tokens appear only in the `authorization` header. Log records carry the route, code, source and detail.
8. **A slow consumer (decision 8).** Each remote subscription is an ordinary bus subscription whose handler writes one frame and, if the socket's buffer is full, waits for `drain` or the connection's close. A stalled reader holds only that subscription's bounded bus queue. Its drops reach `onError` as `capacity`, and the in-band `overflow` frame carries the count. The connection's memory is bounded by its subscriptions' queues plus one socket buffer.
   - This is per-subscription bounding on the connection, not one shared per-connection queue. It reuses the bus's queue and overflow signal and needs no second queue.
   - *Alternative:* closing the stream on overflow, which would turn every burst into a reconnect.
9. **Edge validation (decision 9).** Every inbound message passes `MessageValidator.validate` with the edge's clock, including the 256 KiB cap and expiry. A call body over its limit is refused with `too-large` before parsing, and a body that is not JSON with `invalid-request`:
   - one message's call: 320 KiB;
   - a snapshot answer: 16 MiB.

   A remote owner's snapshot drafts are validated as the state messages they become.

## Risks / Trade-offs

- **[#880's PR #899 changes the same files.]**
  - It changes `in-process.ts`, `sdk.ts`, `queue.ts`, the README and the spec.
  - After it merges, this branch rebases.
  - The in-process expectation for a queued command at its deadline becomes `expired`.
  - Remote sync requests honor `OutgoingSync.signal` by aborting the HTTP call.
  - The suite gains a subscribe-through-a-closed-participant case.
- **[The edge's own waits use `setTimeout`.]** → They move to #880's scheduler with the bus.
- **[A sync answer is one HTTP response.]**
  - Each message is capped, but the whole answer is not.
  - Paging, deferred above, bounds it.
- **[Clock skew between hosts.]**
  - Expiry compares the remote part's `expiresat` with the edge's clock.
  - Remote parts on this host share its clock.
  - Another host needs NTP, which ADR 0012's envelope rule already assumes.
- **[A burst during a reconnect is lost.]** → By design: there is no replay, and the gap notice makes sync copies resync.
- **[Tokens are configured, not rotated.]** → Rotation and storage belong to the 2.0 edge (#835).

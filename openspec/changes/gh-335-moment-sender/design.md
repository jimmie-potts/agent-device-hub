## Context

See proposal.md. `ControllerClient` owns one bounded slot per controller through a private `exclusive(run)` wrapper, with `send` as the bounded call inside it. Since #576, `snapshot('1.1')` holds one slot across its probe and fallback read and `negotiation()` reports the verdict. The contract fixes the moment rules: a client sends a moment only after it has read a 1.1 snapshot that declares `moments` supported, takes the ticket and guards from that snapshot, and expresses `start` in the receiving controller's monotonic clock.

## Goals / Non-Goals

Goals: one call sends one moment to one device and returns one typed result; the existing one-slot-per-controller model changes only by an opt-in wait for sends; 1.0 readers and the 1.0 command path stay byte-compatible.

Non-goals: a route, MCP tool or page; arbitration, quiet hours, budgets or an interrupt set; a group send; durable history (#296); an idempotent same-ticket resend; feed reads at 1.1 (#576's deferral).

## Decisions

**The wait is a FIFO hand-over inside `exclusive`.** `exclusive(run, waitMs)` keeps today's immediate `capacity` rejection when `waitMs` is 0, which every read uses. A send passes 2,500 ms: it joins a queue, and a release hands the slot straight to the oldest waiter, so a read that arrives between release and hand-over still gets `capacity`. A waiter whose bound expires leaves the queue with `capacity`; `close()` fails every waiter with `controller-unavailable`. The queue is bounded in time, not length, because each waiter leaves within 2,500 ms.

**The sender holds one slot for wait, read and POST.** `ControllerClient.hold(waitMs, use)` gives `use` a slot handle with the negotiated `snapshot('1.1')` and `momentCommand(request)` that run inside the held slot. Holding one slot means no other hub caller can take the snapshot's `nextRequestId` between the read and the POST. The handle refuses use after the hold ends. `momentCommand` is also public on the client for a caller that already has a request; it takes the slot without waiting.

**The 1.1 command path mirrors the 1.0 one.** It validates `requestV1_1` and the configured identity, POSTs to `/commands` once, and accepts a `receiptV1_1` with the same identity and ticket, whether the answer is 2xx or a typed non-2xx receipt. A mismatch, malformed answer, timeout or lost response is `uncertain-result`. A typed refusal without a receipt keeps its code, as on the 1.0 path. `send` now also accepts a `receiptV1_1` body on a non-2xx answer; the 1.0 `command()` still validates `receipt` afterwards, so its results do not change.

**Start instant.** The caller may pass `startAtHubMs` on the hub's monotonic clock (`performance.now()`, exported as `hubMonotonicNow`); the default is the snapshot's arrival. `atMs` is `sampleClock.sampledAtMs + (startAtHubMs - arrival)` and `epoch` is `sampleClock.epoch`. The default therefore puts `atMs` at `sampledAtMs`, so the slot wait and the read never eat into the start window: only the POST runs after `atMs` is computed. A caller that sends one moment to several devices passes the same `startAtHubMs` to each call. A start more than 60,000 ms after the call is rejected before any read. When a caller's past instant would make `atMs` negative (a controller clock younger than the lateness), `atMs` becomes 0 and `toleranceMs` shrinks by the same amount, floored at 0, so the absolute deadline is kept and the device still drops a moment that is too late as `moment-missed`.

**Result types.** `sendMoment` resolves to exactly one of:

- `{kind:'receipt', momentId, start, receipt}`: the controller's `receiptV1_1`, including typed failures such as `moment-missed` or `revision-conflict`.
- `{kind:'not-sent', momentId, start, reason, failure?}` with `reason` one of `1.0-only`, `moments-unsupported`, `unsupported-capability`, `capacity` or `unavailable`. The sender decides each of them from the slot, the read or the snapshot, and then sends no POST. `failure` is present only when the controller answered the POST with a typed refusal and no receipt, so nothing was admitted: `capacity` and `unsupported-capability` keep their reasons and every other code, such as `request-order` or `unauthenticated`, is `unavailable` with that code.
- `{kind:'uncertain', momentId, start}` after a timeout, lost response or unverifiable answer.

`start` is the command's `start` whenever a snapshot was read, and `null` when the sender stopped before a read (`capacity`, `unavailable`). Invalid input, including a `flourish` with `coversStatus:true`, a tolerance above 60,000 or a start more than 60,000 ms ahead, throws `invalid-request` before any read; it is a caller bug, not a delivery result. Only an unexpected, non-HTTP error propagates otherwise.

**No policy, no state, no resend.** The sender imports no storage, keeps nothing queued and never retries. The device's start window, clock epoch and `momentId` memory make a stale or repeated delivery harmless.

**Timeouts.** The slot wait is at most 2,500 ms; the negotiated read is at most two reads of the client's `timeoutMs` (2,000 ms by default); the POST is one more. Only the POST follows the start computation, so the default `toleranceMs` of 10,000 covers it with margin. The worst case, about 8.5 s, exceeds the hub's 3,000 ms HTTP response cap, so a future route caller (#336) needs its own bound or an asynchronous answer.

**Fake extension.** The shared fake keeps a contract `AdmissionStateV1_1` per epoch and answers POSTs with the reference `admit`: 202 for `queued`, the mapped HTTP status for failed receipts and bare typed refusals. Accepted requests advance `nextRequestId`, so the snapshot stays consistent. A 1.0-serving fake rejects a 1.1 envelope with `invalid-request`. `answerNext` scripts one answer (a receipt change, a bare failure, a timeout or a dropped connection), `hold` stalls the next matching request until released, and `moments()` lists the moment POSTs.

## Risks / Trade-offs

- A slot wait delays a queued send behind a slow read → bounded at 2,500 ms, and the wait precedes the start computation.
- A send can hold the slot for up to about 6 s after the wait → reads get the existing immediate `capacity`, which the dashboard already handles.
- A lost POST response leaves the moment `uncertain` with no resend → the device's start window bounds any late play; a same-ticket resend is a recorded deferral.

## Migration Plan

Source only. No wire value changes for 1.0 readers, nothing is stored, and no caller is wired in this story. Rollback is the previous hub build.
